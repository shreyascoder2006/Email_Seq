/**
 * analytics.aggregations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable aggregation helpers for AnalyticsService.
 * Every duplicate pipeline, rate calculation, health score, and date-fill
 * lives here exactly once. AnalyticsService imports and composes these.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Types, PipelineStage } from 'mongoose';
import { SendingLog, SendStatus } from '../models/SendingLog';
import { OpenLog } from '../models/OpenLog';
import { ClickLog } from '../models/ClickLog';
import { ReplyLog } from '../models/ReplyLog';
import { BounceLog } from '../models/BounceLog';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { Sequence } from '../models/Sequence';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyBucket { date: string; count: number; }
export interface StepMetrics  { stepIndex: number; sent: number; opens: number; clicks: number; openRate: number; clickRate: number; label: string; }
export type SequenceHealthScore = 'excellent' | 'healthy' | 'warning' | 'stalled';
export type SenderHealthScore   = 'excellent' | 'healthy' | 'warning' | 'critical';

export interface ActivityEvent {
  type: string;
  email: string;
  sequenceId: string;
  sequenceName: string;
  stepIndex?: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

// ─── Phase 5: Consistent Rate Calculation ────────────────────────────────────

/** Round to 1 decimal. Returns 0 when denominator is 0. */
export function calculateRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

// ─── Phase 6: Campaign (Sequence) Health Engine ──────────────────────────────

export function calculateSequenceHealth(
  status: string,
  sent: number,
  openRate: number,
  replyRate: number,
  bounceRate: number,
): SequenceHealthScore {
  if (status === 'active' && sent === 0) return 'stalled';
  if (replyRate >= 5) return 'excellent';
  if (bounceRate >= 5 || openRate < 5) return 'warning';
  return 'healthy';
}

// ─── Phase 7: Sender Health Engine ───────────────────────────────────────────

export function calculateSenderHealth(
  bounceRate: number,
  replyRate: number,
): SenderHealthScore {
  if (bounceRate > 5)  return 'critical';
  if (bounceRate >= 3) return 'warning';
  if (bounceRate < 1 && replyRate >= 5) return 'excellent';
  return 'healthy';
}

// ─── Phase 4: Zero-filled Timeseries ────────────────────────────────────────

/**
 * Given raw MongoDB group-by-date results, returns exactly `days` consecutive
 * DailyBucket objects starting from `startDate`, with count=0 for missing days.
 */
export function fillDateBuckets(
  raw: Array<{ _id: string; count: number }>,
  startDate: Date,
  days = 30,
): DailyBucket[] {
  const map = new Map(raw.map(r => [r._id, r.count]));
  const result: DailyBucket[] = [];
  const cursor = new Date(startDate);
  for (let i = 0; i < days; i++) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// ─── Phase 2: Shared Pipeline Builders ───────────────────────────────────────

/** Returns a $group stage that counts documents by a date string. */
export function buildDailyGroupStage(dateField: string) {
  return {
    $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } },
      count: { $sum: 1 },
    },
  };
}

/**
 * Runs a single-collection daily aggregation against a log model.
 * Returns raw { _id: 'YYYY-MM-DD', count }[] results.
 */
export function buildDailyAgg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  dateField: string,
  matchBase: Record<string, unknown>,
  since: Date,
  extraMatch: Record<string, unknown> = {},
) {
  return model.aggregate([
    { $match: { ...matchBase, [dateField]: { $gte: since }, ...extraMatch } },
    buildDailyGroupStage(dateField),
    { $sort: { _id: 1 } },
  ]);
}

/**
 * Reusable $lookup pipeline for attributing events back to an EmailConnection
 * via their SendingLog.  Used by opens, clicks, and replies in getSenderAnalytics.
 */
