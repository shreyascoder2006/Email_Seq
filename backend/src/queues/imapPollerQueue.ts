import { Queue, Worker, Job } from 'bullmq';
import { BULL_REDIS_URL, BULL_REDIS_TLS } from '../config/redis';
import { EmailConnection, ConnectionStatus } from '../models/EmailConnection';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { SendingLog } from '../models/SendingLog';
import { ReplyLog, ReplyClassification } from '../models/ReplyLog';
import { Sequence } from '../models/Sequence';
import { emailConnectionService } from '../services/emailConnection.service';
import { env, isDev } from '../config/env';
import logger from '../config/logger';
import { ImapFlow } from 'imapflow';

// ─── Constants ─────────────────────────────────────────────────────
const IMAP_SCHEDULER_QUEUE = 'imap-scheduler';
const IMAP_POLL_QUEUE      = 'imap-poll';
const IMAP_POLL_INTERVAL   = 10; // minutes

function makeConnection() {
  const url = new URL(BULL_REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    ...(BULL_REDIS_TLS ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: isDev ? () => null : undefined,
  };
}

let imapSchedulerQueue: Queue | null = null;
let imapPollQueue: Queue | null = null;
let schedulerWorker: Worker | null = null;
let pollWorker: Worker | null = null;

// ─── Job Processors ────────────────────────────────────────────────

/**
 * 1. The Scheduler Tick
 * Runs every 10 minutes. Finds all active IMAP connections and spawns a poll job for each.
 */
async function runImapScheduler(_job: Job): Promise<void> {
  logger.debug('IMAP Scheduler tick — checking for active IMAP connections');

  const activeConnections = await EmailConnection.find({
    status: ConnectionStatus.ACTIVE,
    imap_host: { $exists: true, $ne: '' },
    imap_username: { $exists: true, $ne: '' },
  }).select('_id').lean();

  if (activeConnections.length === 0) return;

  const jobs = activeConnections.map((conn) => ({
    name: 'imap:poll',
    data: { connectionId: conn._id.toString() },
    opts: {
      jobId: `imap:poll:${conn._id}`, // Deduplicate if previous poll is still running
      removeOnComplete: true,
      removeOnFail: 100,
    },
  }));

  if (imapPollQueue) {
    await imapPollQueue.addBulk(jobs);
    logger.debug(`IMAP Scheduler: Enqueued ${jobs.length} poll jobs`);
  }
}

/**
 * 2. The IMAP Poller
 * Connects to a specific account, fetches unseen replies, matches them, creates ReplyLogs.
 */
async function processImapPoll(job: Job): Promise<void> {
  const { connectionId } = job.data as { connectionId: string };

  const connection = await EmailConnection.findById(connectionId);
  if (!connection || connection.status !== ConnectionStatus.ACTIVE || !connection.imap_host) {
    return;
  }

  logger.info(`Polling IMAP for connection: ${connection.label} (${connection.from_email})`);

  let imapPassword = '';
  try {
    const creds = await emailConnectionService.getDecryptedCredentials(
      connection.user_id.toString(),
      connection._id.toString()
    );
    imapPassword = creds.imapPassword || creds.smtpPassword || ''; // Fallback to SMTP password if IMAP isn't separate
  } catch (err) {
    logger.error(`Failed to decrypt credentials for IMAP: ${connection.label}`, { error: (err as Error).message });
    return;
  }

  const client = new ImapFlow({
    host: connection.imap_host,
    port: connection.imap_port || 993,
    secure: connection.imap_encryption === 'ssl' || connection.imap_encryption === 'tls' || connection.imap_port === 993,
    auth: {
      user: connection.imap_username || connection.smtp_username || connection.from_email,
      pass: imapPassword,
    },
    tls: {
      rejectUnauthorized: connection.provider !== 'custom',
    },
    logger: false, // Too noisy
  });

  try {
    await client.connect();
    
    // Select inbox and open it read-only so we don't accidentally mark emails as SEEN
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Find emails received since last poll, or UNSEEN
      // To avoid processing thousands of old emails on first sync, we limit to unseen emails
      // and optionally a SINCE date.
      
      const sinceDate = connection.last_imap_poll_at || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago max

      // Search for emails
      const searchCriteria = {
        unseen: true,
        since: sinceDate,
      };

      // Fetch envelope headers: In-Reply-To, References, Message-ID, Subject, From
      const fetchGenerator = client.fetch(searchCriteria, { envelope: true, uid: true });

      let parsedCount = 0;
      let matchedCount = 0;

      for await (const msg of fetchGenerator) {
        parsedCount++;
        
        const inReplyTo = msg.envelope?.inReplyTo;
        const messageId = msg.envelope?.messageId;
        
        if (!inReplyTo) continue;

        // Clean up In-Reply-To (often wrapped in <>)
        const cleanInReplyTo = inReplyTo.replace(/[<>]/g, '');

        // Match against our SendingLog
        const sendingLog = await SendingLog.findOne({
          email_connection_id: connection._id,
          message_id: { $regex: new RegExp(cleanInReplyTo, 'i') }, // Match partial/exact
        });

        if (sendingLog) {
          // It's a reply!
          matchedCount++;
          
          // Check if we already logged this exact reply (deduplication)
          const existingReply = await ReplyLog.exists({
            sending_log_id: sendingLog._id,
            message_id: messageId,
          });

          if (!existingReply) {
            // Log it
            const fromAddress = msg.envelope?.from?.[0]?.address || 'unknown';
            const fromName    = msg.envelope?.from?.[0]?.name || '';

            await ReplyLog.create({
              sequence_id:         sendingLog.sequence_id,
              sequence_contact_id: sendingLog.sequence_contact_id,
              sending_log_id:      sendingLog._id,
              user_id:             sendingLog.user_id,
              from_email:          fromAddress,
              from_name:           fromName,
              to_email:            sendingLog.from_email,
              subject:             msg.envelope?.subject || 'Re: Unknown',
              message_id:          messageId,
              in_reply_to:         inReplyTo,
              replied_to_step_index: sendingLog.step_index,
              classification:      ReplyClassification.UNKNOWN, // Ready for future AI parsing
              imap_uid:            msg.uid,
              received_at:         msg.envelope?.date || new Date(),
            });

            // Mark SequenceContact as replied
            await SequenceContact.updateOne(
              { _id: sendingLog.sequence_contact_id },
              { 
                status: ContactEnrollmentStatus.REPLIED,
                has_replied: true,
                next_send_at: null, // Halts further emails
              }
            );

            // Update stats
            await Sequence.updateOne(
              { _id: sendingLog.sequence_id },
              { $inc: { 'stats.replies': 1 } }
            );

            logger.info(`Recorded reply for contact ${sendingLog.to_email}`, { sequenceContactId: sendingLog.sequence_contact_id });
          }
        }
      }

      logger.debug(`IMAP poll complete for ${connection.label}: Scanned ${parsedCount}, Matched ${matchedCount}`);
      
      // Update the last poll timestamp
      connection.last_imap_poll_at = new Date();
      await connection.save();

    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error(`IMAP connection error for ${connection.label}:`, { error: (err as Error).message });
    // Do not crash the worker. BullMQ will try again later if it fails or just on the next scheduler tick.
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors
    }
  }
}

