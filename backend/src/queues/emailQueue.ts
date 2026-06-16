import { Queue, Worker, QueueEvents, Job, ConnectionOptions, UnrecoverableError } from 'bullmq';
import { BULL_REDIS_URL, BULL_REDIS_TLS } from '../config/redis';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { SequenceStep } from '../models/SequenceStep';
import { Sequence } from '../models/Sequence';
import { EmailConnection } from '../models/EmailConnection';
import { Template } from '../models/Template';
import { SendingLog, SendStatus } from '../models/SendingLog';
import { ClickLog } from '../models/ClickLog';
import { emailConnectionService } from '../services/emailConnection.service';
import { enrollmentService } from '../services/enrollment.service';
import { renderEmail } from '../utils/templateRenderer';
import { env, isDev } from '../config/env';
import logger from '../config/logger';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { encrypt } from '../utils/crypto';

const QUEUE_NAME = env.EMAIL_QUEUE_NAME;
const CONCURRENCY = parseInt(env.QUEUE_CONCURRENCY, 10);
const RETRY_ATTEMPTS = parseInt(env.RETRY_ATTEMPTS, 10);
const RETRY_BACKOFF_DELAY = parseInt(env.RETRY_BACKOFF_DELAY, 10);

// ─── BullMQ connection (uses its own bundled ioredis) ─────────────
function makeBullConnection(): ConnectionOptions {
  const url = new URL(BULL_REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    ...(url.username && url.username !== 'default' ? { username: url.username } : {}),
    ...(BULL_REDIS_TLS ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: isDev ? () => null : undefined,
  };
}

const bullConnection = makeBullConnection();

// ─── Queue instance ────────────────────────────────────────────────
export const emailQueue = new Queue(QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: RETRY_BACKOFF_DELAY,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// ─── Queue Events ──────────────────────────────────────────────────
export const emailQueueEvents = new QueueEvents(QUEUE_NAME, {
  connection: makeBullConnection(),
});

emailQueueEvents.on('completed', ({ jobId }) => {
  logger.info('📤 Email job completed', { jobId });
});

emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error('❌ Email job failed', { jobId, failedReason });
});

