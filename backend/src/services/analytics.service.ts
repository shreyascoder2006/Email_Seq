import { Types } from 'mongoose';
import { Sequence, SequenceStatus } from '../models/Sequence';
import { SequenceContact } from '../models/SequenceContact';
import { SendingLog, SendStatus } from '../models/SendingLog';
import { OpenLog } from '../models/OpenLog';
import { ClickLog } from '../models/ClickLog';
import { ReplyLog } from '../models/ReplyLog';
import { BounceLog } from '../models/BounceLog';
import { EmailConnection } from '../models/EmailConnection';
import logger from '../config/logger';

export class AnalyticsService {
  /**
   * GET /api/analytics/overview
   * Returns system-wide KPI metrics for the user.
   */
  async getOverviewMetrics(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // Run parallel counting queries
    const [
      totalSequences,
      activeSequences,
      totalContacts,
      emailsSent,
      opens,
      clicks,
      replies,
      bounces
    ] = await Promise.all([
      Sequence.countDocuments({ user_id: userObjectId }),
      Sequence.countDocuments({ user_id: userObjectId, status: SequenceStatus.ACTIVE }),
      SequenceContact.countDocuments({ user_id: userObjectId }),
      SendingLog.countDocuments({ user_id: userObjectId, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
      OpenLog.countDocuments({ user_id: userObjectId, is_first_open: true }),
      ClickLog.countDocuments({ user_id: userObjectId, is_first_click: true }),
      ReplyLog.countDocuments({ user_id: userObjectId }),
      BounceLog.countDocuments({ user_id: userObjectId })
    ]);

    logger.debug('Analytics overview fetched', { userId });

    return {
      totalSequences,
      activeSequences,
      totalContacts,
      emailsSent,
      opens,
      clicks,
      replies,
      bounces
    };
  }

  /**
   * GET /api/analytics/timeseries
   * Returns daily counts for sent, opens, clicks, replies, bounces over the last 30 days.
   */
  async getTimeseries(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Reusable aggregation builder
    const dailyAgg = (model: typeof SendingLog | typeof OpenLog | typeof ClickLog | typeof ReplyLog | typeof BounceLog, dateField: string, extraMatch?: Record<string, unknown>) => {
      const matchStage: Record<string, unknown> = {
        user_id: userObjectId,
        [dateField]: { $gte: thirtyDaysAgo },
        ...extraMatch,
      };
      return model.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
    };

    const [sentRaw, opensRaw, clicksRaw, repliesRaw, bouncesRaw] = await Promise.all([
      dailyAgg(SendingLog, 'sent_at', { status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
      dailyAgg(OpenLog, 'opened_at', { is_first_open: true }),
      dailyAgg(ClickLog, 'clicked_at', { is_first_click: true }),
      dailyAgg(ReplyLog, 'received_at'),
      dailyAgg(BounceLog, 'bounced_at'),
    ]);

    // Fill missing dates with zero
    const fillDates = (raw: Array<{ _id: string; count: number }>) => {
      const map = new Map(raw.map((r) => [r._id, r.count]));
      const result: Array<{ date: string; count: number }> = [];
      const cursor = new Date(thirtyDaysAgo);
      for (let i = 0; i < 30; i++) {
        const key = cursor.toISOString().slice(0, 10);
        result.push({ date: key, count: map.get(key) || 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      return result;
    };

    logger.debug('Analytics timeseries fetched', { userId });

    return {
      sent: fillDates(sentRaw),
      opens: fillDates(opensRaw),
      clicks: fillDates(clicksRaw),
      replies: fillDates(repliesRaw),
      bounces: fillDates(bouncesRaw),
    };
  }

  /**
   * GET /api/analytics/sequences
   * Returns per-sequence performance metrics with health scoring.
   * Uses denormalized stats field on Sequence + one parallel contact count aggregation.
   */
  async getSequenceAnalytics(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // Fetch all sequences for the user
    const sequences = await Sequence.find({ user_id: userObjectId })
      .select('_id name status stats')
      .lean();

    if (sequences.length === 0) return [];

    const seqIds = sequences.map((s) => s._id);

    // Single parallel aggregation: contacts per sequence_id
    const [contactCounts, sentCounts, opensCounts, clicksCounts, repliesCounts, bouncesCounts] = await Promise.all([
      SequenceContact.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds } } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
      SendingLog.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds }, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
      OpenLog.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds }, is_first_open: true } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
      ClickLog.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds }, is_first_click: true } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
      ReplyLog.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds } } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
      BounceLog.aggregate([
        { $match: { user_id: userObjectId, sequence_id: { $in: seqIds } } },
        { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
      ]),
    ]);

