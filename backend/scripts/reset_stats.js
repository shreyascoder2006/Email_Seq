/**
 * reset_stats.js
 *
 * One-time script: Resets all Sequence.stats fields to values computed
 * from the live SendingLog, OpenLog, ClickLog, ReplyLog, BounceLog,
 * and SequenceContact collections.
 *
 * Run once from the backend directory:
 *   node scripts/reset_stats.js
 *
 * Safe to re-run — it always recomputes from source-of-truth collections.
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/email_sequencing';

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db();

  // 1. Aggregate real stats from source-of-truth collections
  const [sentCounts, openCounts, clickCounts, replyCounts, bounceCounts, contactCounts] =
    await Promise.all([
      // total_sent = SendingLog with status='sent'
      db.collection('sendinglogs').aggregate([
        { $match: { status: 'sent' } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]).toArray(),

      // total_opens = OpenLog count per sequence
      db.collection('openlogs').aggregate([
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]).toArray(),

      // total_clicks = ClickLog count per sequence
      db.collection('clicklogs').aggregate([
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]).toArray(),

      // total_replies = ReplyLog count per sequence
      db.collection('replylogs').aggregate([
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]).toArray(),

      // total_bounces = BounceLog count per sequence
      db.collection('bouncelogs').aggregate([
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]).toArray(),

      // contacts breakdown from SequenceContact
      db.collection('sequencecontacts').aggregate([
        {
          $group: {
            _id: '$sequence_id',
            total_contacts:  { $sum: 1 },
            active_contacts: { $sum: { $cond: [{ $eq: ['$status', 'active'] },     1, 0] } },
            paused_contacts: { $sum: { $cond: [{ $eq: ['$status', 'paused'] },     1, 0] } },
            completed:       { $sum: { $cond: [{ $eq: ['$status', 'completed'] },  1, 0] } },
            unsubscribed:    { $sum: { $cond: [{ $eq: ['$status', 'unsubscribed'] }, 1, 0] } },
          },
        },
      ]).toArray(),
    ]);

  // 2. Build lookup maps
  const toMap = (arr) => {
    const m = new Map();
    for (const row of arr) m.set(row._id?.toString(), row.count ?? 0);
    return m;
  };
  const contactMap = new Map();
  for (const row of contactCounts) {
    contactMap.set(row._id?.toString(), {
      total_contacts:  row.total_contacts  ?? 0,
      active_contacts: row.active_contacts ?? 0,
      paused_contacts: row.paused_contacts ?? 0,
      completed:       row.completed       ?? 0,
      unsubscribed:    row.unsubscribed    ?? 0,
    });
  }
  const sentMap    = toMap(sentCounts);
  const openMap    = toMap(openCounts);
  const clickMap   = toMap(clickCounts);
  const replyMap   = toMap(replyCounts);
  const bounceMap  = toMap(bounceCounts);

  // 3. Fetch all sequences
  const sequences = await db.collection('sequences').find({}, { projection: { _id: 1, name: 1, stats: 1 } }).toArray();
  console.log(`\nFound ${sequences.length} sequences to update.\n`);

  let updated = 0;
  for (const seq of sequences) {
    const id = seq._id.toString();
    const contacts = contactMap.get(id) ?? { total_contacts: 0, active_contacts: 0, paused_contacts: 0, completed: 0, unsubscribed: 0 };

    const newStats = {
      total_contacts:  contacts.total_contacts,
      active_contacts: contacts.active_contacts,
      paused_contacts: contacts.paused_contacts,
      completed:       contacts.completed,
      unsubscribed:    contacts.unsubscribed,
      total_sent:      sentMap.get(id)   ?? 0,
      total_opens:     openMap.get(id)   ?? 0,
      total_clicks:    clickMap.get(id)  ?? 0,
      total_replies:   replyMap.get(id)  ?? 0,
      total_bounces:   bounceMap.get(id) ?? 0,
    };

    console.log(
      `[${seq.name}] BEFORE: total_sent=${seq.stats?.total_sent ?? '?'}  ` +
      `AFTER: total_sent=${newStats.total_sent}, active=${newStats.active_contacts}`
    );

    await db.collection('sequences').updateOne(
      { _id: seq._id },
      { $set: { stats: newStats } }
    );
    updated++;
  }

  console.log(`\n✅ Reset stats for ${updated} sequences.`);
  await client.close();
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
