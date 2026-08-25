import { Queue, Worker, QueueEvents, Job, ConnectionOptions, UnrecoverableError } from 'bullmq';
import { BULL_REDIS_TLS, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, redisClient } from '../config/redis';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { SequenceStep } from '../models/SequenceStep';
import { Sequence } from '../models/Sequence';
import { EmailConnection, ConnectionStatus } from '../models/EmailConnection';
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
import { generateUnsubscribeToken } from '../utils/unsubscribeToken';

const QUEUE_NAME       = env.EMAIL_QUEUE_NAME;
const CONCURRENCY      = parseInt(env.QUEUE_CONCURRENCY,   10);
const RETRY_ATTEMPTS   = parseInt(env.RETRY_ATTEMPTS,      10);
const RETRY_BACKOFF_DELAY = parseInt(env.RETRY_BACKOFF_DELAY, 10);

// ─── In-memory worker health state ────────────────────────────────
export interface WorkerHealth {
  workerRunning:              boolean;
  workerClosed:               boolean;
  redisConnected:             boolean;
  queueName:                  string;
  concurrency:                number;
  lastJobProcessedAt:         string | null;
  startedAt:                  string | null;
  lastJobStartedAt:           string | null;
  lastJobCompletedAt:         string | null;
  lastJobFailedAt:            string | null;
  lastProcessedContactId:     string | null;
  lastSuccessfulEmailSentAt:  string | null;
  lastSuccessfulEmailSentTo:  string | null;
  lastSuccessfulSequenceId:   string | null;
}

const workerHealth: WorkerHealth = {
  workerRunning:              false,
  workerClosed:               false,
  redisConnected:             false,
  queueName:                  QUEUE_NAME,
  concurrency:                CONCURRENCY,
  lastJobProcessedAt:         null,
  startedAt:                  null,
  lastJobStartedAt:           null,
  lastJobCompletedAt:         null,
  lastJobFailedAt:            null,
  lastProcessedContactId:     null,
  lastSuccessfulEmailSentAt:  null,
  lastSuccessfulEmailSentTo:  null,
  lastSuccessfulSequenceId:   null,
};

export function getWorkerHealth(): Readonly<WorkerHealth> {
  return { ...workerHealth };
}

export function recordSuccessfulEmailSend(to: string, sequenceId: string) {
  workerHealth.lastSuccessfulEmailSentAt = new Date().toISOString();
  workerHealth.lastSuccessfulEmailSentTo = to;
  workerHealth.lastSuccessfulSequenceId  = sequenceId;
}

// ─── Connection factory ────────────────────────────────────────────
// CRITICAL: Every BullMQ instance (Queue, Worker, QueueEvents) MUST
// receive its own independent connection object. Sharing causes the
// Worker's blocking-poll client to collide and silently stop consuming.
function makeConnection(label: string): ConnectionOptions {
  // Use pre-resolved REDIS_HOST (127.0.0.1, not 'localhost') to avoid
  // Node's IPv6-first DNS resolving localhost → ::1 while Memurai binds 127.0.0.1.
  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    ...(BULL_REDIS_TLS ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 500, 30_000);
      logger.warn(`[EMAIL-CONN:${label}] Redis reconnect attempt #${times} in ${delay}ms`, {
        host: REDIS_HOST, port: REDIS_PORT,
      });
      return delay;
    },
  };
}

// ─── Queue instance ────────────────────────────────────────────────
export const emailQueue = new Queue(QUEUE_NAME, {
  connection: makeConnection('email-queue'),
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
  connection: makeConnection('email-queueevents'),
});

emailQueueEvents.on('completed', ({ jobId }) => {
  logger.info('📤 Email job completed', { jobId });
});

emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error('❌ Email job failed', { jobId, failedReason });
});