// ─── Email Send Processor ─────────────────────────────────────────
// Exported so debug endpoints can invoke it directly without BullMQ.
export async function processEmailSend(job: Job): Promise<void> {
  const { sequenceContactId, stepIndex } = job.data as {
    sequenceContactId: string;
    stepIndex:         number;
  };

  logger.info('📨 Email worker: job received', {
    jobId: job.id,
    sequenceContactId,
    stepIndex,
  });

  // 1. Re-fetch contact (idempotency check)
  const contact = await SequenceContact.findById(sequenceContactId);

  if (!contact) {
    logger.warn('Email worker: contact not found — marking UnrecoverableError', { sequenceContactId });
    throw new UnrecoverableError(`Contact ${sequenceContactId} not found — skipping`);
  }
  logger.info('Email worker: contact loaded', {
    contactId: contact._id,
    email: contact.contact_email,
    status: contact.status,
    current_step_index: contact.current_step_index,
  });

  if (contact.status !== ContactEnrollmentStatus.ACTIVE) {
    logger.info(`Email worker: skipping — contact status is "${contact.status}"`, {
      sequenceContactId,
    });
    return; // Job consumed successfully, no retry
  }
  if (contact.current_step_index !== stepIndex) {
    logger.info(`Email worker: skipping stale job — contact is now at step ${contact.current_step_index}`, {
      sequenceContactId,
      jobStepIndex: stepIndex,
    });
    return;
  }

  // 2. Load step, template, connection, sequence
  const [step, sequence] = await Promise.all([
    SequenceStep.findOne({
      sequence_id: contact.sequence_id,
      step_index:  stepIndex,
      is_active:   true,
    }),
    Sequence.findById(contact.sequence_id),
  ]);

  logger.info('Email worker: sequence step loaded', {
    stepFound: !!step,
    sequenceFound: !!sequence,
    stepType: step?.type,
    email_connection_id_on_step: (step as any)?.email_connection_id,
    email_connection_id_on_contact: contact.email_connection_id,
  });

  if (!step || !sequence) {
    logger.error('Email worker: step or sequence not found — UnrecoverableError', {
      sequenceContactId,
      stepIndex,
      sequenceId: contact.sequence_id,
    });
    throw new UnrecoverableError(`Step or sequence not found — marking contact failed`);
  }

  // ⚠️ Critical: prefer step-level connection, fall back to contact-level.
  // If BOTH are undefined, throw a clear error rather than silently failing.
  const connectionId = (step as any).email_connection_id ?? contact.email_connection_id;

  if (!connectionId) {
    logger.error('Email worker: no email_connection_id found on step or contact — UnrecoverableError', {
      stepId: step._id,
      sequenceContactId,
      stepIndex,
    });
    throw new UnrecoverableError(
      `No email_connection_id on step ${step._id} or contact ${sequenceContactId}. ` +
      `Edit the sequence step and re-select the sending account.`
    );
  }

  const [template, connection] = await Promise.all([
    step.template_id ? Template.findById(step.template_id) : null,
    EmailConnection.findById(connectionId),
  ]);

  logger.info('Email worker: email account and template loaded', {
    connectionId,
    connectionFound: !!connection,
    templateId: step.template_id,
    templateFound: !!template,
    fromEmail: connection?.from_email,
  });

  if (!connection) {
    logger.error('Email worker: email connection not found — UnrecoverableError', { connectionId });
    throw new UnrecoverableError(`Email connection ${connectionId} not found or inactive`);
  }

  // 3. Render email
  const rawSubject  = step.subject_override || template?.subject || '(no subject)';
  const rawBodyHtml = step.body_html_override || template?.body_html || '';
  const rawBodyText = step.body_text_override || template?.body_text || '';

  // Build template defaults map
  const defaultVars: Record<string, string> = {};
  if (template?.variables) {
    for (const v of template.variables) {
      if (v.default_value) defaultVars[v.name] = v.default_value;
    }
  }

  // Generate Message-ID upfront
  const messageId = `<${crypto.randomUUID()}@${connection.from_email.split('@')[1] || 'emailsequencer.local'}>`;

  // Create a placeholder SendingLog to get the ID for tracking URLs
  const sendingLog = new SendingLog({
    sequence_id:         contact.sequence_id,
    sequence_contact_id: contact._id,
    sequence_step_id:    step._id,
    user_id:             contact.user_id,
    email_connection_id: connectionId,
    template_id:         step.template_id,
    to_email:            contact.contact_email,
    from_email:          connection.from_email,
    from_name:           connection.from_name,
    subject:             rawSubject, // will be updated after render
    step_index:          stepIndex,
    status:              SendStatus.SENDING,
    message_id:          messageId,
    queued_at:           job.timestamp ? new Date(job.timestamp) : new Date(),
  });
  await sendingLog.save();

  const rendered = renderEmail(
    {
      subject:   rawSubject,
      body_html: rawBodyHtml,
      body_text: rawBodyText,
    },
    {
      first_name:        contact.contact_first_name,
      last_name:         contact.contact_last_name,
      company:           contact.contact_company,
      email:             contact.contact_email,
      custom_variables:  Object.fromEntries(contact.custom_variables),
      default_variables: defaultVars,
    },
    {
      sequenceContactId: contact._id.toString(),
      sendingLogId:      sendingLog._id.toString(),
      messageId:         messageId.replace(/[<>]/g, ''), // Strip <> for pixel URL
      trackOpens:        step.track_opens  ?? sequence.track_opens,
      trackClicks:       step.track_clicks ?? sequence.track_clicks,
    }
  );

  // Pre-create ClickLog records
  if (rendered.links.length > 0) {
    const clickLogsToInsert = rendered.links.map(link => ({
      sequence_id:         contact.sequence_id,
      sequence_contact_id: contact._id,
      sending_log_id:      sendingLog._id,
      user_id:             contact.user_id,
      contact_email:       contact.contact_email,
      step_index:          stepIndex,
      original_url:        link.originalUrl,
      tracking_id:         link.trackingId,
      is_first_click:      true,
      click_count:         0,
    }));
    await ClickLog.insertMany(clickLogsToInsert, { lean: false });
  }

  // 4. Send via Nodemailer
  const { smtpPassword } = await emailConnectionService.getDecryptedCredentials(
    contact.user_id.toString(),
    connectionId.toString()
  );

  const transporter = nodemailer.createTransport({
    host:   connection.smtp_host,
    port:   connection.smtp_port,
    secure: connection.smtp_encryption === 'ssl',
    auth:   { user: connection.smtp_username, pass: smtpPassword },
    connectionTimeout: 15_000,
  });

  const unsubscribeToken = encodeURIComponent(encrypt(contact._id.toString()));
  const unsubscribeUrl = `${env.APP_BASE_URL}/unsubscribe/${unsubscribeToken}`;

  logger.info('Email worker: starting SMTP send', {
    to:         contact.contact_email,
    from:       connection.from_email,
    subject:    rendered.subject,
    smtpHost:   connection.smtp_host,
    smtpPort:   connection.smtp_port,
    smtpUser:   connection.smtp_username,
    messageId,
  });

  try {
    await transporter.sendMail({
      from:    `"${connection.from_name}" <${connection.from_email}>`,
      replyTo: connection.reply_to || connection.from_email,
      to:      contact.contact_email,
      subject: rendered.subject,
      html:    rendered.body_html,
      text:    rendered.body_text || undefined,
      messageId: messageId,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'X-Mailer': 'EmailSequencer v1.0',
        'X-Sequence-ID':  contact.sequence_id.toString(),
        'X-Contact-ID':   contact._id.toString(),
      },
    });
    logger.info('Email worker: SMTP send SUCCESS ✅', {
      to:       contact.contact_email,
      subject:  rendered.subject,
      messageId,
    });
    transporter.close();
  } catch (err: any) {
    transporter.close();
    const is5xx = err.responseCode >= 500 && err.responseCode < 600;
    
    // Update log to failed
    await SendingLog.updateOne(
      { _id: sendingLog._id },
      {
        status:        SendStatus.FAILED,
        error_message: err.message,
        failed_at:     new Date(),
      }
    );

    // Increment consecutive failures
    contact.consecutive_failures = (contact.consecutive_failures ?? 0) + 1;
    contact.last_error = err.message;

    if (is5xx) {
      // 5xx error (e.g. 550 Mailbox unavailable) -> Hard bounce
      contact.status       = ContactEnrollmentStatus.BOUNCED;
      contact.failed_at    = new Date();
      contact.next_send_at = null;
      await contact.save();
      throw new UnrecoverableError(`Hard Bounce (5xx): ${err.message}`);
    }

    if (contact.consecutive_failures >= 5) {
      contact.status       = ContactEnrollmentStatus.FAILED;
      contact.failed_at    = new Date();
      contact.next_send_at = null;
      await contact.save();
      throw new UnrecoverableError(`SMTP failed 5 times for ${contact.contact_email}. Last error: ${err.message}`);
    }

    await contact.save();
    throw err; // Re-throw 4xx or other errors → BullMQ retries with backoff
  }

  // 5. Update SendingLog → sent
  await SendingLog.updateOne(
    { _id: sendingLog._id },
    {
      subject:            rendered.subject,
      body_html_snapshot: rendered.body_html,
      body_text_snapshot: rendered.body_text,
      status:             SendStatus.SENT,
      sent_at:            new Date(),
    }
  );

  // Update connection stats
  await EmailConnection.updateOne(
    { _id: connectionId },
    { $inc: { total_sent: 1 }, last_used_at: new Date() }
  );

  // Update sequence stats
  await Sequence.updateOne(
    { _id: contact.sequence_id },
    { $inc: { 'stats.total_sent': 1 } }
  );

  // 6. Advance contact to next step
  const allSteps = await SequenceStep.find({
    sequence_id: contact.sequence_id,
    is_active:   true,
  }).sort({ step_index: 1 });

  await enrollmentService.advanceContact(
    contact,
    stepIndex,
    messageId,
    allSteps,
    sequence.sending_window as any
  );

  logger.info('Email sent successfully', {
    to:         contact.contact_email,
    subject:    rendered.subject,
    stepIndex,
    messageId,
    contactId:  contact._id,
    sequenceId: contact.sequence_id,
  });
}