export function buildConnectionLookupPipeline(countField: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'sending_logs',
        localField: 'sending_log_id',
        foreignField: '_id',
        pipeline: [{ $project: { email_connection_id: 1 } }],
        as: 'sl',
      },
    } as PipelineStage,
    { $unwind: '$sl' } as PipelineStage,
    { $group: { _id: '$sl.email_connection_id', [countField]: { $sum: 1 } } } as PipelineStage,
  ];
}

// ─── Phase 1: Compute Helpers ─────────────────────────────────────────────────

/** Compute counts per sequence_id across all event log collections in parallel. */
export async function computeSequenceEventCounts(
  userObjectId: Types.ObjectId,
  seqIds: Types.ObjectId[],
) {
  const matchSeqs = { user_id: userObjectId, sequence_id: { $in: seqIds } };

  const [contacts, sent, opens, clicks, replies, bounces, unsubs] = await Promise.all([
    SequenceContact.aggregate([
      { $match: matchSeqs },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    SendingLog.aggregate([
      { $match: { ...matchSeqs, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } } },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    OpenLog.aggregate([
      { $match: { ...matchSeqs, is_first_open: true } },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    ClickLog.aggregate([
      { $match: { ...matchSeqs, is_first_click: true } },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    ReplyLog.aggregate([
      { $match: matchSeqs },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    BounceLog.aggregate([
      { $match: matchSeqs },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
    SequenceContact.aggregate([
      { $match: { ...matchSeqs, status: ContactEnrollmentStatus.UNSUBSCRIBED } },
      { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
    ]),
  ]);

  const toMap = (agg: Array<{ _id: Types.ObjectId; count: number }>) =>
    new Map(agg.map(r => [r._id.toString(), r.count]));

  return {
    contactMap:  toMap(contacts),
    sentMap:     toMap(sent),
    opensMap:    toMap(opens),
    clicksMap:   toMap(clicks),
    repliesMap:  toMap(replies),
    bouncesMap:  toMap(bounces),
    unsubMap:    toMap(unsubs),
  };
}

/** Compute per-step sent/open/click counts for a single sequence. */
export async function computeStepBreakdown(
  matchBase: { sequence_id: Types.ObjectId; user_id: Types.ObjectId },
  stepLabels: Map<number, string>,
): Promise<StepMetrics[]> {
  const [stepSent, stepOpens, stepClicks] = await Promise.all([
    SendingLog.aggregate([
      { $match: { ...matchBase, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } } },
      { $group: { _id: '$step_index', sent: { $sum: 1 } } },
    ]),
    OpenLog.aggregate([
      { $match: { ...matchBase, is_first_open: true } },
      { $group: { _id: '$step_index', opens: { $sum: 1 } } },
    ]),
    ClickLog.aggregate([
      { $match: { ...matchBase, is_first_click: true } },
      { $group: { _id: '$step_index', clicks: { $sum: 1 } } },
    ]),
  ]);

  const sentByStep   = new Map((stepSent   as any[]).map(r => [r._id as number, r.sent   as number]));
  const opensByStep  = new Map((stepOpens  as any[]).map(r => [r._id as number, r.opens  as number]));
  const clicksByStep = new Map((stepClicks as any[]).map(r => [r._id as number, r.clicks as number]));
  const allIdx = Array.from(new Set([...sentByStep.keys(), ...opensByStep.keys()])).sort((a, b) => a - b);

  return allIdx.map(idx => {
    const s = sentByStep.get(idx)   ?? 0;
    const o = opensByStep.get(idx)  ?? 0;
    const c = clicksByStep.get(idx) ?? 0;
    return {
      stepIndex: idx,
      label:     stepLabels.get(idx) ?? `Step ${idx + 1}`,
      sent: s, opens: o, clicks: c,
      openRate:  calculateRate(o, s),
      clickRate: calculateRate(c, s),
    };
  });
}

/** Compute 30-day daily trend for a sequence across 4 event types in parallel. */
export async function computeSequenceDailyTrend(
  matchBase: { sequence_id: Types.ObjectId; user_id: Types.ObjectId },
  startDate: Date,
): Promise<{ sent: DailyBucket[]; opens: DailyBucket[]; clicks: DailyBucket[]; replies: DailyBucket[] }> {
  const [rawSent, rawOpens, rawClicks, rawReplies] = await Promise.all([
    buildDailyAgg(SendingLog, 'sent_at',    matchBase, startDate, { status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
    buildDailyAgg(OpenLog,    'opened_at',  matchBase, startDate, { is_first_open: true }),
    buildDailyAgg(ClickLog,   'clicked_at', matchBase, startDate, { is_first_click: true }),
    buildDailyAgg(ReplyLog,   'received_at',matchBase, startDate),
  ]);
  return {
    sent:    fillDateBuckets(rawSent,    startDate),
    opens:   fillDateBuckets(rawOpens,   startDate),
    clicks:  fillDateBuckets(rawClicks,  startDate),
    replies: fillDateBuckets(rawReplies, startDate),
  };
}

/** Compute recipient status counts and funnel uniques for a sequence. */
export async function computeRecipientSummaryAndFunnel(
  matchBase: { sequence_id: Types.ObjectId; user_id: Types.ObjectId },
) {
  const [
    totalContacts, activeContacts, completedContacts, bouncedContacts,
    unsubscribedContacts, pausedContacts, repliedContacts,
    emailsSent, opens, clicks, replies, bounces,
    uniqueOpeners, uniqueClickers, uniqueRepliers, uniqueSentContacts,
  ] = await Promise.all([
    SequenceContact.countDocuments({ ...matchBase, status: { $nin: [ContactEnrollmentStatus.REMOVED, ContactEnrollmentStatus.SKIPPED] } }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.ACTIVE }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.COMPLETED }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.BOUNCED }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.UNSUBSCRIBED }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.PAUSED }),
    SequenceContact.countDocuments({ ...matchBase, status: ContactEnrollmentStatus.REPLIED }),
    SendingLog.countDocuments({ ...matchBase, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
    OpenLog.countDocuments({ ...matchBase, is_first_open: true }),
    ClickLog.countDocuments({ ...matchBase, is_first_click: true }),
    ReplyLog.countDocuments(matchBase),
    BounceLog.countDocuments(matchBase),
    OpenLog.distinct('contact_email', { ...matchBase, is_first_open: true }),
    ClickLog.distinct('contact_email', { ...matchBase, is_first_click: true }),
    ReplyLog.distinct('from_email', matchBase),
    SendingLog.distinct('sequence_contact_id', { ...matchBase, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
  ]);

  return {
    contacts: { total: totalContacts, active: activeContacts, paused: pausedContacts, completed: completedContacts, bounced: bouncedContacts, unsubscribed: unsubscribedContacts, replied: repliedContacts },
    emailsSent, opens, clicks, replies, bounces,
    unsubscribes: unsubscribedContacts,
    funnel: {
      enrolled: totalContacts,
      sent:     uniqueSentContacts.length,
      opened:   uniqueOpeners.length,
      clicked:  uniqueClickers.length,
      replied:  uniqueRepliers.length,
    },
    recipientSummary: { active: activeContacts, paused: pausedContacts, completed: completedContacts, bounced: bouncedContacts, replied: repliedContacts, unsubscribed: unsubscribedContacts },
  };
}

// ─── Phase 8: Unified Timeline Builder ───────────────────────────────────────

/**
 * Fetches and merges events from all 5 log collections into one sorted timeline.
 * Resolves sequence names via a single batch Sequence.find.
 */
export async function buildEventTimeline(
  userObjectId: Types.ObjectId,
  opts: { limit?: number; sequenceId?: Types.ObjectId } = {},
): Promise<ActivityEvent[]> {
  const limit = opts.limit ?? 50;
  const seqFilter = opts.sequenceId ? { sequence_id: opts.sequenceId } : {};
  const base = { user_id: userObjectId, ...seqFilter };

  const [sentLogs, openLogs, clickLogs, replyLogs, bounceLogs] = await Promise.all([
    SendingLog.find({ ...base, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } })
      .sort({ sent_at: -1 }).limit(limit)
      .select('to_email sent_at sequence_id step_index').lean(),
    OpenLog.find({ ...base, is_first_open: true })
      .sort({ opened_at: -1 }).limit(limit)
      .select('contact_email opened_at sequence_id step_index').lean(),
    ClickLog.find({ ...base, is_first_click: true })
      .sort({ clicked_at: -1 }).limit(limit)
      .select('contact_email clicked_at sequence_id step_index original_url').lean(),
    ReplyLog.find(base)
      .sort({ received_at: -1 }).limit(limit)
      .select('from_email received_at sequence_id replied_to_step_index classification').lean(),
    BounceLog.find(base)
      .sort({ bounced_at: -1 }).limit(limit)
      .select('to_email bounced_at sequence_id step_index bounce_type').lean(),
  ]);

  // Resolve sequence names in one batch query
  const seqIdSet = new Set<string>();
  [...sentLogs, ...openLogs, ...clickLogs, ...replyLogs, ...bounceLogs].forEach(d => {
    if (d.sequence_id) seqIdSet.add(d.sequence_id.toString());
  });
  const seqDocs = await Sequence.find({ _id: { $in: Array.from(seqIdSet).map(id => new Types.ObjectId(id)) } })
    .select('_id name').lean();
  const nameMap = new Map(seqDocs.map(s => [s._id.toString(), s.name]));

  const name = (id: Types.ObjectId | undefined) => nameMap.get(id?.toString() ?? '') ?? 'Unknown';
  const sid  = (id: Types.ObjectId | undefined) => id?.toString() ?? '';

  const events: Array<{ ts: Date } & ActivityEvent> = [
    ...(sentLogs as any[]).map(d => ({
      ts: d.sent_at ?? new Date(0), type: 'email_sent', email: d.to_email,
      sequenceId: sid(d.sequence_id), sequenceName: name(d.sequence_id),
      stepIndex: d.step_index, timestamp: '', metadata: {} as Record<string, unknown>,
    })),
    ...(openLogs as any[]).map(d => ({
      ts: d.opened_at, type: 'email_opened', email: d.contact_email,
      sequenceId: sid(d.sequence_id), sequenceName: name(d.sequence_id),
      stepIndex: d.step_index, timestamp: '', metadata: {} as Record<string, unknown>,
    })),
    ...(clickLogs as any[]).map(d => ({
      ts: d.clicked_at, type: 'link_clicked', email: d.contact_email,
      sequenceId: sid(d.sequence_id), sequenceName: name(d.sequence_id),
      stepIndex: d.step_index, timestamp: '', metadata: { originalUrl: d.original_url } as Record<string, unknown>,
    })),
    ...(replyLogs as any[]).map(d => ({
      ts: d.received_at, type: 'reply_received', email: d.from_email,
      sequenceId: sid(d.sequence_id), sequenceName: name(d.sequence_id),
      stepIndex: d.replied_to_step_index, timestamp: '', metadata: { classification: d.classification } as Record<string, unknown>,
    })),
    ...(bounceLogs as any[]).map(d => ({
      ts: d.bounced_at, type: 'email_bounced', email: d.to_email,
      sequenceId: sid(d.sequence_id), sequenceName: name(d.sequence_id),
      stepIndex: d.step_index, timestamp: '', metadata: { bounceType: d.bounce_type } as Record<string, unknown>,
    })),
  ];

  events.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  return events.slice(0, limit).map(({ ts, ...rest }) => ({
    ...rest,
    timestamp: ts.toISOString(),
  }));
}

// ─── Phase 9: 30-day startDate helper ────────────────────────────────────────

export function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  d.setHours(0, 0, 0, 0);
  return d;
}