    // Build lookup maps keyed by sequence_id string
    const toMap = (agg: Array<{ _id: Types.ObjectId; count: number }>) =>
      new Map(agg.map((r) => [r._id.toString(), r.count]));

    const contactMap = toMap(contactCounts);
    const sentMap    = toMap(sentCounts);
    const opensMap   = toMap(opensCounts);
    const clicksMap  = toMap(clicksCounts);
    const repliesMap = toMap(repliesCounts);
    const bouncesMap = toMap(bouncesCounts);

    // Rate helper — avoids division by zero
    const rate = (numerator: number, denominator: number) =>
      denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;

    // Health scoring
    const calcHealth = (
      status: string,
      sent: number,
      openRate: number,
      replyRate: number,
      bounceRate: number
    ): 'excellent' | 'healthy' | 'warning' | 'stalled' => {
      if (status === SequenceStatus.ACTIVE && sent === 0) return 'stalled';
      if (replyRate >= 5) return 'excellent';
      if (bounceRate >= 5 || openRate < 5) return 'warning';
      return 'healthy';
    };

    const results = sequences.map((seq) => {
      const id = (seq._id as Types.ObjectId).toString();
      const contacts = contactMap.get(id) ?? 0;
      const sent     = sentMap.get(id)    ?? 0;
      const opens    = opensMap.get(id)   ?? 0;
      const clicks   = clicksMap.get(id)  ?? 0;
      const replies  = repliesMap.get(id) ?? 0;
      const bounces  = bouncesMap.get(id) ?? 0;

      const openRate   = rate(opens,   sent);
      const clickRate  = rate(clicks,  sent);
      const replyRate  = rate(replies, sent);
      const bounceRate = rate(bounces, sent);

      return {
        sequenceId: id,
        name:       seq.name,
        status:     seq.status,
        contacts,
        sent,
        opens,
        clicks,
        replies,
        bounces,
        openRate,
        clickRate,
        replyRate,
        bounceRate,
        health: calcHealth(seq.status, sent, openRate, replyRate, bounceRate),
      };
    });

    // Sort: highest replyRate first, then highest openRate
    results.sort((a, b) =>
      b.replyRate - a.replyRate || b.openRate - a.openRate
    );

