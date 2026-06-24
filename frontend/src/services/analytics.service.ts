import api from './api';
import type { SenderAnalyticsResponse } from '../types';

export interface AnalyticsOverview {
  totalSequences: number;
  activeSequences: number;
  totalContacts: number;
  emailsSent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
}

export interface TimeseriesPoint {
  date: string;
  count: number;
}

export interface AnalyticsTimeseries {
  sent: TimeseriesPoint[];
  opens: TimeseriesPoint[];
  clicks: TimeseriesPoint[];
  replies: TimeseriesPoint[];
  bounces: TimeseriesPoint[];
}

export type SequenceHealth = 'excellent' | 'healthy' | 'warning' | 'stalled';
export type SequenceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export interface SequenceAnalyticsRow {
  sequenceId: string;
  name: string;
  status: SequenceStatus;
  contacts: number;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
  health: SequenceHealth;
}

export type ActivityType = 'email_sent' | 'email_opened' | 'link_clicked' | 'reply_received' | 'email_bounced';

export interface ActivityEvent {
  type: ActivityType;
  email: string;
  sequenceName: string;
  timestamp: string; // ISO 8601
}

export const analyticsService = {
  getOverview: async (): Promise<AnalyticsOverview> => {
    const response = await api.get('/analytics/overview');
    return response.data.data;
  },

  getTimeseries: async (): Promise<AnalyticsTimeseries> => {
    const response = await api.get('/analytics/timeseries');
    return response.data.data;
  },

  getSequences: async (): Promise<SequenceAnalyticsRow[]> => {
    const response = await api.get('/analytics/sequences');
    return response.data.data;
  },

  getActivity: async (): Promise<ActivityEvent[]> => {
    const response = await api.get('/analytics/activity');
    return response.data.data;
  },

  getSenders: async (): Promise<SenderAnalyticsResponse[]> => {
    const response = await api.get('/analytics/senders');
    return response.data.data;
  },
};
