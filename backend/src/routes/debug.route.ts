/**
 * src/routes/debug.route.ts
 *
 * ⚠️  DEVELOPMENT ONLY — automatically returns 404 in production.
 *
 * Endpoints (no JWT required):
 *
 *   POST /api/debug/send-test-email
 *     Bypasses scheduler + BullMQ entirely. Uses global SMTP from .env.
 *     Proves SMTP credentials work end-to-end.
 *
 *   GET  /api/debug/queue-status
 *     Live BullMQ queue counts, paused state, recent jobs with state/reason.
 *
 *   POST /api/debug/process-contact
 *     Bypasses the scheduler AND BullMQ. Directly invokes the same
 *     processEmailSend() function the worker uses. Pinpoints exactly
 *     which stage of the pipeline fails: DB load → render → SMTP send.
 */

import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { env } from '../config/env';
import logger from '../config/logger';

const router = Router();

// ─── Block in production ───────────────────────────────────────────
if (env.NODE_ENV === 'production') {
  router.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Not found' });
  });
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/debug/send-test-email
// Uses global SMTP from .env — identical config to the email worker.
// No JWT, no scheduler, no BullMQ.
// ═══════════════════════════════════════════════════════════════════
router.post('/send-test-email', async (req: Request, res: Response) => {
  try {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);

    const smtpHost   = env.SMTP_HOST;
    const smtpPort   = parseInt(env.SMTP_PORT, 10);
    const smtpSecure = env.SMTP_SECURE === 'true';
    const smtpUser   = env.SMTP_USER   ?? '';
    const smtpPass   = env.SMTP_PASS   ?? '';
    const fromName   = env.SMTP_FROM_NAME;
    const fromEmail  = env.SMTP_FROM_EMAIL ?? smtpUser;

    logger.info('🔬 Debug send-test-email: building transporter', {
      smtpHost, smtpPort, smtpSecure, smtpUser, to,
    });

    const transporter = nodemailer.createTransport({
      host:              smtpHost,
      port:              smtpPort,
      secure:            smtpSecure,
      auth:              { user: smtpUser, pass: smtpPass },
      connectionTimeout: 15_000,
      greetingTimeout:   10_000,
    });

    logger.info('🔬 Debug: verifying SMTP connection...');
    await transporter.verify();
    logger.info('🔬 Debug: SMTP verified ✅');

    const info = await transporter.sendMail({
      from:    `"${fromName}" <${fromEmail}>`,
      to,
      subject: 'Email Sequencing Test',
      text:    'This is a test email from the Email Sequencing platform.',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#2563eb;">✅ Email Sequencing Test</h2>
          <p>This is a test email from the Email Sequencing platform.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
          <p style="color:#6b7280;font-size:13px;">
            Sent at: ${new Date().toISOString()}<br/>
            SMTP: ${smtpHost}:${smtpPort}<br/>
            From: ${fromEmail}
          </p>
        </div>
      `,
    });

    transporter.close();

    logger.info('🔬 Debug: test email sent ✅', {
      smtpHost, to, messageId: info.messageId, smtpResponse: info.response,
    });

    res.status(200).json({
      success:      true,
      messageId:    info.messageId,
      smtpResponse: info.response,
      accepted:     info.accepted,
      rejected:     info.rejected,
    });
  } catch (err: any) {
    logger.error('🔬 Debug: send-test-email FAILED ❌', {
      error: err.message, code: err.code, command: err.command, stack: err.stack,
    });
    res.status(500).json({
      success:  false,
      error:    err.message,
      code:     err.code     ?? null,
      command:  err.command  ?? null,
      response: err.response ?? null,
      stack:    err.stack    ?? null,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/debug/queue-status
// Full BullMQ queue inspection — counts, paused state, recent jobs.
// ═══════════════════════════════════════════════════════════════════
router.get('/queue-status', async (_req: Request, res: Response) => {
  try {
    const { emailQueue } = await import('../queues/emailQueue');

    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getCompletedCount(),
      emailQueue.getFailedCount(),
      emailQueue.getDelayedCount(),
      emailQueue.isPaused(),
    ]);

    // Fetch last 20 jobs across every state for full visibility
    const [waitingJobs, activeJobs, completedJobs, failedJobs, delayedJobs] = await Promise.all([
      emailQueue.getJobs(['waiting'],   0, 10),
      emailQueue.getJobs(['active'],    0, 10),
      emailQueue.getJobs(['completed'], 0, 10),
      emailQueue.getJobs(['failed'],    0, 10),
      emailQueue.getJobs(['delayed'],   0, 10),
    ]);

    const formatJob = (j: any, state: string) => ({
      id:           j.id,
      name:         j.name,
      state,
      payload:      j.data,
      failedReason: j.failedReason   ?? null,
      attemptsMade: j.attemptsMade   ?? 0,
      timestamp:    j.timestamp      ? new Date(j.timestamp).toISOString()   : null,
      processedOn:  j.processedOn    ? new Date(j.processedOn).toISOString() : null,
      finishedOn:   j.finishedOn     ? new Date(j.finishedOn).toISOString()  : null,
    });

    const recentJobs = [
      ...activeJobs.map(j    => formatJob(j, 'active')),
      ...waitingJobs.map(j   => formatJob(j, 'waiting')),
      ...delayedJobs.map(j   => formatJob(j, 'delayed')),
      ...completedJobs.map(j => formatJob(j, 'completed')),
      ...failedJobs.map(j    => formatJob(j, 'failed')),
    ];

    logger.info('🔬 Debug queue-status', {
      queueName: emailQueue.name,
      waiting, active, completed, failed, delayed, isPaused,
    });

    res.status(200).json({
      success:    true,
      queue_name: emailQueue.name,
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused:     isPaused,
      recentJobs,
    });
  } catch (err: any) {
    logger.error('🔬 Debug: queue-status error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/debug/process-contact
//
// Directly invokes processEmailSend() — the EXACT function BullMQ
// uses — without going through the queue at all.
//
// Pinpoints exactly which layer fails:
//   ✅ DB load (contact / step / template / connection)
//   ✅ Render (merge tags, tracking injection)
//   ✅ SMTP send
//   ✅ SendingLog creation + contact advancement
//
// Body: { "contactId": "..." }
// ═══════════════════════════════════════════════════════════════════
router.post('/process-contact', async (req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    const { contactId } = z.object({
      contactId: z.string().min(1, 'contactId is required'),
    }).parse(req.body);

    logger.info('🔬 Debug process-contact: starting direct invocation', { contactId });

    // Load the contact first to get the current step index
    const { SequenceContact } = await import('../models/SequenceContact');
    const contact = await SequenceContact.findById(contactId).lean();

    if (!contact) {
      res.status(404).json({ success: false, error: `Contact ${contactId} not found` });
      return;
    }

    logger.info('🔬 Debug process-contact: contact found', {
      email:              contact.contact_email,
      status:             contact.status,
      current_step_index: contact.current_step_index,
      next_send_at:       contact.next_send_at,
      sequence_id:        contact.sequence_id,
    });

    // Import the exported processor
    const { processEmailSend } = await import('../queues/emailQueue');

    // Construct a minimal Job-like object that satisfies processEmailSend's interface.
    // BullMQ's Job type is complex — we only need the fields actually used inside the function.
    const fakeJob = {
      id:          `debug-${Date.now()}`,
      name:        'email:send',
      timestamp:   Date.now(),
      attemptsMade: 0,
      data: {
        sequenceContactId: contactId,
        stepIndex:         contact.current_step_index,
      },
    } as any;

    logger.info('🔬 Debug process-contact: invoking processEmailSend directly', {
      fakeJobId:  fakeJob.id,
      stepIndex:  contact.current_step_index,
    });

    await processEmailSend(fakeJob);

    const elapsed = Date.now() - startedAt;
    logger.info('🔬 Debug process-contact: SUCCESS ✅', { contactId, elapsed_ms: elapsed });

    res.status(200).json({
      success:    true,
      message:    'Email sent and contact advanced successfully',
      contactId,
      stepIndex:  contact.current_step_index,
      elapsed_ms: elapsed,
    });

  } catch (err: any) {
    const elapsed = Date.now() - startedAt;

    logger.error('🔬 Debug process-contact: FAILED ❌', {
      error:    err.message,
      name:     err.name,
      code:     err.code,
      response: err.response,
      stack:    err.stack,
    });

    res.status(500).json({
      success:    false,
      error:      err.message,
      errorType:  err.name    ?? null,
      code:       err.code    ?? null,
      response:   err.response ?? null,
      stack:      err.stack   ?? null,
      elapsed_ms: elapsed,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/debug/trigger-scheduler
//
// Forces an immediate scheduler tick — runs the EXACT same
// runScheduler() logic used by BullMQ's repeatable job.
// Lets you verify the Scheduler → Queue → Worker pipeline
// without waiting 5 minutes for the next automatic tick.
// ═══════════════════════════════════════════════════════════════════
router.post('/trigger-scheduler', async (_req: Request, res: Response) => {
  try {
    logger.info('🔬 Debug trigger-scheduler: forcing immediate scheduler tick...');

    const { emailQueue } = await import('../queues/emailQueue');
    const { SequenceContact, ContactEnrollmentStatus } = await import('../models/SequenceContact');

    const now = new Date();

    // Run the exact same query the scheduler uses
    const dueContacts = await SequenceContact.find({
      status:       ContactEnrollmentStatus.ACTIVE,
      next_send_at: { $lte: now },
    })
      .limit(50)
      .select('_id current_step_index next_send_at contact_email')
      .lean();

    if (dueContacts.length === 0) {
      logger.info('🔬 Debug trigger-scheduler: no due contacts found');
      res.status(200).json({ success: true, message: 'No due contacts found', enqueued: 0 });
      return;
    }

    logger.info(`🔬 Debug trigger-scheduler: found ${dueContacts.length} due contact(s)`, {
      contacts: dueContacts.map(c => ({
        id:           c._id.toString(),
        email:        (c as any).contact_email,
        stepIndex:    c.current_step_index,
        next_send_at: c.next_send_at,
      })),
    });

    // Enqueue — no custom jobId, let BullMQ auto-generate
    const jobs = dueContacts.map((c) => ({
      name: 'email:send',
      data: {
        sequenceContactId: c._id.toString(),
        stepIndex:         c.current_step_index,
      },
      opts: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 1000, age: 7  * 24 * 3600 },
        removeOnFail:     { count: 500,  age: 30 * 24 * 3600 },
      },
    }));

    const addedJobs = await emailQueue.addBulk(jobs);
    const jobIds = addedJobs.map(j => j.id);

    logger.info(`🔬 Debug trigger-scheduler: enqueued ${addedJobs.length} job(s) ✅`, { jobIds });

    res.status(200).json({
      success:         true,
      message:         `Enqueued ${addedJobs.length} job(s)`,
      enqueued:        addedJobs.length,
      jobIds,
      contacts:        dueContacts.map(c => ({
        id:           c._id.toString(),
        email:        (c as any).contact_email,
        stepIndex:    c.current_step_index,
        next_send_at: c.next_send_at,
      })),
    });
  } catch (err: any) {
    logger.error('🔬 Debug trigger-scheduler: FAILED ❌', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

export default router;
