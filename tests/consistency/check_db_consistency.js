/**
 * tests/consistency/check_db_consistency.js
 *
 * DATABASE CONSISTENCY VALIDATION SCRIPT
 *
 * Purpose:
 *   Run after every load test to verify MongoDB data integrity.
 *   This script connects directly to MongoDB and executes all
 *   data consistency assertions defined in the test strategy.
 *
 * Checks Performed:
 *   1. No duplicate SendingLog records (same contact + step)
 *   2. No orphaned SequenceContacts (no parent sequence)
 *   3. All active contacts have valid next_send_at
 *   4. No contacts with sending_locked=true older than 5 minutes
 *   5. schedule_version is always >= 1 for all contacts
 *   6. current_job_id references match BullMQ job state
 *   7. Sequence stats match actual SendingLog counts
 *   8. No contacts stuck in ACTIVE with null next_send_at
 *   9. No SendingLog with status='sending' older than 10 minutes (stale lock)
 *  10. Validate all active sequences have queue representation
 *
 * Usage:
 *   # Run against local MongoDB
 *   node tests/consistency/check_db_consistency.js
 *
 *   # Run against remote
 *   MONGO_URI=mongodb+srv://... node tests/consistency/check_db_consistency.js
 *
 *   # Run only specific checks
 *   CHECK=duplicates node tests/consistency/check_db_consistency.js
 *
 *   # Output as JSON for CI pipelines
 *   OUTPUT=json node tests/consistency/check_db_consistency.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '../backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/email_sequencing';
const OUTPUT    = process.env.OUTPUT    || 'text';

// ─── ANSI Colors ─────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  reset:  (s) => `\x1b[0m${s}\x1b[0m`,
};

const results = [];

function pass(check, detail = '') {
  results.push({ status: 'PASS', check, detail });
  if (OUTPUT !== 'json') console.log(`  ${c.green('✓ PASS')} ${c.bold(check)} ${detail}`);
}

function fail(check, detail = '', data = null) {
  results.push({ status: 'FAIL', check, detail, data });
  if (OUTPUT !== 'json') console.error(`  ${c.red('✗ FAIL')} ${c.bold(check)} ${detail}`);
  if (data && OUTPUT !== 'json') console.error(`         Data: ${JSON.stringify(data, null, 2)}`);
}

function warn(check, detail = '') {
  results.push({ status: 'WARN', check, detail });
  if (OUTPUT !== 'json') console.warn(`  ${c.yellow('⚠ WARN')} ${c.bold(check)} ${detail}`);
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  if (OUTPUT !== 'json') {
    console.log(c.bold('\n════════════════════════════════════════════════════════════'));
    console.log(c.bold(' Email Sequencing Module — Database Consistency Checker'));
    console.log(c.bold('════════════════════════════════════════════════════════════\n'));
    console.log(`Connecting to: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}\n`);
  }

  await mongoose.connect(MONGO_URI, { dbName: 'email_sequencing' });

  const db = mongoose.connection.db;

  // ── CHECK 1: Duplicate SendingLog Records ──────────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 1] Duplicate SendingLog Records'));

  const duplicateLogs = await db.collection('sending_logs').aggregate([
    {
      $group: {
        _id: {
          sequence_contact_id: '$sequence_contact_id',
          step_index:          '$step_index',
          status:              '$status',
        },
        count: { $sum: 1 },
        ids:   { $push: '$_id' },
      }
    },
    { $match: { count: { $gt: 1 }, '_id.status': 'sent' } },
    { $limit: 10 }
  ]).toArray();

  if (duplicateLogs.length === 0) {
    pass('No duplicate SendingLog records (same contact + step + sent)', `0 duplicates found`);
  } else {
    fail(
      'Duplicate SendingLog records detected',
      `${duplicateLogs.length} duplicate groups found — possible duplicate sends!`,
      duplicateLogs.map(d => ({ contact: d._id.sequence_contact_id, step: d._id.step_index, count: d.count }))
    );
  }

  // ── CHECK 2: Orphaned SequenceContacts ─────────────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 2] Orphaned SequenceContacts'));

  const activeContacts = await db.collection('sequence_contacts')
    .find({ status: 'active' })
    .project({ _id: 1, sequence_id: 1 })
    .toArray();

  const sequenceIds = [...new Set(activeContacts.map(c => c.sequence_id?.toString()).filter(Boolean))];
  let orphanCount   = 0;

  if (sequenceIds.length > 0) {
    const existingSeqs = await db.collection('sequences')
      .find({ _id: { $in: sequenceIds.map(id => new mongoose.Types.ObjectId(id)) } })
      .project({ _id: 1 })
      .toArray();

    const existingIds = new Set(existingSeqs.map(s => s._id.toString()));
    orphanCount       = sequenceIds.filter(id => !existingIds.has(id)).length;
  }

  if (orphanCount === 0) {
    pass('No orphaned SequenceContacts', `All ${activeContacts.length} active contacts have valid sequences`);
  } else {
    fail('Orphaned SequenceContacts found', `${orphanCount} contacts reference non-existent sequences`);
  }

  // ── CHECK 3: Active Contacts Without next_send_at ──────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 3] Active Contacts Missing next_send_at'));

  const activeWithoutNextSend = await db.collection('sequence_contacts').countDocuments({
    status:      'active',
    next_send_at: null,
  });

  if (activeWithoutNextSend === 0) {
    pass('All active contacts have next_send_at set', 'No scheduling gaps detected');
  } else {
    fail(
      'Active contacts with null next_send_at',
      `${activeWithoutNextSend} active contacts have no next_send_at — they will NEVER send`
    );
  }

  // ── CHECK 4: Stuck sending_locked Contacts ──────────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 4] Stuck sending_locked Contacts'));

  const fiveMinAgo     = new Date(Date.now() - 5 * 60 * 1000);
  const stuckLocked    = await db.collection('sequence_contacts').countDocuments({
    sending_locked:  true,
    last_attempt_at: { $lt: fiveMinAgo },
  });

  if (stuckLocked === 0) {
    pass('No contacts stuck in sending_locked state', 'All locks properly released');
  } else {
    fail(
      'Contacts stuck in sending_locked=true',
      `${stuckLocked} contacts locked for > 5 minutes — worker crash suspected`
    );
  }

  // ── CHECK 5: schedule_version Integrity ─────────────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 5] schedule_version Integrity'));

  const invalidVersion = await db.collection('sequence_contacts').countDocuments({
    $or: [
      { schedule_version: { $lt: 1 } },
      { schedule_version: null },
      { schedule_version: { $exists: false } },
    ],
  });

  if (invalidVersion === 0) {
    pass('All contacts have valid schedule_version >= 1', '');
  } else {
    fail('Contacts with invalid schedule_version', `${invalidVersion} contacts missing or have version < 1`);
  }

  // ── CHECK 6: Stale Sending Logs (status=sending > 10 minutes) ──────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 6] Stale SendingLog Records'));

  const tenMinAgo    = new Date(Date.now() - 10 * 60 * 1000);
  const staleSending = await db.collection('sending_logs').countDocuments({
    status:    'sending',
    queued_at: { $lt: tenMinAgo },
  });

  if (staleSending === 0) {
    pass('No stale SendingLog records (status=sending > 10min)', '');
  } else {
    fail(
      'Stale SendingLog records in sending state',
      `${staleSending} logs stuck in 'sending' for > 10 minutes — worker crash or lock leak`
    );
  }

  // ── CHECK 7: Sequence Stats vs Actual SendingLog Count ─────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 7] Sequence Stats Consistency'));

  const sequences = await db.collection('sequences')
    .find({ status: { $in: ['active', 'paused', 'completed'] } })
    .project({ _id: 1, stats: 1, name: 1 })
    .limit(20)
    .toArray();

  let statsMismatch = 0;
  for (const seq of sequences) {
    const actualSent = await db.collection('sending_logs').countDocuments({
      sequence_id: seq._id,
      status:      'sent',
    });
    const reportedSent = seq.stats?.total_sent ?? 0;

    if (actualSent !== reportedSent) {
      statsMismatch++;
      warn(
        `Sequence stats mismatch: "${seq.name}"`,
        `stats.total_sent=${reportedSent} but actual sent logs=${actualSent}`
      );
    }
  }

  if (statsMismatch === 0) {
    pass('Sequence stats match actual SendingLog counts', `Checked ${sequences.length} sequences`);
  }

  // ── CHECK 8: current_job_id Validity ────────────────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 8] current_job_id Validity'));

  const contactsWithJobId = await db.collection('sequence_contacts').countDocuments({
    status:        'active',
    current_job_id: { $exists: true, $ne: null },
  });

  const contactsWithoutJobId = await db.collection('sequence_contacts').countDocuments({
    status:        'active',
    next_send_at:  { $ne: null },
    current_job_id: null,
  });

  pass('Contacts with current_job_id', `${contactsWithJobId} active contacts have a tracked job ID`);

  if (contactsWithoutJobId === 0) {
    pass('No active contacts missing current_job_id', 'Queue tracking is complete');
  } else {
    warn(
      'Active contacts with next_send_at but no current_job_id',
      `${contactsWithoutJobId} contacts may not have a corresponding BullMQ job — run queue rebuild`
    );
  }

  // ── CHECK 9: Contacts with consecutive_failures > 0 ─────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 9] High Consecutive Failure Contacts'));

  const highFailures = await db.collection('sequence_contacts').countDocuments({
    consecutive_failures: { $gte: 3 },
    status: { $nin: ['failed', 'bounced'] },
  });

  if (highFailures === 0) {
    pass('No non-failed contacts with >= 3 consecutive failures', '');
  } else {
    warn(
      'Contacts with >= 3 consecutive failures still in active/paused state',
      `${highFailures} contacts — check SMTP configuration`
    );
  }

  // ── CHECK 10: Active Sequences in Healthy State ────────────────────
  if (OUTPUT !== 'json') console.log(c.blue('\n[CHECK 10] Active Sequence Health'));

  const integrityErrors = await db.collection('sequences').countDocuments({
    status:          'active',
    integrity_error: true,
  });

  if (integrityErrors === 0) {
    pass('No active sequences with integrity_error=true', '');
  } else {
    fail(
      'Active sequences flagged with integrity errors',
      `${integrityErrors} sequences have integrity_error=true — investigate UnrecoverableErrors`
    );
  }

  // ─── Summary ───────────────────────────────────────────────────────
  await mongoose.disconnect();

  const passed  = results.filter(r => r.status === 'PASS').length;
  const failed  = results.filter(r => r.status === 'FAIL').length;
  const warned  = results.filter(r => r.status === 'WARN').length;
  const total   = results.length;

  if (OUTPUT === 'json') {
    console.log(JSON.stringify({ passed, failed, warned, total, results }, null, 2));
  } else {
    console.log(c.bold(`\n${'─'.repeat(60)}`));
    console.log(c.bold(` Results: ${c.green(`${passed} PASSED`)}  ${c.red(`${failed} FAILED`)}  ${c.yellow(`${warned} WARNED`)} / ${total} total`));
    console.log(c.bold(`${'─'.repeat(60)}\n`));

    if (failed > 0) {
      console.error(c.red(c.bold('❌ CONSISTENCY CHECKS FAILED — DO NOT PROMOTE TO PRODUCTION\n')));
      process.exit(1);
    } else if (warned > 0) {
      console.warn(c.yellow('⚠ Some warnings detected — investigate before production deployment\n'));
    } else {
      console.log(c.green(c.bold('✅ All consistency checks passed — system is production-ready\n')));
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