// ─── Start / Stop Lifecycle ────────────────────────────────────────

export function startImapPoller() {
  try {
    const conn = makeConnection();

    imapSchedulerQueue = new Queue(IMAP_SCHEDULER_QUEUE, { connection: conn });
    imapPollQueue      = new Queue(IMAP_POLL_QUEUE, { connection: conn });

    schedulerWorker = new Worker(IMAP_SCHEDULER_QUEUE, runImapScheduler, {
      connection: conn,
      concurrency: 1,
    });

    pollWorker = new Worker(IMAP_POLL_QUEUE, processImapPoll, {
      connection: conn,
      concurrency: parseInt(env.QUEUE_CONCURRENCY || '5', 10),
      limiter: { max: 5, duration: 1000 }, // Prevent IMAP server connection spamming
    });

    // Error handlers
    schedulerWorker.on('error', (err) => {
      if (!isDev) logger.error('IMAP Scheduler worker error', { error: err.message });
    });
    pollWorker.on('error', (err) => {
      if (!isDev) logger.error('IMAP Poll worker error', { error: err.message });
    });

    // Register repeatable job
    imapSchedulerQueue.add(
      'imap-scheduler:tick',
      {},
      {
        repeat: { every: IMAP_POLL_INTERVAL * 60 * 1000 },
        jobId: 'imap-scheduler-singleton',
        removeOnComplete: 5,
        removeOnFail: 5,
      }
    ).then(() => {
      logger.info(`⏱  IMAP Scheduler registered — tick every ${IMAP_POLL_INTERVAL} min`);
    }).catch((err) => {
      if (!isDev) logger.error('Failed to register IMAP scheduler', { error: err.message });
    });

    logger.info('✅ IMAP Poller workers started');

  } catch (err) {
    if (isDev) {
      logger.warn(`⚠️  IMAP Poller could not start (Redis unavailable): ${(err as Error).message}`);
    } else {
      throw err;
    }
  }
}

export async function stopImapPoller(): Promise<void> {
  await Promise.allSettled([
    schedulerWorker?.close(),
    pollWorker?.close(),
    imapSchedulerQueue?.close(),
    imapPollQueue?.close(),
  ]);
  logger.info('IMAP Poller shut down');
}
