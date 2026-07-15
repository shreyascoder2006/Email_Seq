/**
 * diagnose-immediate-scheduling.ts
 *
 * Traces the full lifecycle of a single contact in an immediately-launched sequence.
 * Does NOT modify any data. Read-only diagnostic.
 *
 * Usage:
 *   npx ts-node -e "require('./scripts/diagnose-immediate-scheduling.ts')"
 *   OR:
 *   node -r ts-node/register scripts/diagnose-immediate-scheduling.ts [SEQUENCE_ID]
 *
 * Pass an optional SEQUENCE_ID as argv[2] to target a specific sequence.
 * If omitted, auto-selects the most recently created sequence.
 */

import mongoose from 'mongoose';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

// ── Models (import after dotenv) ─────────────────────────────────────
import { Sequence } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { calculateNextValidSlot } from '../src/utils/scheduling';

// ── Separator helper ──────────────────────────────────────────────────
const sep = (label: string) =>
  console.log(`\n${'═'.repeat(70)}\n  ${label}\n${'═'.repeat(70)}`);

const ok  = (msg: string) => console.log(`  ✅  ${msg}`);
const bad = (msg: string) => console.log(`  ❌  ${msg}`);
const inf = (msg: string) => console.log(`  ℹ️   ${msg}`);
const warn = (msg: string) => console.log(`  ⚠️   ${msg}`);

