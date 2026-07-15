import { Types } from 'mongoose';
import { Sequence, SequenceStatus } from '../models/Sequence';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { SequenceStep } from '../models/SequenceStep';
import { SendingLog, SendStatus } from '../models/SendingLog';
import { OpenLog } from '../models/OpenLog';
import { ClickLog } from '../models/ClickLog';
import { ReplyLog } from '../models/ReplyLog';
import { BounceLog } from '../models/BounceLog';
import { EmailConnection } from '../models/EmailConnection';
import logger from '../config/logger';
import {
  calculateRate,
  calculateSequenceHealth,
  calculateSenderHealth,
  fillDateBuckets,
  buildDailyAgg,
  buildConnectionLookupPipeline,
  computeSequenceEventCounts,
  computeStepBreakdown,
  computeSequenceDailyTrend,
  computeRecipientSummaryAndFunnel,
  buildEventTimeline,
  thirtyDaysAgo,
} from './analytics.aggregations';
import {
  buildAnalyticsFilter,
  buildRecipientFilter,
  dateMatchForField,
  withSequenceId,
  withSenderId,
  type AnalyticsFilterInput,
  type RecipientFilterInput,
  type SenderFilterInput,
} from './analytics.filters';

export class AnalyticsService {

  // ─── Overview ────────────────────────────────────────────────────────────
  async getOverviewMetrics(userId: string, filterInput: AnalyticsFilterInput = {}) {
    const uid = new Types.ObjectId(userId);
    const f   = buildAnalyticsFilter(filterInput);
    const dateBase = { $gte: f.dateRange.from, $lte: f.dateRange.to };
    const seqMatch = f.sequenceId ? { sequence_id: f.sequenceId } : {};
    const sndMatch = f.senderId   ? { email_connection_id: f.senderId } : {};

    const [totalSequences, activeSequences, totalContacts,
      emailsSent, opens, clicks, replies, bounces, unsubscribes] = await Promise.all([
      Sequence.countDocuments({ user_id: uid }),
      Sequence.countDocuments({ user_id: uid, status: SequenceStatus.ACTIVE }),
      SequenceContact.countDocuments({ user_id: uid, ...seqMatch }),
      SendingLog.countDocuments({ user_id: uid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] }, sent_at: dateBase, ...seqMatch, ...sndMatch }),
      OpenLog.countDocuments({ user_id: uid, is_first_open: true, opened_at: dateBase, ...seqMatch }),
      ClickLog.countDocuments({ user_id: uid, is_first_click: true, clicked_at: dateBase, ...seqMatch }),
      ReplyLog.countDocuments({ user_id: uid, received_at: dateBase, ...seqMatch }),
      BounceLog.countDocuments({ user_id: uid, bounced_at: dateBase, ...seqMatch }),
      SequenceContact.countDocuments({ user_id: uid, status: ContactEnrollmentStatus.UNSUBSCRIBED, ...seqMatch }),
    ]);
    logger.debug('Analytics overview fetched', { userId });
    return { totalSequences, activeSequences, totalContacts, emailsSent, opens, clicks, replies, bounces, unsubscribes };
  }

  // ─── Timeseries ───────────────────────────────────────────────────────────
  async getTimeseries(userId: string, filterInput: AnalyticsFilterInput = {}) {
    const uid  = new Types.ObjectId(userId);
    const f    = buildAnalyticsFilter(filterInput);
    const since = f.dateRange.from;
    const until = f.dateRange.to;
    const days  = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000) + 1);
    const seqMatch = f.sequenceId ? { sequence_id: f.sequenceId } : {};
    const sndMatch = f.senderId   ? { email_connection_id: f.senderId } : {};
    const base = { user_id: uid, ...seqMatch, ...sndMatch };

    const [sentRaw, opensRaw, clicksRaw, repliesRaw, bouncesRaw, unsubRaw] = await Promise.all([
      buildDailyAgg(SendingLog, 'sent_at',    base, since, { status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } }),
      buildDailyAgg(OpenLog,    'opened_at',  { user_id: uid, ...seqMatch }, since, { is_first_open: true }),
      buildDailyAgg(ClickLog,   'clicked_at', { user_id: uid, ...seqMatch }, since, { is_first_click: true }),
      buildDailyAgg(ReplyLog,   'received_at',{ user_id: uid, ...seqMatch }, since),
      buildDailyAgg(BounceLog,  'bounced_at', { user_id: uid, ...seqMatch }, since),
      SequenceContact.aggregate([
        { $match: { user_id: uid, ...seqMatch, status: ContactEnrollmentStatus.UNSUBSCRIBED, unsubscribed_at: { $gte: since, $lte: until } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$unsubscribed_at' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    logger.debug('Analytics timeseries fetched', { userId });
    return {
      sent:         fillDateBuckets(sentRaw,    since, days),
      opens:        fillDateBuckets(opensRaw,   since, days),
      clicks:       fillDateBuckets(clicksRaw,  since, days),
      replies:      fillDateBuckets(repliesRaw, since, days),
      bounces:      fillDateBuckets(bouncesRaw, since, days),
      unsubscribes: fillDateBuckets(unsubRaw,   since, days),
    };
  }

  // ─── Sequence List Analytics ──────────────────────────────────────────────
  async getSequenceAnalytics(userId: string) {
    const uid = new Types.ObjectId(userId);
    const sequences = await Sequence.find({ user_id: uid }).select('_id name status').lean();
    if (sequences.length === 0) return [];

    const seqIds = sequences.map(s => s._id as Types.ObjectId);
    const maps = await computeSequenceEventCounts(uid, seqIds);

    const results = sequences.map(seq => {
      const id           = (seq._id as Types.ObjectId).toString();
      const contacts     = maps.contactMap.get(id)  ?? 0;
      const sent         = maps.sentMap.get(id)     ?? 0;
      const opens        = maps.opensMap.get(id)    ?? 0;
      const clicks       = maps.clicksMap.get(id)   ?? 0;
      const replies      = maps.repliesMap.get(id)  ?? 0;
      const bounces      = maps.bouncesMap.get(id)  ?? 0;
      const unsubscribes = maps.unsubMap.get(id)    ?? 0;
      const openRate        = calculateRate(opens,        sent);
      const clickRate       = calculateRate(clicks,       sent);
      const replyRate       = calculateRate(replies,      sent);
      const bounceRate      = calculateRate(bounces,      sent);
      const unsubscribeRate = calculateRate(unsubscribes, sent);
      return {
        sequenceId: id, name: seq.name, status: seq.status,
        contacts, sent, opens, clicks, replies, bounces, unsubscribes,
        openRate, clickRate, replyRate, bounceRate, unsubscribeRate,
        health: calculateSequenceHealth(seq.status, sent, openRate, replyRate, bounceRate),
      };
    });

    results.sort((a, b) => b.replyRate - a.replyRate || b.openRate - a.openRate);
    logger.debug('Sequence analytics fetched', { userId, count: results.length });
    return results;
  }

  // ─── Sender Analytics ─────────────────────────────────────────────────────
  async getSenderAnalytics(userId: string, filterInput: SenderFilterInput = {}) {
    const uid = new Types.ObjectId(userId);
    const connQuery: Record<string, unknown> = { user_id: uid };
    if (filterInput.status) connQuery.status = filterInput.status;
    if (filterInput.search) connQuery.from_email = { $regex: filterInput.search, $options: 'i' };
    const connections = await EmailConnection.find(connQuery)
      .select('_id from_email label status daily_limit').lean();
    if (connections.length === 0) return [];


    const now             = new Date();
    const twentyFourHAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo    = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

    const [sentStats, openStats, replyStats, clickStats, trendStats] = await Promise.all([
      SendingLog.aggregate([
        { $match: { user_id: uid } },
        { $group: {
            _id: '$email_connection_id',
            sent:        { $sum: { $cond: [{ $in: ['$status', [SendStatus.SENT, SendStatus.DELIVERED]] }, 1, 0] } },
            bounces:     { $sum: { $cond: [{ $eq:  ['$status', SendStatus.BOUNCED] }, 1, 0] } },
            failed:      { $sum: { $cond: [{ $eq:  ['$status', SendStatus.FAILED]  }, 1, 0] } },
            dailyVolume: { $sum: { $cond: [{ $gte: ['$sent_at', twentyFourHAgo]    }, 1, 0] } },
            lastSentAt:  { $max: '$sent_at' },
        }},
      ]),
      OpenLog.aggregate([
        { $match: { user_id: uid, is_first_open:  true } },
        ...buildConnectionLookupPipeline('opens'),
      ]),
      ReplyLog.aggregate([
        { $match: { user_id: uid } },
        ...buildConnectionLookupPipeline('replies'),
      ]),
      ClickLog.aggregate([
        { $match: { user_id: uid, is_first_click: true } },
        ...buildConnectionLookupPipeline('clicks'),
      ]),
      SendingLog.aggregate([
        { $match: { user_id: uid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] }, sent_at: { $gte: sevenDaysAgo } } },
        { $group: { _id: { conn: '$email_connection_id', date: { $dateToString: { format: '%Y-%m-%d', date: '$sent_at' } } }, count: { $sum: 1 } } },
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    const toMap = (agg: any[], key: string) => new Map(agg.map(r => [r._id.toString(), r[key] as number]));
    const sentMap    = new Map((sentStats as any[]).map(r => [r._id.toString(), r.sent     as number]));
    const bounceMap  = new Map((sentStats as any[]).map(r => [r._id.toString(), r.bounces  as number]));
    const failedMap  = new Map((sentStats as any[]).map(r => [r._id.toString(), r.failed   as number]));
    const dvMap      = new Map((sentStats as any[]).map(r => [r._id.toString(), r.dailyVolume as number]));
    const lastMap    = new Map((sentStats as any[]).map(r => [r._id.toString(), r.lastSentAt as Date]));
    const opensMap   = toMap(openStats,   'opens');
    const repliesMap = toMap(replyStats,  'replies');
    const clicksMap  = toMap(clickStats,  'clicks');

    const trendMap = new Map<string, Array<{ date: string; count: number }>>();
    for (const r of (trendStats as any[])) {
      const id = r._id.conn.toString();
      if (!trendMap.has(id)) trendMap.set(id, []);
      trendMap.get(id)!.push({ date: r._id.date, count: r.count });
    }

    const results = connections.map(conn => {
      const id      = (conn._id as Types.ObjectId).toString();
      const sent    = sentMap.get(id)    ?? 0;
      const opens   = opensMap.get(id)   ?? 0;
      const replies = repliesMap.get(id) ?? 0;
      const clicks  = clicksMap.get(id)  ?? 0;
      const bounces = bounceMap.get(id)  ?? 0;
      const failed  = failedMap.get(id)  ?? 0;
      const dv      = dvMap.get(id)      ?? 0;
      const last    = lastMap.get(id);
      const openRate          = calculateRate(opens,   sent);
      const clickRate         = calculateRate(clicks,  sent);
      const replyRate         = calculateRate(replies, sent);
      const bounceRate        = calculateRate(bounces, sent);
      const failureRate       = calculateRate(failed,  sent + failed);
      const limitUsagePercent = calculateRate(dv,      conn.daily_limit);
      return {
        connectionId: id, email: conn.from_email, label: conn.label, status: conn.status,
        sent, opens, clicks, replies, bounces, failed,
        dailyVolume: dv, dailyLimit: conn.daily_limit,
        openRate, clickRate, replyRate, bounceRate, failureRate, limitUsagePercent,
        health: calculateSenderHealth(bounceRate, replyRate),
        lastSentAt: last ? last.toISOString() : undefined,
        dailyTrend: trendMap.get(id) ?? [],
      };
    });

    const sev: Record<string, number> = { critical: 4, warning: 3, healthy: 2, excellent: 1 };
    results.sort((a, b) => sev[b.health] - sev[a.health] || b.bounceRate - a.bounceRate);
    const filtered = filterInput.health ? results.filter(r => r.health === filterInput.health) : results;
    logger.debug('Sender analytics fetched', { userId, count: filtered.length });
    return filtered;
  }

  // ─── Activity Feed ────────────────────────────────────────────────────────
  async getRecentActivity(userId: string, opts: { limit?: number; sequenceId?: string } = {}) {
    const uid = new Types.ObjectId(userId);
    const seqOid = opts.sequenceId ? new Types.ObjectId(opts.sequenceId) : undefined;
    const events = await buildEventTimeline(uid, { limit: opts.limit, sequenceId: seqOid });
    logger.debug('Activity feed fetched', { userId, count: events.length });
    return events;
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  async getDashboardMetrics(userId: string) {
    const [overview, timeseries] = await Promise.all([
      this.getOverviewMetrics(userId),
      this.getTimeseries(userId),
    ]);
    logger.debug('Dashboard metrics computed', { userId });
    return {
      overview: {
        ...overview,
        openRate:        calculateRate(overview.opens,        overview.emailsSent),
        clickRate:       calculateRate(overview.clicks,       overview.emailsSent),
        replyRate:       calculateRate(overview.replies,      overview.emailsSent),
        bounceRate:      calculateRate(overview.bounces,      overview.emailsSent),
        unsubscribeRate: calculateRate(overview.unsubscribes, overview.emailsSent),
      },
      timeseries,
    };
  }

  async getEnhancedDashboard(userId: string, filterInput: AnalyticsFilterInput = {}) {
    const uid = new Types.ObjectId(userId);
    const f   = buildAnalyticsFilter(filterInput);
    const now = new Date();
    const d7  = new Date(now.getTime() - 7  * 86400000);
    const d14 = new Date(now.getTime() - 14 * 86400000);
    const seqMatch = f.sequenceId ? { sequence_id: f.sequenceId } : {};
    const sndMatch = f.senderId   ? { email_connection_id: f.senderId } : {};

    const [overview, timeseries, sequences, senders, activity,
           sentCur, sentPrev, opensCur, opensPrev, repliesCur, repliesPrev, bouncesCur, bouncesPrev] =
      await Promise.all([
        this.getOverviewMetrics(userId),
        this.getTimeseries(userId),
        this.getSequenceAnalytics(userId),
        this.getSenderAnalytics(userId),
        buildEventTimeline(uid, { limit: 20 }),
        SendingLog.countDocuments({ user_id: uid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] }, sent_at: { $gte: d7  } }),
        SendingLog.countDocuments({ user_id: uid, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] }, sent_at: { $gte: d14, $lt: d7 } }),
        OpenLog.countDocuments({ user_id: uid, is_first_open: true, opened_at:  { $gte: d7  } }),
        OpenLog.countDocuments({ user_id: uid, is_first_open: true, opened_at:  { $gte: d14, $lt: d7 } }),
        ReplyLog.countDocuments({ user_id: uid, received_at: { $gte: d7  } }),
        ReplyLog.countDocuments({ user_id: uid, received_at: { $gte: d14, $lt: d7 } }),
        BounceLog.countDocuments({ user_id: uid, bounced_at:  { $gte: d7  } }),
        BounceLog.countDocuments({ user_id: uid, bounced_at:  { $gte: d14, $lt: d7 } }),
      ]);

    const trendPct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);

    const health = { excellent: 0, healthy: 0, warning: 0, stalled: 0 };
    sequences.forEach((s: any) => { health[s.health as keyof typeof health]++; });

    logger.debug('Enhanced dashboard computed', { userId });
    return {
      overview: {
        ...overview,
        openRate:        calculateRate(overview.opens,        overview.emailsSent),
        clickRate:       calculateRate(overview.clicks,       overview.emailsSent),
        replyRate:       calculateRate(overview.replies,      overview.emailsSent),
        bounceRate:      calculateRate(overview.bounces,      overview.emailsSent),
        unsubscribeRate: calculateRate(overview.unsubscribes, overview.emailsSent),
      },
      timeseries,
      trends: {
        sent:    { current: sentCur,    previous: sentPrev,    changePercent: trendPct(sentCur,    sentPrev)    },
        opens:   { current: opensCur,   previous: opensPrev,   changePercent: trendPct(opensCur,   opensPrev)   },
        replies: { current: repliesCur, previous: repliesPrev, changePercent: trendPct(repliesCur, repliesPrev) },
        bounces: { current: bouncesCur, previous: bouncesPrev, changePercent: trendPct(bouncesCur, bouncesPrev) },
      },
      topSequences:   sequences.slice(0, 5),
      topSenders:     senders.slice(0, 3),
      campaignHealth: health,
      recentActivity: activity,
    };
  }

  // ─── Sequence Metrics (lightweight) ──────────────────────────────────────
  async getSequenceMetrics(sequenceId: string, userId: string) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const seq = await Sequence.findOne({ _id: seqOid, user_id: uid })
      .select('_id name status sending_window launch_date').lean();
    if (!seq) { const e: any = new Error('Sequence not found'); e.statusCode = 404; throw e; }

    const matchBase = { sequence_id: seqOid, user_id: uid };
    const steps = await SequenceStep.find({ sequence_id: seqOid, type: 'email', is_active: true })
      .select('step_index subject_override').sort({ step_index: 1 }).lean();
    const labelMap = new Map(steps.map(s => [s.step_index, s.subject_override ?? `Step ${s.step_index + 1}`]));

    const [summary, stepBreakdown] = await Promise.all([
      computeRecipientSummaryAndFunnel(matchBase),
      computeStepBreakdown(matchBase, labelMap),
    ]);

    logger.debug('Sequence metrics computed', { sequenceId, userId });
    return {
      sequenceId, name: seq.name, status: seq.status,
      ...summary.contacts,
      emailsSent:      summary.emailsSent,
      opens:           summary.opens,
      clicks:          summary.clicks,
      replies:         summary.replies,
      bounces:         summary.bounces,
      unsubscribes:    summary.unsubscribes,
      openRate:        calculateRate(summary.opens,          summary.emailsSent),
      clickRate:       calculateRate(summary.clicks,         summary.emailsSent),
      replyRate:       calculateRate(summary.replies,        summary.emailsSent),
      bounceRate:      calculateRate(summary.bounces,        summary.emailsSent),
      unsubscribeRate: calculateRate(summary.unsubscribes,   summary.emailsSent),
      contacts: summary.contacts,
      stepBreakdown,
    };
  }

  // ─── Full Sequence Analytics Page ────────────────────────────────────────
  async getFullSequenceAnalytics(sequenceId: string, userId: string) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const seq = await Sequence.findOne({ _id: seqOid, user_id: uid })
      .select('_id name status sending_window launch_date').lean();
    if (!seq) { const e: any = new Error('Sequence not found'); e.statusCode = 404; throw e; }

    const matchBase = { sequence_id: seqOid, user_id: uid };
    const since     = thirtyDaysAgo();

    const steps = await SequenceStep.find({ sequence_id: seqOid, type: 'email', is_active: true })
      .select('step_index subject_override').sort({ step_index: 1 }).lean();
    const labelMap = new Map(steps.map(s => [s.step_index, s.subject_override ?? `Step ${s.step_index + 1}`]));

    const [summary, stepBreakdown, dailyTrend, activity] = await Promise.all([
      computeRecipientSummaryAndFunnel(matchBase),
      computeStepBreakdown(matchBase, labelMap),
      computeSequenceDailyTrend(matchBase, since),
      buildEventTimeline(uid, { limit: 30, sequenceId: seqOid }),
    ]);

    logger.debug('Full sequence analytics computed', { sequenceId, userId });
    return {
      sequenceId, name: seq.name, status: seq.status,
      sendingWindow: seq.sending_window,
      contacts:        summary.contacts,
      emailsSent:      summary.emailsSent,
      opens:           summary.opens,
      clicks:          summary.clicks,
      replies:         summary.replies,
      bounces:         summary.bounces,
      unsubscribes:    summary.unsubscribes,
      openRate:        calculateRate(summary.opens,        summary.emailsSent),
      clickRate:       calculateRate(summary.clicks,       summary.emailsSent),
      replyRate:       calculateRate(summary.replies,      summary.emailsSent),
      bounceRate:      calculateRate(summary.bounces,      summary.emailsSent),
      unsubscribeRate: calculateRate(summary.unsubscribes, summary.emailsSent),
      stepBreakdown,
      dailyTrend,
      funnel:           summary.funnel,
      recentActivity:   activity,
      recipientSummary: summary.recipientSummary,
    };
  }

  // ─── Recipient Metrics (paginated) ───────────────────────────────────────
  async getRecipientMetrics(
    sequenceId: string,
    userId: string,
    opts: { page?: number; limit?: number } & RecipientFilterInput = {}
  ) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const page   = Math.max(1, opts.page  ?? 1);
    const limit  = Math.min(500, Math.max(1, opts.limit ?? 100));
    const skip   = (page - 1) * limit;

    const seq = await Sequence.findOne({ _id: seqOid, user_id: uid }).select('_id name').lean();
    if (!seq) { const e: any = new Error('Sequence not found'); e.statusCode = 404; throw e; }

    const matchBase = buildRecipientFilter(opts, { sequence_id: seqOid, user_id: uid });


    const [total, contacts, openedEmails, clickedEmails, repliedEmails, bouncedEmails,
           lastOpenMap, lastClickMap, lastReplyMap, sentCountMap] = await Promise.all([
      SequenceContact.countDocuments(matchBase),
      SequenceContact.find(matchBase)
        .select('_id contact_email contact_first_name contact_last_name contact_company ' +
                'status current_step_index total_steps enrolled_at completed_at unsubscribed_at next_send_at')
        .sort({ enrolled_at: -1 }).skip(skip).limit(limit).lean(),
      OpenLog.distinct('contact_email',  { ...matchBase, is_first_open:  true }),
      ClickLog.distinct('contact_email', { ...matchBase, is_first_click: true }),
      ReplyLog.distinct('from_email',    matchBase),
      BounceLog.distinct('to_email',     matchBase),
      OpenLog.aggregate([  { $match: matchBase }, { $group: { _id: '$contact_email', lastAt: { $max: '$opened_at'   } } }]),
      ClickLog.aggregate([ { $match: matchBase }, { $group: { _id: '$contact_email', lastAt: { $max: '$clicked_at'  } } }]),
      ReplyLog.aggregate([ { $match: matchBase }, { $group: { _id: '$from_email',    lastAt: { $max: '$received_at' } } }]),
      SendingLog.aggregate([
        { $match: { ...matchBase, status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] } } },
        { $group: { _id: '$sequence_contact_id', count: { $sum: 1 } } },
      ]),
    ]);

    const openedSet  = new Set<string>(openedEmails);
    const clickedSet = new Set<string>(clickedEmails);
    const repliedSet = new Set<string>(repliedEmails);
    const bouncedSet = new Set<string>(bouncedEmails);
    const lastOpenAt  = new Map((lastOpenMap  as any[]).map(r => [r._id as string, r.lastAt as Date]));
    const lastClickAt = new Map((lastClickMap as any[]).map(r => [r._id as string, r.lastAt as Date]));
    const lastReplyAt = new Map((lastReplyMap as any[]).map(r => [r._id as string, r.lastAt as Date]));
    const sentByC     = new Map((sentCountMap as any[]).map(r => [r._id.toString(), r.count as number]));

    const recipients = contacts.map(c => {
      const email = c.contact_email;
      const dates: Date[] = [];
      if (lastOpenAt.get(email))  dates.push(lastOpenAt.get(email)!);
      if (lastClickAt.get(email)) dates.push(lastClickAt.get(email)!);
      if (lastReplyAt.get(email)) dates.push(lastReplyAt.get(email)!);
      const lastActivityAt = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))).toISOString() : null;
      const totalSteps = c.total_steps || 1;
      return {
        contactId:      (c._id as Types.ObjectId).toString(),
        email, firstName: c.contact_first_name, lastName: c.contact_last_name, company: c.contact_company,
        status: c.status, currentStep: c.current_step_index, totalSteps,
        progressPercent: Math.round(((c.current_step_index + 1) / totalSteps) * 100),
        enrolledAt: c.enrolled_at, completedAt: c.completed_at, unsubscribedAt: c.unsubscribed_at,
        nextSendAt:     (c as any).next_send_at ?? null,
        lastActivityAt,
        emailsReceived: sentByC.get((c._id as Types.ObjectId).toString()) ?? 0,
        hasOpened:  openedSet.has(email),
        hasClicked: clickedSet.has(email),
        hasReplied: repliedSet.has(email),
        hasBounced: bouncedSet.has(email),
      };
    });

    logger.debug('Recipient metrics computed', { sequenceId, userId, page, total });
    return { sequenceId, sequenceName: seq.name, totalRecipients: total, page, limit, totalPages: Math.ceil(total / limit), recipients };
  }
}

export const analyticsService = new AnalyticsService();