// ─── Enqueue Helper ───────────────────────────────────────────────
export async function enqueueEmailJob(
  contactId: string,
  stepIndex: number,
  nextSendAt: Date,
  sequenceId: string,
  scheduleVersion: number,
  tickSource: string = 'delay_engine'
): Promise<string | undefined> {
  // CIRCUIT BREAKER: Prevent memory exhaustion if Redis is down.
  // If Redis is offline, do NOT attempt to enqueue. queue.add() will hang indefinitely 
  // (buffering in ioredis) while retrying, crashing the Node server if traffic is high.
  if (redisClient.status !== 'ready') {
    throw new Error('Circuit Breaker Open: Redis is currently offline. Cannot enqueue job.');
  }

  const now = Date.now();
  const nextSendAtTimestamp = nextSendAt.getTime();
  const delayMs = Math.max(0, nextSendAtTimestamp - now);
  
  const job = await emailQueue.add(
    'email:send',
    {
      sequenceContactId: contactId,
      stepIndex,
      tickSource,
      sequenceId,
      scheduleVersion,
    },
    {
      delay: delayMs,
    }
  );

  logger.info('🕒 Enqueued delayed email job', {
    jobId: job.id,
    contactId,
    stepIndex,
    delayMs,
    scheduleVersion,
    scheduledFor: nextSendAt.toISOString(),
  });

  return job.id;
}