    logger.debug('Analytics sequence performance fetched', { userId, count: results.length });
    return results;
  }

  /**
   * GET /api/analytics/senders
   * Returns performance analytics for each sender (EmailConnection).
   * Relies on SendingLog for attribution and uses targeted $lookup for OpenLog/ReplyLog.
   */
  async getSenderAnalytics(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // 1. Fetch all email connections for the user
    const connections = await EmailConnection.find({ user_id: userObjectId })
      .select('_id from_email label status daily_limit')
      .lean();

    if (connections.length === 0) return [];

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 2. Parallel aggregations
    const [sentStats, openStats, replyStats] = await Promise.all([
      // A. Sent, Bounces, Daily Volume from SendingLog
      SendingLog.aggregate([
        { $match: { user_id: userObjectId } },
        { $group: {
            _id: '$email_connection_id',
            sent: { $sum: { $cond: [{ $in: ['$status', [SendStatus.SENT, SendStatus.DELIVERED]] }, 1, 0] } },
            bounces: { $sum: { $cond: [{ $eq: ['$status', SendStatus.BOUNCED] }, 1, 0] } },
            dailyVolume: { $sum: { $cond: [{ $gte: ['$sent_at', twentyFourHoursAgo] }, 1, 0] } },
            lastSentAt: { $max: '$sent_at' }
        }}
      ]),
      // B. Opens from OpenLog
      OpenLog.aggregate([
        { $match: { user_id: userObjectId, is_first_open: true } },
        { $lookup: {
            from: 'sending_logs',
            localField: 'sending_log_id',
            foreignField: '_id',
            pipeline: [{ $project: { email_connection_id: 1 } }],
            as: 'send_log'
        }},
        { $unwind: '$send_log' },
        { $group: { _id: '$send_log.email_connection_id', opens: { $sum: 1 } } }
      ]),
      // C. Replies from ReplyLog
      ReplyLog.aggregate([
        { $match: { user_id: userObjectId } },
        { $lookup: {
            from: 'sending_logs',
            localField: 'sending_log_id',
            foreignField: '_id',
            pipeline: [{ $project: { email_connection_id: 1 } }],
            as: 'send_log'
        }},
        { $unwind: '$send_log' },
        { $group: { _id: '$send_log.email_connection_id', replies: { $sum: 1 } } }
      ])
    ]);

    // 3. Map results
    const toMap = (agg: Array<any>, key: string) =>
      new Map(agg.map((r) => [r._id.toString(), r[key]]));

    const sentMap = new Map(sentStats.map(r => [r._id.toString(), r.sent]));
    const bounceMap = new Map(sentStats.map(r => [r._id.toString(), r.bounces]));
    const dailyVolMap = new Map(sentStats.map(r => [r._id.toString(), r.dailyVolume]));
    const lastSentMap = new Map(sentStats.map(r => [r._id.toString(), r.lastSentAt]));
    
    const opensMap = toMap(openStats, 'opens');
    const repliesMap = toMap(replyStats, 'replies');

    const rate = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

    const calcHealth = (bounceRate: number, replyRate: number): 'excellent' | 'healthy' | 'warning' | 'critical' => {
      if (bounceRate > 5) return 'critical';
      if (bounceRate >= 3) return 'warning';
      if (bounceRate < 1 && replyRate >= 5) return 'excellent';
      return 'healthy';
    };

    const results = connections.map(conn => {
      const id = (conn._id as Types.ObjectId).toString();
      const sent = sentMap.get(id) || 0;
      const opens = opensMap.get(id) || 0;
      const replies = repliesMap.get(id) || 0;
      const bounces = bounceMap.get(id) || 0;
      const dailyVolume = dailyVolMap.get(id) || 0;
      const lastSentAt = lastSentMap.get(id);

      const openRate = rate(opens, sent);
      const replyRate = rate(replies, sent);
      const bounceRate = rate(bounces, sent);
      const limitUsagePercent = rate(dailyVolume, conn.daily_limit);

      return {
        connectionId: id,
        email: conn.from_email,
        label: conn.label,
        status: conn.status,
        sent,
        opens,
        replies,
        bounces,
        dailyVolume,
        dailyLimit: conn.daily_limit,
        openRate,
        replyRate,
        bounceRate,
        limitUsagePercent,
        health: calcHealth(bounceRate, replyRate),
        lastSentAt: lastSentAt ? lastSentAt.toISOString() : undefined,
      };
    });

    // Sort by health severity (Critical -> Warning -> Healthy -> Excellent)
    const severityMap: Record<string, number> = { critical: 4, warning: 3, healthy: 2, excellent: 1 };
    results.sort((a, b) => severityMap[b.health] - severityMap[a.health] || b.bounceRate - a.bounceRate);

    logger.debug('Analytics sender performance fetched', { userId, count: results.length });
    return results;
  }

  /**
   * GET /api/analytics/activity
   * Returns the 50 most recent events across all activity collections.
   * Uses 5 parallel find+sort+limit queries (no $lookup, no collection scans).
   */
  async getRecentActivity(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // Fetch top 50 recent records from each log collection in parallel
    const [sentLogs, openLogs, clickLogs, replyLogs, bounceLogs] = await Promise.all([
      SendingLog.find({ user_id: userObjectId, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } })
        .sort({ sent_at: -1 })
        .limit(50)
        .select('to_email sent_at sequence_id')
        .lean(),
      OpenLog.find({ user_id: userObjectId, is_first_open: true })
        .sort({ opened_at: -1 })
        .limit(50)
        .select('contact_email opened_at sequence_id')
        .lean(),
      ClickLog.find({ user_id: userObjectId, is_first_click: true })
        .sort({ clicked_at: -1 })
        .limit(50)
        .select('contact_email clicked_at sequence_id')
        .lean(),
      ReplyLog.find({ user_id: userObjectId })
        .sort({ received_at: -1 })
        .limit(50)
        .select('from_email received_at sequence_id')
        .lean(),
      BounceLog.find({ user_id: userObjectId })
        .sort({ bounced_at: -1 })
        .limit(50)
        .select('to_email bounced_at sequence_id')
        .lean(),
    ]);

    // Collect unique sequence_ids to resolve names in one query
    const seqIdSet = new Set<string>();
    [...sentLogs, ...openLogs, ...clickLogs, ...replyLogs, ...bounceLogs].forEach((doc) => {
      if (doc.sequence_id) seqIdSet.add(doc.sequence_id.toString());
    });

    const seqDocs = await Sequence.find({ _id: { $in: Array.from(seqIdSet).map((id) => new Types.ObjectId(id)) } })
      .select('_id name')
      .lean();
    const seqNameMap = new Map(seqDocs.map((s) => [s._id.toString(), s.name]));

    // Normalize each collection into a unified event shape
    type ActivityEvent = { type: string; email: string; sequenceName: string; timestamp: Date };

    const events: ActivityEvent[] = [
      ...sentLogs.map((d) => ({
        type: 'email_sent',
        email: d.to_email,
        sequenceName: seqNameMap.get(d.sequence_id?.toString() ?? '') ?? 'Unknown',
        timestamp: d.sent_at ?? new Date(0),
      })),
      ...openLogs.map((d) => ({
        type: 'email_opened',
        email: d.contact_email,
        sequenceName: seqNameMap.get(d.sequence_id?.toString() ?? '') ?? 'Unknown',
        timestamp: d.opened_at,
      })),
      ...clickLogs.map((d) => ({
        type: 'link_clicked',
        email: d.contact_email,
        sequenceName: seqNameMap.get(d.sequence_id?.toString() ?? '') ?? 'Unknown',
        timestamp: d.clicked_at,
      })),
      ...replyLogs.map((d) => ({
        type: 'reply_received',
        email: d.from_email,
        sequenceName: seqNameMap.get(d.sequence_id?.toString() ?? '') ?? 'Unknown',
        timestamp: d.received_at,
      })),
      ...bounceLogs.map((d) => ({
        type: 'email_bounced',
        email: d.to_email,
        sequenceName: seqNameMap.get(d.sequence_id?.toString() ?? '') ?? 'Unknown',
        timestamp: d.bounced_at,
      })),
    ];

    // Global sort descending + take top 50
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const top50 = events.slice(0, 50);

    logger.debug('Analytics activity fetched', { userId, count: top50.length });

    return top50.map((e) => ({
      type: e.type,
      email: e.email,
      sequenceName: e.sequenceName,
      timestamp: e.timestamp.toISOString(),
    }));
  }
}

export const analyticsService = new AnalyticsService();