async function main() {
  // ── 0. Connect ────────────────────────────────────────────────────
  sep('STEP 0 — Connecting to MongoDB');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || '';
  if (!mongoUri) throw new Error('No MONGO_URI in .env');
  await mongoose.connect(mongoUri);
  ok(`MongoDB connected: ${mongoUri.replace(/:\/\/[^@]+@/, '://***@')}`);

  const serverTimeUtc = new Date();
  inf(`Server time (UTC): ${serverTimeUtc.toISOString()}`);

  try {
    // ── 1. Find sequence ─────────────────────────────────────────────
    sep('STEP 1 — Loading Sequence');
    const targetSequenceId = process.argv[2];
    let seq: any;
    if (targetSequenceId) {
      seq = await Sequence.findById(targetSequenceId).lean();
      if (!seq) throw new Error(`Sequence ${targetSequenceId} not found`);
    } else {
      // Pick the most recently created active/paused/draft sequence
      seq = await Sequence.findOne({
        status: { $in: ['active', 'paused', 'draft'] }
      }).sort({ created_at: -1 }).lean();
      if (!seq) {
        seq = await Sequence.findOne({}).sort({ created_at: -1 }).lean();
      }
      if (!seq) throw new Error('No sequences found in database');
      warn('No SEQUENCE_ID provided — auto-selected most recent sequence');
    }

    console.log('');
    console.log('  Sequence ID     :', seq._id.toString());
    console.log('  Sequence name   :', seq.name);
    console.log('  Status          :', seq.status);
    console.log('  launch_date     :', seq.launch_date?.toISOString() ?? 'null');
    console.log('  Server time UTC :', serverTimeUtc.toISOString());

    const launchDateDiffMs = seq.launch_date
      ? seq.launch_date.getTime() - serverTimeUtc.getTime()
      : null;
    if (launchDateDiffMs !== null) {
      if (launchDateDiffMs <= 0) {
        ok(`launch_date is in the past by ${Math.abs(Math.round(launchDateDiffMs / 1000))}s — sequences with "Send Immediately" should have launch_date ≤ now`);
      } else {
        bad(`launch_date is ${Math.round(launchDateDiffMs / 1000)}s IN THE FUTURE — this is the bug if user chose "Send Immediately"`);
      }
    }

    console.log('');
    console.log('  Sending Window:');
    const w = seq.sending_window;
    if (w) {
      console.log(`    timezone    : ${w.timezone}`);
      console.log(`    schedule    : ${w.schedule}`);
      console.log(`    start       : ${w.start_hour}:${String(w.start_minute).padStart(2,'0')}`);
      console.log(`    end         : ${w.end_hour}:${String(w.end_minute).padStart(2,'0')}`);
      console.log(`    custom_days : ${JSON.stringify(w.custom_days ?? [])}`);

      // Compute what calculateNextValidSlot would return for "now"
      const computedSlot = calculateNextValidSlot(serverTimeUtc, w, seq.launch_date);
      console.log('');
      console.log('  calculateNextValidSlot(now, window, launch_date):');
      console.log(`    → UTC   : ${computedSlot.toISOString()}`);
      const localDt = DateTime.fromJSDate(computedSlot).setZone(w.timezone);
      console.log(`    → Local : ${localDt.toISO()} (${w.timezone})`);
      const slotDelayMs = computedSlot.getTime() - serverTimeUtc.getTime();
      if (slotDelayMs <= 1000) {
        ok(`Slot is NOW (+${slotDelayMs}ms) — contacts enrolled now should be immediately due`);
      } else {
        bad(`Slot is ${Math.round(slotDelayMs / 1000)}s in the future (${Math.round(slotDelayMs / 60000)} min)`);
        warn('This is the ENROLLMENT bug — contacts get next_send_at set to this future time');
      }
    } else {
      bad('sending_window is null/undefined on sequence');
    }

    // ── 2. Find a contact ────────────────────────────────────────────
    sep('STEP 2 — Loading Contacts');
    const contacts = await SequenceContact.find({
      sequence_id: seq._id,
      status: 'active',
    })
      .sort({ enrolled_at: -1 })
      .limit(3)
      .lean();

    if (contacts.length === 0) {
      warn('No active contacts in this sequence — checking all statuses');
      const anyContacts = await SequenceContact.find({ sequence_id: seq._id })
        .sort({ enrolled_at: -1 }).limit(3).lean();
      if (anyContacts.length === 0) {
        bad('No contacts at all in this sequence. Enroll a contact first, then re-run.');
        return;
      }
      inf(`Found ${anyContacts.length} contacts with non-active statuses:`);
      anyContacts.forEach(c => {
        console.log(`  - ${c.contact_email} | status=${c.status} | next_send_at=${c.next_send_at?.toISOString() ?? 'null'}`);
      });
      return;
    }

    console.log(`  Found ${contacts.length} active contact(s). Analysing most recently enrolled:\n`);
    const contact = contacts[0];

    console.log('  Contact ID      :', contact._id.toString());
    console.log('  Email           :', contact.contact_email);
    console.log('  Status          :', contact.status);
    console.log('  Step index      :', contact.current_step_index);
    console.log('  enrolled_at     :', contact.enrolled_at?.toISOString() ?? 'null');
    console.log('  next_send_at    :', contact.next_send_at?.toISOString() ?? 'null');
    console.log('  schedule_version:', contact.schedule_version);
    console.log('  sending_locked  :', contact.sending_locked);
    console.log('  current_job_id  :', contact.current_job_id ?? 'null');

    // ── 3. Diagnose next_send_at ─────────────────────────────────────
    sep('STEP 3 — Diagnosing next_send_at');
    if (!contact.next_send_at) {
      bad('next_send_at is NULL — contact will never be picked up by scheduler');
    } else {
      const dueInMs = contact.next_send_at.getTime() - serverTimeUtc.getTime();
      if (dueInMs <= 0) {
        ok(`next_send_at is in the past by ${Math.abs(Math.round(dueInMs / 1000))}s — contact IS due`);
        ok('Scheduler should have already picked this up');
      } else {
        bad(`next_send_at is ${Math.round(dueInMs / 1000)}s IN THE FUTURE (${Math.round(dueInMs / 60000)} min from now)`);
        bad(`Contact will not be processed until: ${contact.next_send_at.toISOString()}`);

        // Diagnose WHY it ended up in the future
        if (seq.launch_date && seq.launch_date.getTime() > serverTimeUtc.getTime()) {
          bad(`ROOT CAUSE CANDIDATE: launch_date (${seq.launch_date.toISOString()}) is in the future`);
          bad(`calculateNextValidSlot clamps to launch_date first, pushing next_send_at forward`);
        } else if (w) {
          const localNow = DateTime.fromJSDate(serverTimeUtc).setZone(w.timezone);
          const startMinutes = w.start_hour * 60 + (w.start_minute ?? 0);
          const endMinutes = w.end_hour * 60 + (w.end_minute ?? 0);
          const currentMinutes = localNow.hour * 60 + localNow.minute;
          if (currentMinutes < startMinutes) {
            bad(`ROOT CAUSE CANDIDATE: Current local time (${localNow.toFormat('HH:mm')}) is BEFORE window start (${w.start_hour}:${String(w.start_minute).padStart(2,'0')})`);
            bad(`calculateNextValidSlot advances to start of window → future next_send_at`);
          } else if (currentMinutes >= endMinutes) {
            bad(`ROOT CAUSE CANDIDATE: Current local time (${localNow.toFormat('HH:mm')}) is AFTER window end (${w.end_hour}:${String(w.end_minute).padStart(2,'0')})`);
            bad(`calculateNextValidSlot advances to NEXT valid window day → future next_send_at`);
          } else {
            // Time is inside window — check if today is an allowed day
            const luxonWeekday = localNow.weekday; // 1=Mon...7=Sun
            const mongoDay = luxonWeekday === 7 ? 0 : luxonWeekday;
            const isAllowed = (w.custom_days ?? []).includes(mongoDay);
            if (!isAllowed) {
              bad(`ROOT CAUSE CANDIDATE: Current weekday (${localNow.weekdayLong}, mongo=${mongoDay}) is NOT in custom_days=${JSON.stringify(w.custom_days ?? [])}`);
              bad(`calculateNextValidSlot advances to next allowed weekday → future next_send_at`);
            } else {
              warn('Window conditions look valid. next_send_at is future for another reason — check delay_days on first step');
            }
          }
        }
      }
    }

    // ── 4. Check BullMQ job ──────────────────────────────────────────
    sep('STEP 4 — Checking BullMQ Job');
    const redisUrl = process.env.REDIS_URL || process.env.BULL_REDIS_URL || 'redis://localhost:6379';
    const queueName = process.env.EMAIL_QUEUE_NAME || 'email-sequence';

    const redisConn = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let bullQueue: Queue | null = null;

    try {
      await redisConn.connect();
      ok('Redis connected');
      bullQueue = new Queue(queueName, {
        connection: redisConn as any,
      });

      // Check if contact has a known job ID
      if (contact.current_job_id) {
        inf(`Looking up job: ${contact.current_job_id}`);
        const job = await bullQueue.getJob(contact.current_job_id);
        if (!job) {
          bad(`Job ${contact.current_job_id} NOT FOUND in BullMQ — it was completed, removed, or never created`);
        } else {
          const state = await job.getState();
          const jobDelay = job.opts?.delay ?? 0;
          const jobTimestamp = job.timestamp;
          const scheduledRunAt = new Date(jobTimestamp + jobDelay);

          console.log('');
          console.log('  Job ID          :', job.id);
          console.log('  Job name        :', job.name);
          console.log('  Job state       :', state);
          console.log('  Job delay (ms)  :', jobDelay);
          console.log('  Job created at  :', new Date(jobTimestamp).toISOString());
          console.log('  Job runs at     :', scheduledRunAt.toISOString());
          console.log('  Job data        :', JSON.stringify(job.data));

          const scheduledDiffMs = scheduledRunAt.getTime() - serverTimeUtc.getTime();
          if (scheduledDiffMs <= 0) {
            ok(`BullMQ job was due ${Math.abs(Math.round(scheduledDiffMs / 1000))}s ago — worker should have consumed it`);
            if (state === 'delayed') {
              bad(`But job state is still "delayed" — worker may not be running or Redis has wrong clock`);
            } else if (state === 'waiting') {
              inf(`Job is "waiting" — should be picked up by worker on next poll`);
            } else if (state === 'completed') {
              ok(`Job state is "completed" — worker already processed it`);
            } else if (state === 'active') {
              ok(`Job state is "active" — worker is processing it right now`);
            } else if (state === 'failed') {
              bad(`Job state is "failed" — check worker logs for error`);
            }
          } else {
            bad(`BullMQ job is scheduled ${Math.round(scheduledDiffMs / 1000)}s IN THE FUTURE`);
            bad(`This means enqueueEmailJob computed delay = ${jobDelay}ms`);
            bad(`Root: enqueueEmailJob(nextSendAt) where nextSendAt was already in the future`);
          }

          // Check schedule_version match
          const jobSchedVer = job.data?.scheduleVersion;
          if (jobSchedVer !== undefined && jobSchedVer !== contact.schedule_version) {
            bad(`SCHEDULE VERSION MISMATCH: job has v${jobSchedVer}, contact has v${contact.schedule_version}`);
            bad(`Worker will SKIP this job when it runs (stale job guard at emailQueue.ts:217)`);
          } else {
            ok(`Schedule version matches: v${contact.schedule_version}`);
          }
        }
      } else {
        bad('contact.current_job_id is null — no BullMQ job was ever stored for this contact');
        warn('Either enqueueEmailJob() was not called, or the job ID was not saved back to MongoDB');

        // Search for any job referencing this contact in the queue
        inf('Scanning BullMQ queue for any job referencing this contact...');
        const waitingJobs = await bullQueue.getWaiting(0, 100);
        const delayedJobs = await bullQueue.getDelayed(0, 100);
        const allJobs = [...waitingJobs, ...delayedJobs];
        const matched = allJobs.filter(j => j.data?.sequenceContactId === contact._id.toString());
        if (matched.length > 0) {
          warn(`Found ${matched.length} job(s) for this contact NOT referenced in current_job_id:`);
          matched.forEach(j => {
            const s = scheduledAt(j);
            console.log(`    jobId=${j.id} state=? delay=${j.opts?.delay ?? 0}ms scheduledAt=${s}`);
          });
        } else {
          bad('No BullMQ job found for this contact in waiting or delayed queues');
          bad('CONCLUSION: Job was never enqueued, OR was completed/removed from queue');
        }
      }

      // Overall queue summary
      const [waiting, delayed, active, completed, failed] = await Promise.all([
        bullQueue.getWaitingCount(),
        bullQueue.getDelayedCount(),
        bullQueue.getActiveCount(),
        bullQueue.getCompletedCount(),
        bullQueue.getFailedCount(),
      ]);
      console.log('');
      console.log('  Queue summary:');
      console.log(`    waiting   : ${waiting}`);
      console.log(`    delayed   : ${delayed}`);
      console.log(`    active    : ${active}`);
      console.log(`    completed : ${completed}`);
      console.log(`    failed    : ${failed}`);

    } catch (redisErr: any) {
      bad(`Redis/BullMQ connection failed: ${redisErr.message}`);
      warn('Cannot check BullMQ job state — is Redis running?');
    } finally {
      try { await bullQueue?.close(); } catch {}
      try { redisConn.disconnect(); } catch {}
    }

    // ── 5. Summary ───────────────────────────────────────────────────
    sep('STEP 5 — Root Cause Summary');
    if (contact.next_send_at && contact.next_send_at.getTime() > serverTimeUtc.getTime()) {
      const dueInMin = Math.round((contact.next_send_at.getTime() - serverTimeUtc.getTime()) / 60000);
      console.log(`
  FINDING: next_send_at is ${dueInMin} minutes in the future.
  
  The scheduler only picks up contacts where next_send_at <= now.
  Since next_send_at > now, contacts wait silently.
  
  The immediate branch in the timeline:
  
    [Enrollment]
      computeNextSendAt(startBase, firstStep, sending_window, launch_date)
        └─ calculateNextValidSlot(startBase + delayMs, window, launch_date)
              • If launch_date > now  → clamps to launch_date (FUTURE)
              • If now outside window → advances to next window start (FUTURE)
              • If now on wrong day   → advances to next allowed day (FUTURE)
    
    Result: next_send_at = ${contact.next_send_at.toISOString()}
    Server: ${serverTimeUtc.toISOString()}
    
  The bug is that "Send Immediately" sends launch_date = new Date()
  through the modal, but calculateNextValidSlot then advances
  to the next VALID WINDOW SLOT even if it is hours or days away.
  
  The "Send Immediately" intent is lost because there is no branch
  in the code that skips window math for immediate sequences.
      `);
    } else if (!contact.next_send_at) {
      console.log('  FINDING: next_send_at is null. Contact was never scheduled.');
    } else {
      console.log('  next_send_at is in the past. Contact should be due now.');
      console.log('  If emails are still not sending, the issue is in the scheduler sweep');
      console.log('  or BullMQ worker. Check the job state output above.');
    }

  } finally {
    await mongoose.disconnect();
    inf('MongoDB disconnected');
    process.exit(0);
  }
}

function scheduledAt(j: any): string {
  try {
    return new Date(j.timestamp + (j.opts?.delay ?? 0)).toISOString();
  } catch { return 'unknown'; }
}

main().catch(err => {
  console.error('Diagnostic script error:', err);
  process.exit(1);
});
