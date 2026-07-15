/**
 * Analytics.tsx — Enterprise Analytics Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Data source: GET /api/analytics/dashboard (single request, no other calls).
 * Frontend is a pure rendering layer — zero calculations performed here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Send, Users, Mail, Eye, MousePointerClick,
  MessageSquareReply, AlertTriangle, UserMinus, RefreshCw,
} from 'lucide-react';
import { analyticsService, type DashboardPayload } from '../services/analytics.service';
import {
  KPICard, SkeletonKPI,
  AnalyticsChart, SkeletonChart,
  CampaignHealthDonut,
  AnalyticsTable, SkeletonTable, type SeqRow,
  SenderTable, type SenderTableRow,
  ActivityTimeline, SkeletonActivity,
  ErrorCard,
} from '../components/analytics';
import { AnalyticsFilterBar } from '../components/analytics/FilterBar';
import { useAnalyticsFilters } from '../hooks/useAnalyticsFilters';
import { SavedViewsPanel } from '../components/analytics/ActionComponents';

// ─── KPI card config ──────────────────────────────────────────────────────────

const KPI_CFG = [
  { key: 'totalSequences',  label: 'Total Sequences',  icon: Layers,             iconColor: 'text-indigo-600',  iconBg: 'bg-indigo-50',   rateKey: undefined,         rateLabel: undefined,      trendKey: undefined },
  { key: 'activeSequences', label: 'Active Sequences', icon: Send,               iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50',  rateKey: undefined,         rateLabel: undefined,      trendKey: undefined },
  { key: 'totalContacts',   label: 'Contacts',         icon: Users,              iconColor: 'text-blue-600',    iconBg: 'bg-blue-50',     rateKey: undefined,         rateLabel: undefined,      trendKey: undefined },
  { key: 'emailsSent',      label: 'Emails Sent',      icon: Mail,               iconColor: 'text-violet-600',  iconBg: 'bg-violet-50',   rateKey: undefined,         rateLabel: undefined,      trendKey: 'sent'    },
  { key: 'opens',           label: 'Opens',            icon: Eye,                iconColor: 'text-amber-600',   iconBg: 'bg-amber-50',    rateKey: 'openRate',        rateLabel: 'Open Rate',    trendKey: 'opens'   },
  { key: 'clicks',          label: 'Clicks',           icon: MousePointerClick,  iconColor: 'text-cyan-600',    iconBg: 'bg-cyan-50',     rateKey: 'clickRate',       rateLabel: 'Click Rate',   trendKey: undefined },
  { key: 'replies',         label: 'Replies',          icon: MessageSquareReply, iconColor: 'text-teal-600',    iconBg: 'bg-teal-50',     rateKey: 'replyRate',       rateLabel: 'Reply Rate',   trendKey: 'replies' },
  { key: 'bounces',         label: 'Bounces',          icon: AlertTriangle,      iconColor: 'text-rose-600',    iconBg: 'bg-rose-50',     rateKey: 'bounceRate',      rateLabel: 'Bounce Rate',  trendKey: 'bounces' },
  { key: 'unsubscribes',    label: 'Unsubscribes',     icon: UserMinus,          iconColor: 'text-orange-600',  iconBg: 'bg-orange-50',   rateKey: 'unsubscribeRate', rateLabel: 'Unsub Rate',   trendKey: undefined },
] as const;

// ─── Chart series configs ─────────────────────────────────────────────────────

const COMBINED_SERIES = [
  { key: 'Sent',        label: 'Sent',        color: '#7C3AED' },
  { key: 'Opens',       label: 'Opens',       color: '#F59E0B' },
  { key: 'Clicks',      label: 'Clicks',      color: '#06B6D4' },
  { key: 'Replies',     label: 'Replies',     color: '#10B981' },
  { key: 'Bounces',     label: 'Bounces',     color: '#EF4444' },
];

// ─── Section wrapper ──────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title, subtitle, children, action,
}) => (
  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
    <div className="flex items-start justify-between px-5 py-4 border-b border-gray-50">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

export const Analytics: React.FC = () => {
  const navigate = useNavigate();
  const { filters, queryString, setFilter, setPreset, setDateRange, clearFilters, hasActiveFilters } =
    useAnalyticsFilters();

  const [data,    setData]    = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await analyticsService.getDashboard(queryString));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { load(); }, [load]);

  // ── Memoised derived structures ───────────────────────────────────────────

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.timeseries.sent.map((pt, i) => ({
      date:    pt.date,
      Sent:    pt.count,
      Opens:   data.timeseries.opens[i]?.count    ?? 0,
      Clicks:  data.timeseries.clicks[i]?.count   ?? 0,
      Replies: data.timeseries.replies[i]?.count  ?? 0,
      Bounces: data.timeseries.bounces[i]?.count  ?? 0,
    }));
  }, [data]);

  const seqRows = useMemo((): SeqRow[] => {
    if (!data) return [];
    return data.topSequences.map(s => ({
      sequenceId: s.sequenceId, name: s.name, status: s.status,
      sent: s.sent, openRate: s.openRate, replyRate: s.replyRate,
      bounceRate: s.bounceRate, health: s.health,
    }));
  }, [data]);

  const senderRows = useMemo((): SenderTableRow[] => {
    if (!data) return [];
    return data.topSenders.map(s => ({
      connectionId: s.connectionId, email: s.email, label: s.label,
      dailyVolume: s.dailyVolume, dailyLimit: s.dailyLimit,
      limitUsagePercent: s.limitUsagePercent,
      openRate: s.openRate, bounceRate: s.bounceRate, failureRate: s.failureRate,
      health: s.health,
    }));
  }, [data]);

  // ── Error state ───────────────────────────────────────────────────────────

  if (!loading && error) {
    return (
      <div className="space-y-6">
        <DashboardHeader onRefresh={load} loading={false} />
        <ErrorCard message={error} onRetry={load} />
      </div>
    );
  }

  const ov = data?.overview;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time performance across all sequences and senders.</p>
        </div>
        <div className="flex gap-2">
          <SavedViewsPanel
            page="dashboard"
            currentFilters={filters as any}
            onLoad={(f) => {
              clearFilters();
              Object.entries(f).forEach(([k, v]) => setFilter(k, v));
            }}
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────────── */}
      <AnalyticsFilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onPreset={setPreset}
        onDateRange={setDateRange}
        onFilter={(k, v) => setFilter(k, v)}
        onClear={clearFilters}
        show={{ dateRange: true, status: true, health: true }}
      />

      {/* ── Section 1: KPI Cards ─────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 9 }).map((_, i) => <SkeletonKPI key={i} />)
          : KPI_CFG.map(cfg => {
              const value = ov ? (ov as Record<string, number>)[cfg.key] ?? 0 : 0;
              const rate  = cfg.rateKey && ov ? (ov as Record<string, number>)[cfg.rateKey] : undefined;
              const trend = cfg.trendKey && data?.trends
                ? (data.trends as Record<string, { changePercent: number }>)[cfg.trendKey]?.changePercent
                : undefined;
              return (
                <KPICard
                  key={cfg.key}
                  label={cfg.label}
                  value={value}
                  icon={cfg.icon}
                  iconColor={cfg.iconColor}
                  iconBg={cfg.iconBg}
                  rate={rate}
                  rateLabel={cfg.rateLabel}
                  trend={trend}
                />
              );
            })}
      </div>

      {/* ── Section 2: Performance Chart + Section 3: Campaign Health ───── */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-3">
        {/* Chart: spans 2 columns */}
        <div className="lg:col-span-2">
          {loading
            ? <SkeletonChart title="30-Day Performance" />
            : <AnalyticsChart
                data={chartData}
                series={COMBINED_SERIES}
                title="30-Day Performance"
                subtitle="Sent, opens, clicks, replies, and bounces"
              />
          }
        </div>

        {/* Campaign Health Donut */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Campaign Health</h2>
            <p className="text-xs text-gray-400 mt-0.5">Distribution across all sequences</p>
          </div>
          {loading
            ? <div className="h-[200px] rounded-xl bg-gray-100 animate-pulse" />
            : data && <CampaignHealthDonut health={data.campaignHealth} />
          }
        </div>
      </div>

      {/* ── Section 4: Top Sequences ─────────────────────────────────────── */}
      <Section title="Top Sequences" subtitle="Top 5 by reply rate">
        {loading
          ? <SkeletonTable cols={7} />
          : <AnalyticsTable rows={seqRows} onRowClick={id => navigate(`/sequences/${id}/analytics`)} onRefresh={load} />
        }
      </Section>

      {/* ── Section 5: Top Senders ───────────────────────────────────────── */}
      <Section title="Top Senders" subtitle="Top 3 sender accounts by volume">
        {loading
          ? <SkeletonTable cols={6} />
          : <SenderTable rows={senderRows} onRefresh={load} />
        }
      </Section>

      {/* ── Section 6: Recent Activity ───────────────────────────────────── */}
      <Section title="Recent Activity" subtitle="Latest 20 events across all sequences">
        {loading
          ? <SkeletonActivity />
          : <ActivityTimeline events={data?.recentActivity ?? []} />
        }
      </Section>
    </div>
  );
};
