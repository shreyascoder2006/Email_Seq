import api from './api';
import type { SenderAnalyticsResponse } from '../types';

// ─── Primitives ───────────────────────────────────────────────────────────────

export interface TimeseriesPoint { date: string; count: number; }
export type SequenceHealth = 'excellent' | 'healthy' | 'warning' | 'stalled';
export type SenderHealth   = 'excellent' | 'healthy' | 'warning' | 'critical';
export type SequenceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type ActivityType   = 'email_sent' | 'email_opened' | 'link_clicked' | 'reply_received' | 'email_bounced';

// ─── Overview ─────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalSequences:  number;
  activeSequences: number;
  totalContacts:   number;
  emailsSent:      number;
  opens:           number;
  clicks:          number;
  replies:         number;
  bounces:         number;
  unsubscribes:    number;
  openRate:        number;
  clickRate:       number;
  replyRate:       number;
  bounceRate:      number;
  unsubscribeRate: number;
}

// ─── Timeseries ───────────────────────────────────────────────────────────────

export interface AnalyticsTimeseries {
  sent:         TimeseriesPoint[];
  opens:        TimeseriesPoint[];
  clicks:       TimeseriesPoint[];
  replies:      TimeseriesPoint[];
  bounces:      TimeseriesPoint[];
  unsubscribes: TimeseriesPoint[];
}

// ─── Sequences ────────────────────────────────────────────────────────────────

export interface SequenceAnalyticsRow {
  sequenceId:      string;
  name:            string;
  status:          SequenceStatus;
  contacts:        number;
  sent:            number;
  opens:           number;
  clicks:          number;
  replies:         number;
  bounces:         number;
  unsubscribes:    number;
  openRate:        number;
  clickRate:       number;
  replyRate:       number;
  bounceRate:      number;
  unsubscribeRate: number;
  health:          SequenceHealth;
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export interface ActivityEvent {
  type:         ActivityType;
  email:        string;
  sequenceId:   string;
  sequenceName: string;
  stepIndex?:   number;
  timestamp:    string;
  metadata:     Record<string, unknown>;
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export interface TrendWindow {
  current:       number;
  previous:      number;
  changePercent: number;
}

export interface DashboardTrends {
  sent:    TrendWindow;
  opens:   TrendWindow;
  replies: TrendWindow;
  bounces: TrendWindow;
}

// ─── Campaign Health ──────────────────────────────────────────────────────────

export interface CampaignHealth {
  excellent: number;
  healthy:   number;
  warning:   number;
  stalled:   number;
}

// ─── Top Sender (slim shape returned in dashboard) ────────────────────────────

export interface TopSenderRow {
  connectionId:       string;
  email:              string;
  label:              string;
  status:             string;
  sent:               number;
  opens:              number;
  clicks:             number;
  replies:            number;
  bounces:            number;
  failed:             number;
  dailyVolume:        number;
  dailyLimit:         number;
  openRate:           number;
  clickRate:          number;
  replyRate:          number;
  bounceRate:         number;
  failureRate:        number;
  limitUsagePercent:  number;
  health:             SenderHealth;
  lastSentAt?:        string;
  dailyTrend:         TimeseriesPoint[];
}

// ─── Full Dashboard Payload ───────────────────────────────────────────────────

export interface DashboardPayload {
  overview:       AnalyticsOverview;
  timeseries:     AnalyticsTimeseries;
  trends:         DashboardTrends;
  topSequences:   SequenceAnalyticsRow[];
  topSenders:     TopSenderRow[];
  campaignHealth: CampaignHealth;
  recentActivity: ActivityEvent[];
}

// ─── Full Sequence Analytics Payload ─────────────────────────────────────────

export interface StepBreakdown {
  stepIndex: number;
  label:     string;
  sent:      number;
  opens:     number;
  clicks:    number;
  openRate:  number;
  clickRate: number;
}

export interface FunnelData {
  enrolled: number;
  sent:     number;
  opened:   number;
  clicked:  number;
  replied:  number;
}

export interface ContactCounts {
  total:        number;
  active:       number;
  paused:       number;
  completed:    number;
  bounced:      number;
  unsubscribed: number;
  replied:      number;
}

export interface RecipientSummary {
  active:       number;
  paused:       number;
  completed:    number;
  bounced:      number;
  replied:      number;
  unsubscribed: number;
}

export interface SequenceDailyTrend {
  sent:    TimeseriesPoint[];
  opens:   TimeseriesPoint[];
  clicks:  TimeseriesPoint[];
  replies: TimeseriesPoint[];
}

export interface FullSequencePayload {
  sequenceId:      string;
  name:            string;
  status:          SequenceStatus;
  sendingWindow?:  Record<string, unknown>;
  contacts:        ContactCounts;
  emailsSent:      number;
  opens:           number;
  clicks:          number;
  replies:         number;
  bounces:         number;
  unsubscribes:    number;
  openRate:        number;
  clickRate:       number;
  replyRate:       number;
  bounceRate:      number;
  unsubscribeRate: number;
  stepBreakdown:   StepBreakdown[];
  dailyTrend:      SequenceDailyTrend;
  funnel:          FunnelData;
  recentActivity:  ActivityEvent[];
  recipientSummary: RecipientSummary;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const analyticsService = {
  /** Single-call dashboard payload. Pass queryString from useAnalyticsFilters. */
  getDashboard: async (queryString = ''): Promise<DashboardPayload> => {
    const url = queryString ? `/analytics/dashboard?${queryString}` : '/analytics/dashboard';
    const res = await api.get(url);
    return res.data.data;
  },

  /** Full sequence analytics page payload. */
  getFullSequence: async (sequenceId: string, queryString = ''): Promise<FullSequencePayload> => {
    const url = queryString
      ? `/analytics/sequences/${sequenceId}?${queryString}`
      : `/analytics/sequences/${sequenceId}`;
    const res = await api.get(url);
    return res.data.data;
  },

  // Legacy endpoints (preserved for backward compat)
  getOverview:  async (qs = ''): Promise<AnalyticsOverview>       => (await api.get(`/analytics/overview${qs ? '?' + qs : ''}`)).data.data,
  getTimeseries:async (qs = ''): Promise<AnalyticsTimeseries>     => (await api.get(`/analytics/timeseries${qs ? '?' + qs : ''}`)).data.data,
  getSequences: async (): Promise<SequenceAnalyticsRow[]>         => (await api.get('/analytics/sequences')).data.data,
  getActivity:  async (): Promise<ActivityEvent[]>                => (await api.get('/analytics/activity')).data.data,
  getSenders:   async (qs = ''): Promise<SenderAnalyticsResponse[]> => (await api.get(`/analytics/senders${qs ? '?' + qs : ''}`)).data.data,

  /** Recipient table pagination/filters */
  getRecipientMetrics: async (sequenceId: string, qs = '') => {
    return (await api.get(`/analytics/sequences/${sequenceId}/recipients${qs ? '?' + qs : ''}`)).data.data;
  },
};