// ─── Email Send Processor ─────────────────────────────────────────
// Exported so debug endpoints can invoke it directly without BullMQ.
export async function processEmailSend(job: Job): Promise<void> {
  const { sequenceContactId, stepIndex, tickSource, sequenceId, scheduleVersion } = job.data as {
    sequenceContactId: string;
    stepIndex:         number;
    tickSource?:       string;
    sequenceId?:       string;
    scheduleVersion?:  number;
  };

  logger.info('📨 Email worker: job received', {
    pickupTimestamp: new Date().toISOString(),
    tickSource: tickSource || 'unknown',
    jobId: job.id,
    sequenceId: sequenceId || 'unknown',
    contactId: sequenceContactId,
    stepId: stepIndex, // Using index as step reference for now
  });

  // 1. Re-fetch contact (idempotency check) and apply lock
  const contact = await SequenceContact.findOneAndUpdate(
    { _id: sequenceContactId, sending_locked: false },
    { 
      $set: { 
        sending_locked: true, 
        current_job_id: job.id, 
        job_state: 'processing', 
        last_attempt_at: new Date() 
      } 
    },
    { new: true }
  );

  if (!contact) {
    const existing = await SequenceContact.findById(sequenceContactId);
    if (!existing) {
      logger.warn('Email worker: contact not found — marking UnrecoverableError', { sequenceContactId });
      throw new UnrecoverableError(`Contact ${sequenceContactId} not found — skipping`);
    } else if (existing.sending_locked) {
      logger.warn('Email worker: contact is currently locked by another process — throwing transient error to retry', { sequenceContactId });
      throw new Error(`Contact ${sequenceContactId} is currently locked by another process`);
    }
    return;
  }

  logger.info('Email worker: contact loaded and locked', {
    contactId: contact._id,
    email: contact.contact_email,
    status: contact.status,
    current_step_index: contact.current_step_index,
  });

  try {

  // Validate schedule version
  if (scheduleVersion !== undefined && scheduleVersion !== contact.schedule_version) {
    logger.debug('Email worker: ignoring stale job due to schedule_version mismatch', {
      sequenceContactId,
      jobScheduleVersion: scheduleVersion,
      contactScheduleVersion: contact.schedule_version,
    });
    return; // Job is stale, ignore it
  }

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
    sequenceId: contact.sequence_id.toString(),
    sequenceFound: !!sequence,
    stepFound: !!step,
    stepType: step?.type,
    email_connection_id_on_step: (step as any)?.email_connection_id,
    email_connection_id_on_contact: contact.email_connection_id,
  });

  if (!step || !sequence) {
    logger.error('Email worker: step or sequence not found — UnrecoverableError', {
      sequenceContactId,
      stepIndex,
      sequenceId: contact.sequence_id.toString(),
      sequenceFound: !!sequence,
      stepFound: !!step,
    });

    // Mark the contact as failed in the DB so it is not retried/enqueued again
    contact.status = ContactEnrollmentStatus.FAILED;
    contact.failed_at = new Date();
    contact.last_error = 'Step or sequence not found';
    contact.next_send_at = null;
    await contact.save();

    throw new UnrecoverableError(`Step or sequence not found — marking contact failed`);
  }

  // 3. Ownership Integrity Check - Documents
  if (!sequence.user_id.equals(contact.user_id) || !sequence.user_id.equals(step.user_id)) {
    const errorMsg = `Ownership mismatch: Sequence (${sequence.user_id}), Contact (${contact.user_id}), Step (${step.user_id})`;
    logger.error('Email worker: ownership mismatch — UnrecoverableError', { sequenceContactId, errorMsg });
    
    contact.status = ContactEnrollmentStatus.FAILED;
    contact.failed_at = new Date();
    contact.last_error = errorMsg;
    contact.next_send_at = null;
    await contact.save();

    throw new UnrecoverableError(errorMsg);
  }

  // ⚠️ Critical: prefer step-level connection, fall back to sequence-level.
  // We strictly ignore contact.email_connection_id to avoid data drift.
  const connectionId = (step as any).email_connection_id ?? sequence.email_connection_id;
  const senderSource = (step as any).email_connection_id ? 'step' : 'fallback_sequence';

  if (!connectionId) {
    logger.error('Email worker: no email_connection_id found on step or sequence — UnrecoverableError', {
      stepId: step._id,
      sequenceContactId,
      stepIndex,
    });

    // CRITICAL: Mark contact as failed so the scheduler does not pick it up again
    contact.status = ContactEnrollmentStatus.FAILED;
    contact.failed_at = new Date();
    contact.last_error = `No email_connection_id on step ${step._id} or sequence. Edit sequence step to select sender.`;
    contact.next_send_at = null;
    await contact.save();

    throw new UnrecoverableError(
      `No email_connection_id on step ${step._id} or sequence. ` +
      `Edit the sequence step and re-select the sending account.`
    );
  }

  const [template, connection] = await Promise.all([
    step.template_id ? Template.findById(step.template_id) : null,
    EmailConnection.findById(connectionId),
  ]);

  logger.info('Email worker: Diagnostics Check - Resolved Sender', {
    sequenceId: contact.sequence_id.toString(),
    contactId: contact._id.toString(),
    stepId: step._id.toString(),
    resolved_email_connection_id: connectionId.toString(),
    resolved_sender_email: connection?.from_email || 'NOT_FOUND',
    sender_source: senderSource,
    smtpHost: connection?.smtp_host,
    smtpPort: connection?.smtp_port,
    accountStatus: connection?.status || 'NOT_FOUND',
  });

  if (!connection) {
    logger.error('Email worker: email connection not found — UnrecoverableError', { connectionId });
    throw new UnrecoverableError(`Email connection ${connectionId} not found`);
  }

  // 4. Ownership Integrity Check - Dependencies
  if (!sequence.user_id.equals(connection.user_id)) {
    const errorMsg = `Ownership mismatch: EmailConnection (${connection.user_id}) does not match Sequence (${sequence.user_id})`;
    logger.error('Email worker: ownership mismatch — UnrecoverableError', { sequenceContactId, errorMsg });
    contact.status = ContactEnrollmentStatus.FAILED;
    contact.failed_at = new Date();
    contact.last_error = errorMsg;
    contact.next_send_at = null;
    await contact.save();
    throw new UnrecoverableError(errorMsg);
  }

  if (template && !sequence.user_id.equals(template.user_id)) {
    const errorMsg = `Ownership mismatch: Template (${template.user_id}) does not match Sequence (${sequence.user_id})`;
    logger.error('Email worker: ownership mismatch — UnrecoverableError', { sequenceContactId, errorMsg });
    contact.status = ContactEnrollmentStatus.FAILED;
    contact.failed_at = new Date();
    contact.last_error = errorMsg;
    contact.next_send_at = null;
    await contact.save();
    throw new UnrecoverableError(errorMsg);
  }

  if (connection.status !== ConnectionStatus.ACTIVE) {
    logger.error('Email worker: email connection inactive — UnrecoverableError', { connectionId, status: connection.status });
    throw new UnrecoverableError(`Email connection ${connectionId} is inactive`);
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

  // Generate HMAC-SHA256 unsubscribe token before rendering so the footer URL is correct
  const unsubscribeToken = generateUnsubscribeToken(
    contact._id.toString(),
    contact.sequence_id.toString()
  );
  const unsubscribeUrl = `${env.APP_BASE_URL}/api/unsubscribe/${unsubscribeToken}`;

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
      unsubscribeUrl,
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
      // is_first_click starts false; trackClick() flips it to true on the first
      // actual click so analytics can safely filter { is_first_click: true }.
      is_first_click:      false,
      click_count:         0,
    }));
    await ClickLog.insertMany(clickLogsToInsert, { lean: false });
  }

  // 4. Send via Nodemailer
  const { smtpPassword, oauthRefreshToken } = await emailConnectionService.getDecryptedCredentials(
    contact.user_id.toString(),
    connectionId.toString()
  );

  let authConfig: any;
  if (connection.auth_method === 'oauth2') {
    authConfig = {
      type: 'OAuth2',
      user: connection.from_email,
      clientId: connection.provider === 'gmail' ? env.GOOGLE_CLIENT_ID : env.MICROSOFT_CLIENT_ID,
      clientSecret: connection.provider === 'gmail' ? env.GOOGLE_CLIENT_SECRET : env.MICROSOFT_CLIENT_SECRET,
      refreshToken: oauthRefreshToken,
    };
  } else {
    authConfig = {
      user: connection.smtp_username,
      pass: smtpPassword,
    };
  }

  // --- DIAGNOSTIC 1: Log Sender Resolution ---
  logger.info('\n\n=== DIAGNOSTIC 1: SENDER RESOLUTION ===', {
    connectionId: connectionId.toString(),
    senderSource,
    smtpHost: connection.smtp_host,
    smtpPort: connection.smtp_port,
    encryptionType: connection.smtp_encryption,
    secureFlag: connection.smtp_encryption === 'ssl',
    smtpUsername: connection.smtp_username,
    fromEmail: connection.from_email,
    replyTo: connection.reply_to || connection.from_email,
    passwordLength: smtpPassword ? smtpPassword.length : 0,
    tlsRejectUnauthorized: connection.provider !== 'custom'
  });

  const transporter = nodemailer.createTransport({
    host:   connection.smtp_host,
    port:   connection.smtp_port,
    secure: connection.smtp_encryption === 'ssl',
    auth:   authConfig,
    tls: {
      rejectUnauthorized: connection.provider !== 'custom',
    },
    connectionTimeout: 15_000,
  });

  const mailOptions = {
    from:    `"${connection.from_name}" <${connection.from_email}>`,
    replyTo: connection.reply_to || connection.from_email,
    to:      contact.contact_email,
    cc:      (step as any).cc?.length ? (step as any).cc : undefined,
    bcc:     (step as any).bcc?.length ? (step as any).bcc : undefined,
    subject: rendered.subject,
    html:    rendered.body_html,
    text:    rendered.body_text || undefined,
    messageId: messageId,
    headers: {
      // RFC 2369 — enables native Unsubscribe button in Gmail / Apple Mail
      'List-Unsubscribe':      `<${unsubscribeUrl}>`,
      // RFC 8058 — enables one-click unsubscribe for mail clients
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Mailer':              'EmailSequencer v1.0',
      'X-Sequence-ID':         contact.sequence_id.toString(),
      // X-Contact-ID intentionally omitted — exposing internal IDs violates security policy
    },
  };

  // --- DIAGNOSTIC 2: Log Mail Payload ---
  logger.info('\n\n=== DIAGNOSTIC 2: MAIL PAYLOAD ===', {
    from: mailOptions.from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    envelope: (mailOptions as any).envelope,
    replyTo: mailOptions.replyTo,
    cc: mailOptions.cc,
    bcc: mailOptions.bcc,
    attachmentsCount: 0,
    headerNames: Object.keys(mailOptions.headers),
    messageId: mailOptions.messageId
  });

  // --- DIAGNOSTIC 3: Verify SMTP Again ---
  try {
    await transporter.verify();
    logger.info('\n\n=== DIAGNOSTIC 3: VERIFY PASSED ===');
  } catch (vErr: any) {
    logger.error('\n\n=== DIAGNOSTIC 3: VERIFY FAILED ===', { error: vErr.message });
  }

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
    const info = await transporter.sendMail(mailOptions);
    
    // --- DIAGNOSTIC 5: Log Successful Sends ---
    logger.info('\n\n=== DIAGNOSTIC 5: SEND SUCCESS ===', {
      accepted: info.accepted,
      rejected: info.rejected,
      pending: info.pending,
      envelope: info.envelope,
      messageId: info.messageId,
      response: info.response
    });

    logger.info('Email worker: SMTP send SUCCESS ✅', {
      to:       contact.contact_email,
      subject:  rendered.subject,
      messageId,
    });
    transporter.close();

    // Track successful send metrics
    recordSuccessfulEmailSend(contact.contact_email, contact.sequence_id.toString());
  } catch (err: any) {
    // --- DIAGNOSTIC 4: Capture Complete Nodemailer Error ---
    logger.error('\n\n=== DIAGNOSTIC 4: COMPLETE ERROR OBJECT ===', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
      rejected: err.rejected,
      rejectedErrors: err.rejectedErrors,
      stack: err.stack
    });
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

    // Handle OAuth revocation / Auth failures
    const errMsg = err.message || '';
    const isOauthError = errMsg.includes('invalid_grant') || errMsg.includes('invalid_client') || errMsg.includes('unauthorized_client');
    const isAuthError = err.responseCode === 535 || isOauthError;

    if (isAuthError) {
      // Mark connection as failed to prevent further sends
      connection.status = ConnectionStatus.FAILED;
      connection.failure_reason = `Authentication failed: ${errMsg}`;
      await connection.save();

      // Pause the contact since the whole sender is broken
      contact.status = ContactEnrollmentStatus.FAILED;
      contact.failed_at = new Date();
      contact.last_error = `Sender authentication failed: ${errMsg}`;
      contact.next_send_at = null;
      await contact.save();
      
      throw new UnrecoverableError(`Authentication failed for sender ${connection.from_email}. Connection marked as failed.`);
    }

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
    sequence.sending_window as any,
    sequence.launch_date
  );

  // Enqueue next step if active
  if (contact.status === ContactEnrollmentStatus.ACTIVE && contact.next_send_at) {
    const nextJobId = await enqueueEmailJob(
      contact._id.toString(), 
      contact.current_step_index, 
      contact.next_send_at, 
      contact.sequence_id.toString(),
      contact.schedule_version
    );
    if (nextJobId) {
      await SequenceContact.updateOne(
        { _id: contact._id },
        { $set: { current_job_id: nextJobId, job_scheduled_at: new Date() } }
      );
    }
  }

  logger.info('Email sent successfully', {
    to:         contact.contact_email,
    subject:    rendered.subject,
    stepIndex,
    messageId,
    contactId:  contact._id,
    sequenceId: contact.sequence_id,
  });

  } finally {
    // Release the idempotency lock
    await SequenceContact.updateOne(
      { _id: sequenceContactId }, 
      { $set: { sending_locked: false, job_state: 'completed' } }
    );
  }
}