// ─── Worker ───────────────────────────────────────────────────────
let worker: Worker | null = null;

export function startEmailWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(QUEUE_NAME, processEmailSend, {
      connection: makeBullConnection(),
      concurrency: CONCURRENCY,
      lockDuration: 120_000, // 2 min per send
      limiter:      { max: 10, duration: 1000 }, // max 10 sends/sec globally
    });

    worker.on('ready', () => logger.info(`✅ Email worker ready [concurrency=${CONCURRENCY}, queue=${QUEUE_NAME}]`));
    worker.on('error', (err: Error) => {
      // Log even in dev — these indicate real queue configuration problems
      logger.error('Email worker error', { error: err.message });
    });
    worker.on('active', (job) => {
      logger.info('Email worker: job ACTIVE (processing started)', {
        jobId:    job.id,
        jobName:  job.name,
        attempt:  job.attemptsMade + 1,
        payload:  job.data,
      });
    });
    worker.on('completed', (job) => {
      logger.info('Email worker: job COMPLETED ✅', {
        jobId:   job.id,
        jobName: job.name,
      });
    });
    worker.on('failed', (job, err: Error) => {
      logger.error('Email worker: job FAILED ❌', {
        jobId:    job?.id,
        attempt:  job?.attemptsMade,
        error:    err.message,
        isUnrecoverable: err.name === 'UnrecoverableError',
      });
    });
    worker.on('stalled', (jobId) => {
      logger.warn('Email worker: job STALLED ⚠️', { jobId });
    });

    logger.info(`🚀 Email worker started on queue: ${QUEUE_NAME} [concurrency=${CONCURRENCY}]`);
  } catch (err) {
    const error = err as Error;
    if (isDev) {
      logger.warn(`⚠️  Email worker could not start (Redis unavailable): ${error.message}`);
      return null;
    }
    throw err;
  }

  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Email worker stopped gracefully');
  }
}
