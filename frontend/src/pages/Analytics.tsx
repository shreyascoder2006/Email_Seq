import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import {
  Send,
  Users,
  Mail,
  Eye,
  MousePointerClick,
  MessageSquareReply,
  AlertTriangle,
  Layers,
  Link2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { analyticsService } from '../services/analytics.service';
import type {
  AnalyticsOverview,
  AnalyticsTimeseries,
  SequenceAnalyticsRow,
  SequenceHealth,
  SequenceStatus,
  ActivityEvent,
  ActivityType,
} from '../services/analytics.service';
import type { SenderAnalyticsResponse } from '../types';
import { SenderAnalyticsTable } from '../components/analytics/SenderAnalyticsTable';

// ─── KPI Card Config ───────────────────────────────────────────────
interface KpiCardConfig {
  key: keyof AnalyticsOverview;
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const KPI_CARDS: KpiCardConfig[] = [
  { key: 'totalSequences',  label: 'Total Sequences',  icon: Layers,             color: 'text-indigo-600',  bgColor: 'bg-indigo-50' },
  { key: 'activeSequences', label: 'Active Sequences', icon: Send,               color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  { key: 'totalContacts',   label: 'Contacts',         icon: Users,              color: 'text-blue-600',    bgColor: 'bg-blue-50' },
  { key: 'emailsSent',      label: 'Emails Sent',      icon: Mail,               color: 'text-violet-600',  bgColor: 'bg-violet-50' },
  { key: 'opens',           label: 'Opens',            icon: Eye,                color: 'text-amber-600',   bgColor: 'bg-amber-50' },
  { key: 'clicks',          label: 'Clicks',           icon: MousePointerClick,  color: 'text-cyan-600',    bgColor: 'bg-cyan-50' },
  { key: 'replies',         label: 'Replies',          icon: MessageSquareReply, color: 'text-teal-600',    bgColor: 'bg-teal-50' },
  { key: 'bounces',         label: 'Bounces',          icon: AlertTriangle,      color: 'text-rose-600',    bgColor: 'bg-rose-50' },
];

// ─── Formatters ────────────────────────────────────────────────────
function formatNumber(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 30) return `${diffDay} days ago`;
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Badge Helpers ─────────────────────────────────────────────────
const STATUS_STYLES: Record<SequenceStatus, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  draft:     'bg-gray-100 text-gray-600',
  paused:    'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  archived:  'bg-red-100 text-red-600',
};

const HEALTH_STYLES: Record<SequenceHealth, string> = {
  excellent: 'bg-emerald-100 text-emerald-700',
  healthy:   'bg-blue-100 text-blue-700',
  warning:   'bg-amber-100 text-amber-700',
  stalled:   'bg-red-100 text-red-600',
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${className}`}>
      {label}
    </span>
  );
}

// ─── Activity Config ───────────────────────────────────────────────
const ACTIVITY_CONFIG: Record<ActivityType, { icon: React.ElementType; label: string; verb: string; color: string; bgColor: string }> = {
  email_sent:      { icon: Mail,               label: 'Email sent',      verb: 'to',   color: 'text-blue-600',    bgColor: 'bg-blue-50' },
  email_opened:    { icon: Eye,                label: 'Email opened',    verb: 'by',   color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  link_clicked:    { icon: Link2,              label: 'Link clicked',    verb: 'by',   color: 'text-cyan-600',    bgColor: 'bg-cyan-50' },
  reply_received:  { icon: MessageSquareReply, label: 'Reply received',  verb: 'from', color: 'text-teal-600',    bgColor: 'bg-teal-50' },
  email_bounced:   { icon: AlertTriangle,      label: 'Email bounced',   verb: 'for',  color: 'text-red-600',     bgColor: 'bg-red-50' },
};

// ─── Skeleton Components ───────────────────────────────────────────
const SkeletonCard: React.FC = () => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
      <div className="h-9 w-9 rounded-lg bg-gray-100 animate-pulse" />
    </CardHeader>
    <CardContent>
      <div className="h-8 w-16 rounded bg-gray-200 animate-pulse" />
    </CardContent>
  </Card>
);

const SkeletonChart: React.FC = () => (
  <Card>
    <CardHeader><div className="h-5 w-40 rounded bg-gray-200 animate-pulse" /></CardHeader>
    <CardContent><div className="h-[300px] w-full rounded-lg bg-gray-100 animate-pulse" /></CardContent>
  </Card>
);

const SkeletonTableRows: React.FC = () => (
  <>
    {Array.from({ length: 4 }).map((_, i) => (
      <tr key={i} className="border-b border-gray-100">
        {Array.from({ length: 12 }).map((__, j) => (
          <td key={j} className="px-4 py-3">
            <div className="h-4 rounded bg-gray-200 animate-pulse" style={{ width: `${40 + (j * 7) % 40}%` }} />
          </td>
        ))}
      </tr>
    ))}
  </>
);

const SkeletonActivityItems: React.FC = () => (
  <div className="space-y-0 divide-y divide-gray-100">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-6 py-3.5">
        <div className="h-8 w-8 rounded-lg bg-gray-100 animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-48 rounded bg-gray-200 animate-pulse" />
          <div className="h-3 w-32 rounded bg-gray-100 animate-pulse" />
        </div>
        <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
      </div>
    ))}
  </div>
);

// ─── Custom Chart Tooltip ──────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-gray-500 mb-1">{formatDateLabel(label)}</p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Analytics Page ────────────────────────────────────────────────
export const Analytics: React.FC = () => {
  const [overview, setOverview]       = useState<AnalyticsOverview | null>(null);
  const [timeseries, setTimeseries]   = useState<AnalyticsTimeseries | null>(null);
  const [sequences, setSequences]     = useState<SequenceAnalyticsRow[] | null>(null);
  const [activity, setActivity]       = useState<ActivityEvent[] | null>(null);
  const [senders, setSenders]         = useState<SenderAnalyticsResponse[] | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'senders'>('overview');

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [chartLoading,    setChartLoading]    = useState(true);
  const [tableLoading,    setTableLoading]    = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [sendersLoading,  setSendersLoading]  = useState(true);

  const [overviewError,  setOverviewError]  = useState<string | null>(null);
  const [chartError,     setChartError]     = useState<string | null>(null);
  const [tableError,     setTableError]     = useState<string | null>(null);
  const [activityError,  setActivityError]  = useState<string | null>(null);
  const [sendersError,   setSendersError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    analyticsService.getOverview()
      .then((d) => { if (!cancelled) setOverview(d); })
      .catch((e) => { if (!cancelled) setOverviewError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });

    analyticsService.getTimeseries()
      .then((d) => { if (!cancelled) setTimeseries(d); })
      .catch((e) => { if (!cancelled) setChartError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setChartLoading(false); });

    analyticsService.getSequences()
      .then((d) => { if (!cancelled) setSequences(d); })
      .catch((e) => { if (!cancelled) setTableError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setTableLoading(false); });

    analyticsService.getActivity()
      .then((d) => { if (!cancelled) setActivity(d); })
      .catch((e) => { if (!cancelled) setActivityError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });

    analyticsService.getSenders()
      .then((d) => { if (!cancelled) setSenders(d); })
      .catch((e) => { if (!cancelled) setSendersError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (!cancelled) setSendersLoading(false); });

    return () => { cancelled = true; };
  }, []);

  // Chart data
  const sentData = timeseries
    ? timeseries.sent.map((p) => ({ date: p.date, 'Emails Sent': p.count }))
    : [];
  const engagementData = timeseries
    ? timeseries.opens.map((p, i) => ({
        date: p.date,
        Opens:   p.count,
        Clicks:  timeseries.clicks[i]?.count ?? 0,
        Replies: timeseries.replies[i]?.count ?? 0,
      }))
    : [];
  const xInterval = sentData.length > 0 ? Math.floor(sentData.length / 6) : 0;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-gray-500 mt-1">View detailed performance metrics across your workspace.</p>
        </div>
        
        {/* Tabs */}
        <div className="bg-gray-100 p-1 rounded-lg inline-flex">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'overview'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('senders')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'senders'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Senders
          </button>
        </div>
      </div>

      {activeTab === 'senders' ? (
        <div className="space-y-6">
          {sendersError && !sendersLoading ? (
            <div className="py-10 flex flex-col items-center gap-2 bg-white rounded-xl shadow-sm border border-gray-200">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
              <p className="text-sm text-gray-500">Unable to load sender analytics.</p>
              <button onClick={() => window.location.reload()} className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">Retry</button>
            </div>
          ) : (
            <SenderAnalyticsTable senders={senders || []} isLoading={sendersLoading} />
          )}
        </div>
      ) : (
        <>
          {/* ── KPI Cards ─────────────────────────────────────────────── */}
      {overviewError && !overviewLoading ? (
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-2">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium text-gray-700">Unable to load analytics.</p>
            <button onClick={() => window.location.reload()} className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">Retry</button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {overviewLoading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : KPI_CARDS.map((card) => {
                const Icon = card.icon;
                const value = overview ? overview[card.key] : 0;
                return (
                  <Card key={card.key} className="transition-shadow hover:shadow-md">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-500">{card.label}</CardTitle>
                      <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${card.bgColor}`}>
                        <Icon className={`h-4 w-4 ${card.color}`} />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatNumber(value)}</div>
                    </CardContent>
                  </Card>
                );
              })}
        </div>
      )}

      {/* ── Charts Row ────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {chartLoading ? <SkeletonChart /> : chartError ? (
          <Card>
            <CardHeader><CardTitle className="text-base font-semibold">Email Sending Trend</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center justify-center h-[300px] gap-2">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
              <p className="text-sm text-gray-500">Unable to load chart data.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Email Sending Trend</CardTitle>
              <p className="text-xs text-gray-400">Last 30 days</p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sentData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="date" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatDateLabel} interval={xInterval} />
                    <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="Emails Sent" stroke="#7C3AED" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#7C3AED', stroke: '#fff', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {chartLoading ? <SkeletonChart /> : chartError ? (
          <Card>
            <CardHeader><CardTitle className="text-base font-semibold">Engagement Trend</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center justify-center h-[300px] gap-2">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
              <p className="text-sm text-gray-500">Unable to load chart data.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Engagement Trend</CardTitle>
              <p className="text-xs text-gray-400">Opens, Clicks & Replies — Last 30 days</p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={engagementData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="date" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatDateLabel} interval={xInterval} />
                    <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                    <Line type="monotone" dataKey="Opens"   stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }} />
                    <Line type="monotone" dataKey="Clicks"  stroke="#06B6D4" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#06B6D4', stroke: '#fff', strokeWidth: 2 }} />
                    <Line type="monotone" dataKey="Replies" stroke="#14B8A6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#14B8A6', stroke: '#fff', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Sequence Performance Table ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Sequence Performance</CardTitle>
          <p className="text-xs text-gray-400">Sorted by reply rate · All sequences</p>
        </CardHeader>
        <CardContent className="p-0">
          {tableError && !tableLoading ? (
            <div className="py-10 flex flex-col items-center gap-2">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
              <p className="text-sm text-gray-500">Unable to load sequence analytics.</p>
              <button onClick={() => window.location.reload()} className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">Retry</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {['Sequence', 'Status', 'Health', 'Contacts', 'Sent', 'Opens', 'Clicks', 'Replies', 'Bounces', 'Open Rate', 'Reply Rate', 'Bounce Rate'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tableLoading ? (
                    <SkeletonTableRows />
                  ) : !sequences || sequences.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-12 text-center text-sm text-gray-400">No sequence analytics available.</td>
                    </tr>
                  ) : (
                    sequences.map((seq) => (
                      <tr key={seq.sequenceId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={seq.name}>{seq.name}</td>
                        <td className="px-4 py-3"><Badge label={seq.status} className={STATUS_STYLES[seq.status]} /></td>
                        <td className="px-4 py-3"><Badge label={seq.health} className={HEALTH_STYLES[seq.health]} /></td>
                        <td className="px-4 py-3 text-gray-700">{seq.contacts}</td>
                        <td className="px-4 py-3 text-gray-700">{seq.sent}</td>
                        <td className="px-4 py-3 text-gray-700">{seq.opens}</td>
                        <td className="px-4 py-3 text-gray-700">{seq.clicks}</td>
                        <td className="px-4 py-3 text-gray-700">{seq.replies}</td>
                        <td className="px-4 py-3 text-gray-700">{seq.bounces}</td>
                        <td className="px-4 py-3 font-medium text-amber-600">{formatPct(seq.openRate)}</td>
                        <td className="px-4 py-3 font-medium text-teal-600">{formatPct(seq.replyRate)}</td>
                        <td className={`px-4 py-3 font-medium ${seq.bounceRate >= 5 ? 'text-red-600' : 'text-gray-600'}`}>{formatPct(seq.bounceRate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Activity Feed ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
          <p className="text-xs text-gray-400">Latest 50 events across all sequences</p>
        </CardHeader>
        <CardContent className="p-0">
          {activityError && !activityLoading ? (
            <div className="py-10 flex flex-col items-center gap-2">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
              <p className="text-sm text-gray-500">Unable to load recent activity.</p>
              <button onClick={() => window.location.reload()} className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">Retry</button>
            </div>
          ) : activityLoading ? (
            <SkeletonActivityItems />
          ) : !activity || activity.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No recent activity available.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activity.map((event, idx) => {
                const cfg = ACTIVITY_CONFIG[event.type];
                const Icon = cfg.icon;
                return (
                  <div key={`${event.type}-${event.email}-${idx}`} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors">
                    <div className={`flex items-center justify-center h-8 w-8 rounded-lg flex-shrink-0 ${cfg.bgColor}`}>
                      <Icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">
                        <span className="font-medium">{cfg.label}</span>
                        {' '}{cfg.verb}{' '}
                        <span className="font-medium text-gray-700">{event.email}</span>
                      </p>
                      <p className="text-xs text-gray-400 truncate">{event.sequenceName}</p>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                      {relativeTime(event.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
};