// ─── Worker ───────────────────────────────────────────────────────
let worker: Worker | null = null;

export function startEmailWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(QUEUE_NAME, processEmailSend, {
      connection: makeConnection('email-worker'),
      concurrency: CONCURRENCY,
      lockDuration: 120_000, // 2 min per send
      limiter:      { max: 10, duration: 1000 }, // max 10 sends/sec globally
    });

    // ── Lifecycle: ready ──────────────────────────────────────────
    worker.on('ready', () => {
      workerHealth.workerRunning  = true;
      workerHealth.workerClosed   = false;
      workerHealth.redisConnected = true;
      workerHealth.startedAt      = new Date().toISOString();
      
      // Worker Startup Verification
      if (workerHealth.redisConnected && workerHealth.workerRunning) {
        logger.info('WORKER STARTUP CHECK PASSED: Redis connected, queue accessible, worker registered.', {
          timestamp:   workerHealth.startedAt,
          queueName:   QUEUE_NAME,
          concurrency: CONCURRENCY,
        });
      }
    });

    // ── Lifecycle: active ─────────────────────────────────────────
    worker.on('active', (job) => {
      const { sequenceContactId, stepIndex } = (job.data ?? {}) as {
        sequenceContactId?: string;
        stepIndex?:         number;
      };
      workerHealth.lastJobStartedAt = new Date().toISOString();
      logger.info('Email worker: job ACTIVE (processing started)', {
        jobId:             job.id,
        jobName:           job.name,
        attempt:           job.attemptsMade + 1,
        contactId:         sequenceContactId ?? null,
        stepIndex:         stepIndex         ?? null,
        timestamp:         workerHealth.lastJobStartedAt,
      });
    });

    // ── Lifecycle: completed ──────────────────────────────────────
    worker.on('completed', (job) => {
      const { sequenceContactId } = (job.data ?? {}) as { sequenceContactId?: string };
      workerHealth.lastJobProcessedAt = new Date().toISOString();
      workerHealth.lastJobCompletedAt = workerHealth.lastJobProcessedAt;
      if (sequenceContactId) workerHealth.lastProcessedContactId = sequenceContactId;

      logger.info('Email worker: job COMPLETED ✅', {
        jobId:     job.id,
        jobName:   job.name,
        contactId: sequenceContactId ?? null,
        timestamp: workerHealth.lastJobProcessedAt,
      });
    });

    // ── Lifecycle: failed ─────────────────────────────────────────
    worker.on('failed', async (job, err: Error) => {
      const { sequenceContactId } = (job?.data ?? {}) as { sequenceContactId?: string };
      workerHealth.lastJobProcessedAt = new Date().toISOString();
      workerHealth.lastJobFailedAt = workerHealth.lastJobProcessedAt;
      if (sequenceContactId) workerHealth.lastProcessedContactId = sequenceContactId;

      const isUnrecoverable = err.name === 'UnrecoverableError';

      logger.error('Email worker: job FAILED ❌', {
        jobId:           job?.id               ?? null,
        contactId:       sequenceContactId      ?? null,
        attempt:         job?.attemptsMade      ?? null,
        error:           err.message,
        isUnrecoverable: isUnrecoverable,
        timestamp:       workerHealth.lastJobProcessedAt,
      });

      // Update sequence integrity state if unrecoverable
      if (isUnrecoverable && sequenceContactId) {
        try {
          const contact = await SequenceContact.findById(sequenceContactId).select('sequence_id').lean();
          if (contact && contact.sequence_id) {
            await Sequence.updateOne(
              { _id: contact.sequence_id },
              {
                $set: {
                  needs_attention: true,
                  integrity_error: true,
                  last_integrity_error: err.message
                }
              }
            );
          }
        } catch (dbErr) {
          logger.error('Email worker: failed to flag sequence integrity error', { error: dbErr });
        }
      }
    });

    // ── Lifecycle: stalled ────────────────────────────────────────
    worker.on('stalled', (jobId: string) => {
      logger.warn('Email worker: job STALLED ⚠️', {
        jobId,
        timestamp: new Date().toISOString(),
      });
    });

    // ── Lifecycle: error ──────────────────────────────────────────
    worker.on('error', (err: unknown) => {
      // A connection-level error, not a per-job failure.
      const aggregateErr = err as { errors?: Error[]; message?: string };
      if (Array.isArray(aggregateErr?.errors)) {
        workerHealth.redisConnected = false;
        aggregateErr.errors.forEach((sub: Error, i: number) => {
          const code = (sub as NodeJS.ErrnoException).code;
          logger.error(`Email worker: AggregateError[${i}]`, {
            name: sub.name, message: sub.message, code,
            worker: 'email-worker', host: REDIS_HOST, port: REDIS_PORT,
          });
        });
        return;
      }
      const e = err as NodeJS.ErrnoException;
      const isRedisErr = /ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT/i.test(e.message ?? '');
      if (isRedisErr) workerHealth.redisConnected = false;
      logger.error('Email worker: connection/runtime error', {
        name: e.name, message: e.message, code: e.code,
        worker: 'email-worker', host: REDIS_HOST, port: REDIS_PORT,
        redisStatus: redisClient.status,
        timestamp: new Date().toISOString(),
      });
    });

    // ── Lifecycle: closed ─────────────────────────────────────────
    worker.on('closed', () => {
      workerHealth.workerRunning = false;
      workerHealth.workerClosed  = true;
      logger.info('Email worker: worker CLOSED', {
        timestamp: new Date().toISOString(),
      });
    });

    workerHealth.workerRunning  = true;
    workerHealth.workerClosed   = false;
    workerHealth.redisConnected = true;
    workerHealth.startedAt      = workerHealth.startedAt ?? new Date().toISOString();

    logger.info(`🚀 Email worker started on queue: ${QUEUE_NAME} [concurrency=${CONCURRENCY}]`);
  } catch (err) {
    const error = err as Error;
    workerHealth.workerRunning = false;
    logger.error(`WORKER STARTUP CHECK FAILED: ${error.message}`);
    if (isDev) {
      logger.warn(`⚠️  Email worker could not start (Redis unavailable): ${error.message}`);
      return null;
    }
    throw err;
  }

  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  await Promise.allSettled([
    worker?.close(),
    emailQueueEvents.close(),
  ]);

  if (worker) {
    worker = null;
    workerHealth.workerRunning = false;
    workerHealth.workerClosed  = true;
    logger.info('Email worker stopped gracefully', { timestamp: new Date().toISOString() });
  }
}
