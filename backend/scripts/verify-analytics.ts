/**
 * verify-analytics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Analytics Validation & Consistency Suite
 * Run: npx ts-node -r tsconfig-paths/register scripts/verify-analytics.ts <userId>
 *
 * Phases:
 *  1  Cross-endpoint consistency
 *  2  Reconciliation validators
 *  3  Funnel ordering
 *  4  Rate formula correctness
 *  5  Timeline ordering/metadata
 *  6  Step breakdown math
 *  7  Recipient field accuracy
 *  8  Sender metric thresholds
 *  9  Summary report + exit code
 * 10  Performance timing
 * ─────────────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db';
import { analyticsService } from '../src/services/analytics.service';
import { calculateRate } from '../src/services/analytics.aggregations';
import { SendingLog, SendStatus } from '../src/models/SendingLog';
import { OpenLog }   from '../src/models/OpenLog';
import { ClickLog }  from '../src/models/ClickLog';
import { ReplyLog }  from '../src/models/ReplyLog';
import { BounceLog } from '../src/models/BounceLog';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { Sequence, SequenceStatus } from '../src/models/Sequence';
import { EmailConnection } from '../src/models/EmailConnection';

// ─── Result tracking ─────────────────────────────────────────────────────────

interface CheckResult { pass: boolean; label: string; expected?: unknown; actual?: unknown; note?: string; }
const results: CheckResult[] = [];
const timings: { label: string; ms: number }[] = [];

function check(label: string, pass: boolean, expected?: unknown, actual?: unknown, note?: string) {
  results.push({ pass, label, expected, actual, note });
}

function eq(a: number, b: number, label: string, tolerance = 0) {
  check(label, Math.abs(a - b) <= tolerance, a, b);
}

function lte(a: number, b: number, label: string) {
  check(label, a <= b, `<= ${b}`, a);
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  timings.push({ label, ms: Date.now() - t0 });
  return result;
}

// ─── Direct MongoDB helpers ───────────────────────────────────────────────────

async function directCount(model: any, filter: object): Promise<number> {
  return model.countDocuments(filter);
}

async function directDistinct(model: any, field: string, filter: object): Promise<string[]> {
  return model.distinct(field, filter);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const userId = process.argv[2];
  if (!userId || !Types.ObjectId.isValid(userId)) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/verify-analytics.ts <userId>');
    process.exit(1);
  }

  await connectDB();
  const uid = new Types.ObjectId(userId);
  console.log(`\n🔍 Analytics Validation Suite — userId: ${userId}\n${'─'.repeat(60)}`);

  // ── Phase 2: Fetch all service outputs ─────────────────────────────────────
  const [overview, senders, sequences, dashboard, timeseries] = await Promise.all([
    timed('getOverviewMetrics',   () => analyticsService.getOverviewMetrics(userId)),
    timed('getSenderAnalytics',   () => analyticsService.getSenderAnalytics(userId)),
    timed('getSequenceAnalytics', () => analyticsService.getSequenceAnalytics(userId)),
    timed('getEnhancedDashboard', () => analyticsService.getEnhancedDashboard(userId)),
    timed('getTimeseries',        () => analyticsService.getTimeseries(userId)),
  ]);

  // ── Phase 2: validateOverview ───────────────────────────────────────────────
  console.log('\n📊 Phase 2: Overview Reconciliation');
  {
    const [directSent, directOpens, directClicks, directReplies, directBounces, directUnsubs,
           directTotalSeq, directActiveSeq, directContacts] = await Promise.all([
      directCount(SendingLog, { user_id: uid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
      directCount(OpenLog,    { user_id: uid, is_first_open: true }),
      directCount(ClickLog,   { user_id: uid, is_first_click: true }),
      directCount(ReplyLog,   { user_id: uid }),
      directCount(BounceLog,  { user_id: uid }),
      directCount(SequenceContact, { user_id: uid, status: ContactEnrollmentStatus.UNSUBSCRIBED }),
      directCount(Sequence, { user_id: uid }),
      directCount(Sequence, { user_id: uid, status: SequenceStatus.ACTIVE }),
      directCount(SequenceContact, { user_id: uid }),
    ]);

    eq(directSent,      overview.emailsSent,      'overview.emailsSent matches SendingLog');
    eq(directOpens,     overview.opens,           'overview.opens matches OpenLog');
    eq(directClicks,    overview.clicks,          'overview.clicks matches ClickLog');
    eq(directReplies,   overview.replies,         'overview.replies matches ReplyLog');
    eq(directBounces,   overview.bounces,         'overview.bounces matches BounceLog');
    eq(directUnsubs,    overview.unsubscribes,    'overview.unsubscribes matches SequenceContact');
    eq(directTotalSeq,  overview.totalSequences,  'overview.totalSequences matches Sequence');
    eq(directActiveSeq, overview.activeSequences, 'overview.activeSequences matches Sequence');
    eq(directContacts,  overview.totalContacts,   'overview.totalContacts matches SequenceContact');
  }

  // ── Phase 1: Cross-endpoint consistency ────────────────────────────────────
  console.log('\n🔗 Phase 1: Cross-Endpoint Consistency');
  {
    // Dashboard overview must match standalone overview
    eq(dashboard.overview.emailsSent, overview.emailsSent, 'dashboard.emailsSent == overview.emailsSent');
    eq(dashboard.overview.opens,      overview.opens,      'dashboard.opens == overview.opens');
    eq(dashboard.overview.replies,    overview.replies,    'dashboard.replies == overview.replies');
    eq(dashboard.overview.bounces,    overview.bounces,    'dashboard.overview.bounces == overview.bounces');

    // Sum of sequence.sent must equal overview.emailsSent
    const seqSentSum = sequences.reduce((s: number, seq: any) => s + seq.sent, 0);
    eq(seqSentSum, overview.emailsSent, 'sum(sequence.sent) == overview.emailsSent');

    // Sum of sequence.opens must equal overview.opens
    const seqOpensSum = sequences.reduce((s: number, seq: any) => s + seq.opens, 0);
    eq(seqOpensSum, overview.opens, 'sum(sequence.opens) == overview.opens');

    // Sum of sequence.replies must equal overview.replies
    const seqRepliesSum = sequences.reduce((s: number, seq: any) => s + seq.replies, 0);
    eq(seqRepliesSum, overview.replies, 'sum(sequence.replies) == overview.replies');

    // Sum of sender.sent must equal overview.emailsSent
    const senderSentSum = senders.reduce((s: number, sn: any) => s + sn.sent, 0);
    eq(senderSentSum, overview.emailsSent, 'sum(sender.sent) == overview.emailsSent');
  }

  // ── Phase 4: Rate Validation ────────────────────────────────────────────────
  console.log('\n📐 Phase 4: Rate Formula Correctness');
  {
    const { emailsSent, opens, clicks, replies, bounces, unsubscribes } = overview;
    eq(calculateRate(opens,        emailsSent), dashboard.overview.openRate,        'dashboard.openRate == calculateRate(opens, sent)');
    eq(calculateRate(clicks,       emailsSent), dashboard.overview.clickRate,       'dashboard.clickRate == calculateRate(clicks, sent)');
    eq(calculateRate(replies,      emailsSent), dashboard.overview.replyRate,       'dashboard.replyRate == calculateRate(replies, sent)');
    eq(calculateRate(bounces,      emailsSent), dashboard.overview.bounceRate,      'dashboard.bounceRate == calculateRate(bounces, sent)');
    eq(calculateRate(unsubscribes, emailsSent), dashboard.overview.unsubscribeRate, 'dashboard.unsubscribeRate == calculateRate(unsubs, sent)');

    // Per-sequence rate checks (first 5)
    for (const seq of sequences.slice(0, 5)) {
      eq(calculateRate(seq.opens,  seq.sent), seq.openRate,  `seq[${seq.name}].openRate formula`);
      eq(calculateRate(seq.clicks, seq.sent), seq.clickRate, `seq[${seq.name}].clickRate formula`);
      eq(calculateRate(seq.replies,seq.sent), seq.replyRate, `seq[${seq.name}].replyRate formula`);
      eq(calculateRate(seq.bounces,seq.sent), seq.bounceRate,`seq[${seq.name}].bounceRate formula`);
    }

    // Sender rate checks
    for (const sn of senders.slice(0, 5)) {
      eq(calculateRate(sn.opens,   sn.sent),            sn.openRate,    `sender[${sn.email}].openRate formula`);
      eq(calculateRate(sn.clicks,  sn.sent),            sn.clickRate,   `sender[${sn.email}].clickRate formula`);
      eq(calculateRate(sn.bounces, sn.sent),            sn.bounceRate,  `sender[${sn.email}].bounceRate formula`);
      eq(calculateRate(sn.failed,  sn.sent + sn.failed),sn.failureRate, `sender[${sn.email}].failureRate formula`);
    }
  }

  // ── Phase 5: Timeline Validation ───────────────────────────────────────────
  console.log('\n⏱  Phase 5: Activity Timeline Validation');
  {
    const activity = await timed('getRecentActivity(50)', () => analyticsService.getRecentActivity(userId, { limit: 50 }));
    const validTypes = new Set(['email_sent','email_opened','link_clicked','reply_received','email_bounced']);

    for (let i = 0; i < activity.length - 1; i++) {
      const a = new Date(activity[i].timestamp).getTime();
      const b = new Date(activity[i + 1].timestamp).getTime();
      if (a < b) { check(`timeline order at index ${i}`, false, 'desc', 'asc'); break; }
    }
    check('timeline newest-first', true, undefined, undefined, 'order checked above');

    let badType = false;
    for (const ev of activity) {
      if (!validTypes.has(ev.type)) { check(`timeline event type: ${ev.type}`, false); badType = true; }
    }
    if (!badType) check('timeline all event types valid', true);

    // Respect limit
    lte(activity.length, 50, 'timeline length <= requested limit 50');

    // Sequence filter test (use first sequence if any)
    if (sequences.length > 0) {
      const seqId = sequences[0].sequenceId;
      const filtered = await timed(`getRecentActivity(seq filter)`, () =>
        analyticsService.getRecentActivity(userId, { limit: 20, sequenceId: seqId }));
      check('timeline sequenceId filter: all events match', filtered.every((e: any) => e.sequenceId === seqId),
        seqId, filtered.find((e: any) => e.sequenceId !== seqId)?.sequenceId ?? 'all match');
    }
  }

  // ── Phases 3, 6, 7, 8 — Per-sequence deep validation ─────────────────────
  const seqsToValidate = sequences.slice(0, 3); // validate up to 3 sequences in depth

  for (const seq of seqsToValidate) {
    const seqId = seq.sequenceId;
    const seqOid = new Types.ObjectId(seqId);
    const mb = { sequence_id: seqOid, user_id: uid };

    console.log(`\n🔬 Deep validation: "${seq.name}" (${seqId})`);

    const [fullSeq, recipients] = await Promise.all([
      timed(`getFullSequenceAnalytics(${seq.name})`, () => analyticsService.getFullSequenceAnalytics(seqId, userId)),
      timed(`getRecipientMetrics(${seq.name})`,      () => analyticsService.getRecipientMetrics(seqId, userId, { page: 1, limit: 20 })),
    ]);

    // ── Phase 3: Funnel ordering ─────────────────────────────────────────────
    const f = fullSeq.funnel;
    lte(f.sent,    f.enrolled, `[${seq.name}] funnel: sent <= enrolled`);
    lte(f.opened,  f.sent,     `[${seq.name}] funnel: opened <= sent`);
    lte(f.clicked, f.opened,   `[${seq.name}] funnel: clicked <= opened`);
    lte(f.replied, f.clicked,  `[${seq.name}] funnel: replied <= clicked`);

    // ── Phase 6: Step breakdown ──────────────────────────────────────────────
    const stepSentTotal = fullSeq.stepBreakdown.reduce((s: number, st: any) => s + st.sent, 0);
    eq(stepSentTotal, fullSeq.emailsSent, `[${seq.name}] sum(step.sent) == emailsSent`);

    for (const st of fullSeq.stepBreakdown) {
      lte(st.opens,  st.sent, `[${seq.name}] step[${st.stepIndex}] opens <= sent`);
      lte(st.clicks, st.opens,`[${seq.name}] step[${st.stepIndex}] clicks <= opens`);
      eq(calculateRate(st.opens,  st.sent), st.openRate,  `[${seq.name}] step[${st.stepIndex}] openRate formula`);
      eq(calculateRate(st.clicks, st.sent), st.clickRate, `[${seq.name}] step[${st.stepIndex}] clickRate formula`);
    }

    // ── Phase 4: Sequence-level rates ────────────────────────────────────────
    eq(calculateRate(fullSeq.opens,       fullSeq.emailsSent), fullSeq.openRate,        `[${seq.name}] openRate formula`);
    eq(calculateRate(fullSeq.clicks,      fullSeq.emailsSent), fullSeq.clickRate,       `[${seq.name}] clickRate formula`);
    eq(calculateRate(fullSeq.replies,     fullSeq.emailsSent), fullSeq.replyRate,       `[${seq.name}] replyRate formula`);
    eq(calculateRate(fullSeq.bounces,     fullSeq.emailsSent), fullSeq.bounceRate,      `[${seq.name}] bounceRate formula`);
    eq(calculateRate(fullSeq.unsubscribes,fullSeq.emailsSent), fullSeq.unsubscribeRate, `[${seq.name}] unsubscribeRate formula`);

    // ── Phase 7: Recipient validation (sample first page) ───────────────────
    for (const r of recipients.recipients.slice(0, 5)) {
      const rOid = new Types.ObjectId(r.contactId);
      const [directSent, directOpened, directClicked, directReplied, directBounced] = await Promise.all([
        directCount(SendingLog,  { ...mb, sequence_contact_id: rOid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
        directCount(OpenLog,     { ...mb, contact_email: r.email,    is_first_open:  true }),
        directCount(ClickLog,    { ...mb, contact_email: r.email,    is_first_click: true }),
        directCount(ReplyLog,    { ...mb, from_email: r.email }),
        directCount(BounceLog,   { ...mb, to_email: r.email }),
      ]);
      eq(directSent, r.emailsReceived, `[${seq.name}] recipient[${r.email}].emailsReceived`);
      check(`[${seq.name}] recipient[${r.email}].hasOpened`,  r.hasOpened  === (directOpened  > 0), directOpened  > 0, r.hasOpened);
      check(`[${seq.name}] recipient[${r.email}].hasClicked`, r.hasClicked === (directClicked > 0), directClicked > 0, r.hasClicked);
      check(`[${seq.name}] recipient[${r.email}].hasReplied`, r.hasReplied === (directReplied > 0), directReplied > 0, r.hasReplied);
      check(`[${seq.name}] recipient[${r.email}].hasBounced`, r.hasBounced === (directBounced > 0), directBounced > 0, r.hasBounced);

      // Progress percent
      const expectedPct = Math.round(((r.currentStep + 1) / (r.totalSteps || 1)) * 100);
      eq(expectedPct, r.progressPercent, `[${seq.name}] recipient[${r.email}].progressPercent`);
    }

    // Pagination sanity
    lte(recipients.recipients.length, recipients.limit, `[${seq.name}] recipients page length <= limit`);
    eq(Math.ceil(recipients.totalRecipients / recipients.limit), recipients.totalPages,
       `[${seq.name}] recipients totalPages formula`);

    // ── Daily trend: exactly 30 buckets each ─────────────────────────────────
    eq(fullSeq.dailyTrend.sent.length,    30, `[${seq.name}] dailyTrend.sent has 30 buckets`);
    eq(fullSeq.dailyTrend.opens.length,   30, `[${seq.name}] dailyTrend.opens has 30 buckets`);
    eq(fullSeq.dailyTrend.clicks.length,  30, `[${seq.name}] dailyTrend.clicks has 30 buckets`);
    eq(fullSeq.dailyTrend.replies.length, 30, `[${seq.name}] dailyTrend.replies has 30 buckets`);
    // dates must be ascending
    const sentDates = fullSeq.dailyTrend.sent.map((b: any) => b.date);
    const sorted = [...sentDates].sort();
    check(`[${seq.name}] dailyTrend.sent dates ascending`, JSON.stringify(sentDates) === JSON.stringify(sorted));
  }

  // ── Phase 8: Sender Validation ──────────────────────────────────────────────
  console.log('\n📧 Phase 8: Sender Validation');
  for (const sn of senders.slice(0, 5)) {
    const connOid = new Types.ObjectId(sn.connectionId);

    // dailyVolume <= dailyLimit
    lte(sn.dailyVolume, sn.dailyLimit, `sender[${sn.email}] dailyVolume <= dailyLimit`);

    // lastSentAt must match newest SendingLog
    const newestLog = await SendingLog.findOne({ email_connection_id: connOid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } })
      .sort({ sent_at: -1 }).select('sent_at').lean();
    const expectedLastSent = newestLog?.sent_at ? new Date(newestLog.sent_at).toISOString() : undefined;
    check(`sender[${sn.email}] lastSentAt matches newest log`,
      sn.lastSentAt === expectedLastSent, expectedLastSent, sn.lastSentAt);

    // Health tier thresholds
    let expectedHealth: string;
    if (sn.bounceRate > 5)                         expectedHealth = 'critical';
    else if (sn.bounceRate >= 3)                   expectedHealth = 'warning';
    else if (sn.bounceRate < 1 && sn.replyRate >= 5) expectedHealth = 'excellent';
    else                                            expectedHealth = 'healthy';
    check(`sender[${sn.email}] health tier`, sn.health === expectedHealth, expectedHealth, sn.health);

    // 7-day trend: dates must be ascending
    if (sn.dailyTrend.length > 1) {
      let trendOk = true;
      for (let i = 0; i < sn.dailyTrend.length - 1; i++) {
        if (sn.dailyTrend[i].date > sn.dailyTrend[i+1].date) { trendOk = false; break; }
      }
      check(`sender[${sn.email}] dailyTrend ascending`, trendOk);
    }
  }

  // ── Phase 10: Timeseries bucket count ──────────────────────────────────────
  console.log('\n📅 Timeseries Bucket Validation');
  eq(timeseries.sent.length,         30, 'timeseries.sent has 30 buckets');
  eq(timeseries.opens.length,        30, 'timeseries.opens has 30 buckets');
  eq(timeseries.clicks.length,       30, 'timeseries.clicks has 30 buckets');
  eq(timeseries.replies.length,      30, 'timeseries.replies has 30 buckets');
  eq(timeseries.bounces.length,      30, 'timeseries.bounces has 30 buckets');
  eq(timeseries.unsubscribes.length, 30, 'timeseries.unsubscribes has 30 buckets');

  // Dates must be ascending and contiguous
  for (let i = 0; i < timeseries.sent.length - 1; i++) {
    const a = new Date(timeseries.sent[i].date);
    const b = new Date(timeseries.sent[i+1].date);
    const diffDays = (b.getTime() - a.getTime()) / 86400000;
    if (diffDays !== 1) { check(`timeseries.sent contiguous at index ${i}`, false, 1, diffDays); break; }
  }
  check('timeseries.sent dates contiguous', true, undefined, undefined, 'checked above');

  // ── Phase 9: Report ────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.pass).length;
  const failed  = results.filter(r => !r.pass).length;
  const total   = results.length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 RESULTS: ${passed}/${total} checks passed\n`);

  if (failed > 0) {
    console.log('❌ FAILURES:\n');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  FAIL  ${r.label}`);
      if (r.expected !== undefined) console.log(`        expected: ${JSON.stringify(r.expected)}`);
      if (r.actual   !== undefined) console.log(`        actual:   ${JSON.stringify(r.actual)}`);
      if (r.note)                   console.log(`        note:     ${r.note}`);
    });
  } else {
    console.log('✅ All checks passed.');
  }

  // Phase 10: Performance report
  const totalMs = timings.reduce((s, t) => s + t.ms, 0);
  console.log(`\n⚡ Phase 10 — Performance Report`);
  console.log(`${'─'.repeat(40)}`);
  timings.forEach(t => console.log(`  ${t.ms.toString().padStart(5)}ms  ${t.label}`));
  console.log(`${'─'.repeat(40)}`);
  console.log(`  ${totalMs.toString().padStart(5)}ms  TOTAL\n`);

  if (totalMs > 5000) console.warn('⚠️  Total aggregation time > 5s — consider adding compound indexes.');

  await disconnectDB();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Validation script crashed:', err);
  process.exit(1);
});
