/**
 * tests/consistency/mongo_queries.js
 *
 * MONGODB DIAGNOSTIC QUERIES
 *
 * Copy-paste these queries directly into mongosh for manual inspection.
 * Run these BEFORE and AFTER every load test run to compare baselines.
 *
 * Usage:
 *   mongosh "mongodb://localhost:27017/email_sequencing" --file tests/consistency/mongo_queries.js
 *
 * Or paste individual queries in mongosh:
 *   use email_sequencing
 */

// ═══════════════════════════════════════════════════════════════════
// SECTION A: Pre-Test Baseline Snapshots
// Run before each test to capture baseline state.
// ═══════════════════════════════════════════════════════════════════

// A1: Contact status distribution
db.sequence_contacts.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

// A2: Sending log status distribution
db.sending_logs.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

// A3: Queue representation — contacts with a scheduled job
db.sequence_contacts.countDocuments({
  status: 'active',
  next_send_at: { $ne: null },
  current_job_id: { $ne: null }
});

// A4: Sequence status distribution
db.sequences.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } }
]);


// ═══════════════════════════════════════════════════════════════════
// SECTION B: Duplicate Detection Queries
// Run after load tests to detect any duplicate sends.
// ═══════════════════════════════════════════════════════════════════

// B1: Find duplicate sends (same contact + same step sent twice)
db.sending_logs.aggregate([
  { $match: { status: 'sent' } },
  {
    $group: {
      _id: {
        contact_id: '$sequence_contact_id',
        step_index:  '$step_index'
      },
      count: { $sum: 1 },
      log_ids: { $push: '$_id' },
      sent_ats: { $push: '$sent_at' }
    }
  },
  { $match: { count: { $gt: 1 } } },
  {
    $lookup: {
      from:         'sequence_contacts',
      localField:   '_id.contact_id',
      foreignField: '_id',
      as:           'contact'
    }
  },
  {
    $project: {
      _id: 0,
      contact_email:  { $arrayElemAt: ['$contact.contact_email', 0] },
      step_index:     '$_id.step_index',
      duplicate_count: '$count',
      log_ids:        1,
      sent_ats:       1
    }
  }
]);

// B2: Contacts that were sent to more times than steps allow
db.sequence_contacts.aggregate([
  {
    $project: {
      contact_email: 1,
      total_steps: 1,
      sent_records: {
        $filter: {
          input: '$step_records',
          as: 'sr',
          cond: { $eq: ['$$sr.status', 'sent'] }
        }
      }
    }
  },
  {
    $project: {
      contact_email: 1,
      total_steps: 1,
      sent_count: { $size: '$sent_records' }
    }
  },
  { $match: { $expr: { $gt: ['$sent_count', '$total_steps'] } } }
]);

// B3: SendingLogs for contacts in terminal states (completed/failed/bounced)
// These should NOT have any 'sent' logs AFTER the terminal transition
db.sending_logs.aggregate([
  {
    $lookup: {
      from:         'sequence_contacts',
      localField:   'sequence_contact_id',
      foreignField: '_id',
      as:           'contact'
    }
  },
  { $unwind: '$contact' },
  {
    $match: {
      'contact.status': { $in: ['failed', 'bounced', 'unsubscribed'] },
      status: 'sent',
      $expr: { $gt: ['$sent_at', '$contact.failed_at'] }
    }
  },
  {
    $project: {
      contact_email: '$contact.contact_email',
      contact_status: '$contact.status',
      log_sent_at: '$sent_at',
      contact_failed_at: '$contact.failed_at'
    }
  },
  { $limit: 20 }
]);


// ═══════════════════════════════════════════════════════════════════
// SECTION C: Lock & State Validation
// Detect stuck workers and orphaned locks.
// ═══════════════════════════════════════════════════════════════════

// C1: Contacts stuck in sending_locked=true for > 5 minutes
db.sequence_contacts.find({
  sending_locked: true,
  last_attempt_at: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
}, {
  contact_email: 1,
  status: 1,
  last_attempt_at: 1,
  current_job_id: 1
});

// C2: Release all stuck locks (RUN ONLY AFTER CONFIRMING NO WORKERS ARE ACTIVE)
// WARNING: Only run this if workers are stopped.
// db.sequence_contacts.updateMany(
//   {
//     sending_locked: true,
//     last_attempt_at: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
//   },
//   { $set: { sending_locked: false, job_state: 'lock_released_manual' } }
// );

// C3: Stale sending logs (status='sending' for > 10 minutes)
db.sending_logs.find({
  status: 'sending',
  queued_at: { $lt: new Date(Date.now() - 10 * 60 * 1000) }
}, {
  to_email: 1,
  step_index: 1,
  queued_at: 1,
  sequence_contact_id: 1
}).limit(20);

// C4: Active contacts with null next_send_at (scheduler gap)
db.sequence_contacts.find({
  status: 'active',
  next_send_at: null
}, {
  contact_email: 1,
  sequence_id: 1,
  current_step_index: 1,
  current_job_id: 1
}).limit(20);


// ═══════════════════════════════════════════════════════════════════
// SECTION D: schedule_version & Job Tracking
// Verify idempotency and version control is working.
// ═══════════════════════════════════════════════════════════════════

// D1: Contacts with schedule_version mismatch candidates
// Contacts rescheduled recently — verify version incremented
db.sequence_contacts.find({
  last_rescheduled_at: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
}, {
  contact_email: 1,
  schedule_version: 1,
  last_rescheduled_at: 1,
  current_job_id: 1,
  next_send_at: 1
}).sort({ last_rescheduled_at: -1 }).limit(20);

// D2: Contacts with schedule_version = 1 (never rescheduled)
db.sequence_contacts.countDocuments({ schedule_version: 1 });

// D3: Contacts with schedule_version > 5 (heavily rescheduled — investigate)
db.sequence_contacts.find({ schedule_version: { $gt: 5 } }, {
  contact_email: 1,
  schedule_version: 1,
  last_rescheduled_at: 1,
  status: 1
}).limit(20);

// D4: Contacts missing current_job_id but active with next_send_at
// These have a gap in BullMQ — run /api/system/rebuild-queue
db.sequence_contacts.find({
  status: 'active',
  next_send_at: { $ne: null },
  $or: [
    { current_job_id: null },
    { current_job_id: { $exists: false } }
  ]
}, {
  contact_email: 1,
  sequence_id: 1,
  next_send_at: 1,
  schedule_version: 1
}).limit(30);


// ═══════════════════════════════════════════════════════════════════
// SECTION E: Multi-Worker Validation
// Verify no duplicate processing between workers.
// ═══════════════════════════════════════════════════════════════════

// E1: Find contacts processed within the same minute (potential overlap)
db.sending_logs.aggregate([
  { $match: { status: 'sent', sent_at: { $gte: new Date(Date.now() - 60 * 60 * 1000) } } },
  {
    $group: {
      _id: {
        contact_id: '$sequence_contact_id',
        step_index:  '$step_index',
        minute:      { $dateToString: { format: '%Y-%m-%d %H:%M', date: '$sent_at' } }
      },
      count: { $sum: 1 }
    }
  },
  { $match: { count: { $gt: 1 } } }
]);

// E2: Worker processing timeline (last 100 sends)
db.sending_logs.find(
  { status: 'sent' },
  { to_email: 1, step_index: 1, sent_at: 1, sequence_contact_id: 1 }
).sort({ sent_at: -1 }).limit(100);

// E3: Average time between step sends per contact (queue latency)
db.sequence_contacts.aggregate([
  { $match: { status: { $in: ['active', 'completed'] } } },
  { $unwind: '$step_records' },
  { $match: { 'step_records.status': 'sent' } },
  {
    $group: {
      _id: '$_id',
      email: { $first: '$contact_email' },
      step_count: { $sum: 1 },
      first_sent: { $min: '$step_records.sent_at' },
      last_sent:  { $max: '$step_records.sent_at' }
    }
  },
  {
    $project: {
      email: 1,
      step_count: 1,
      total_duration_ms: {
        $subtract: ['$last_sent', '$first_sent']
      }
    }
  },
  { $limit: 50 }
]);


// ═══════════════════════════════════════════════════════════════════
// SECTION F: Recovery Validation
// Verify system recovered correctly after simulated failures.
// ═══════════════════════════════════════════════════════════════════

// F1: Count emails that should have been sent but were not
// (contacts whose next_send_at is in the past but are still active)
db.sequence_contacts.find({
  status: 'active',
  next_send_at: { $lt: new Date() }
}, {
  contact_email: 1,
  next_send_at: 1,
  current_step_index: 1,
  current_job_id: 1,
  sending_locked: 1
}).limit(30);

// F2: Sequences marked with integrity errors
db.sequences.find({ integrity_error: true }, {
  name: 1,
  status: 1,
  last_integrity_error: 1
});

// F3: Post-restart consistency — contacts re-enqueued by rebuild
db.sequence_contacts.aggregate([
  {
    $match: {
      status: 'active',
      job_scheduled_at: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
    }
  },
  {
    $group: {
      _id: null,
      total_requeued: { $sum: 1 },
      by_sequence: {
        $push: { seq: '$sequence_id', job: '$current_job_id' }
      }
    }
  }
]);


// ═══════════════════════════════════════════════════════════════════
// SECTION G: Performance Diagnostics
// Identify hot paths and slow queries.
// ═══════════════════════════════════════════════════════════════════

// G1: Most-sent-to sequences (top 10)
db.sending_logs.aggregate([
  { $group: { _id: '$sequence_id', sent_count: { $sum: 1 } } },
  { $sort: { sent_count: -1 } },
  { $limit: 10 },
  {
    $lookup: {
      from: 'sequences',
      localField: '_id',
      foreignField: '_id',
      as: 'sequence'
    }
  },
  {
    $project: {
      name: { $arrayElemAt: ['$sequence.name', 0] },
      sent_count: 1
    }
  }
]);

// G2: Contacts scheduled in the next hour (worker preload)
db.sequence_contacts.countDocuments({
  status: 'active',
  next_send_at: {
    $gte: new Date(),
    $lt:  new Date(Date.now() + 60 * 60 * 1000)
  }
});

// G3: High consecutive failure contacts
db.sequence_contacts.find({
  consecutive_failures: { $gte: 2 }
}, {
  contact_email: 1,
  consecutive_failures: 1,
  last_error: 1,
  status: 1
}).sort({ consecutive_failures: -1 }).limit(20);
