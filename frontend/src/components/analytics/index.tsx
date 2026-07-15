/**
 * analytics/index.tsx
 * All reusable analytics UI components:
 *   KPICard, HealthBadge, TrendChip, ActivityTimeline,
 *   AnalyticsChart, CampaignHealthDonut, SkeletonKPI, SkeletonChart, SkeletonTable
 */
import React, { memo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import type {
  SequenceHealth, SenderHealth, ActivityEvent, ActivityType,
  TimeseriesPoint, CampaignHealth,
} from '../../services/analytics.service';
import {
  Send, Eye, MousePointerClick, MessageSquareReply,
  AlertTriangle, Mail, Link2, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}
export function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }
export function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function relTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  const d   = Math.floor(hr  / 24);
  if (d === 1)    return 'Yesterday';
  if (d < 30)     return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── HealthBadge ──────────────────────────────────────────────────────────────

const SEQ_HEALTH_CLS: Record<SequenceHealth, string> = {
  excellent: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  healthy:   'bg-blue-100 text-blue-700 ring-blue-200',
  warning:   'bg-amber-100 text-amber-700 ring-amber-200',
  stalled:   'bg-red-100 text-red-600 ring-red-200',
};
const SND_HEALTH_CLS: Record<SenderHealth, string> = {
  excellent: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  healthy:   'bg-blue-100 text-blue-700 ring-blue-200',
  warning:   'bg-amber-100 text-amber-700 ring-amber-200',
  critical:  'bg-red-100 text-red-600 ring-red-200',
};

export const HealthBadge = memo(function HealthBadge({
  health, variant = 'sequence',
}: { health: string; variant?: 'sequence' | 'sender' }) {
  const cls = variant === 'sender'
    ? (SND_HEALTH_CLS[health as SenderHealth] ?? 'bg-gray-100 text-gray-600')
    : (SEQ_HEALTH_CLS[health as SequenceHealth] ?? 'bg-gray-100 text-gray-600');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset capitalize ${cls}`}>
      {health}
    </span>
  );
});

export const StatusBadge = memo(function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active:    'bg-emerald-100 text-emerald-700',
    draft:     'bg-gray-100 text-gray-500',
    paused:    'bg-amber-100 text-amber-700',
    completed: 'bg-blue-100 text-blue-700',
    archived:  'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
});

// ─── TrendChip ────────────────────────────────────────────────────────────────

export const TrendChip = memo(function TrendChip({ pct }: { pct: number }) {
  if (pct === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-gray-400"><Minus className="h-3 w-3" />0%</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
});

// ─── KPICard ──────────────────────────────────────────────────────────────────

interface KPICardProps {
  label:     string;
  value:     number;
  icon:      React.ElementType;
  iconColor: string;
  iconBg:    string;
  rate?:     number;
  rateLabel?: string;
  trend?:    number;
}

export const KPICard = memo(function KPICard({
  label, value, icon: Icon, iconColor, iconBg, rate, rateLabel, trend,
}: KPICardProps) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className={`flex items-center justify-center h-10 w-10 rounded-xl ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold text-gray-900 tabular-nums">{fmtNum(value)}</span>
        {trend !== undefined && <TrendChip pct={trend} />}
      </div>
      {rate !== undefined && (
        <p className="text-xs text-gray-400">{rateLabel ?? 'Rate'}: <span className="font-semibold text-gray-600">{fmtPct(rate)}</span></p>
      )}
    </div>
  );
});

export const SkeletonKPI = memo(function SkeletonKPI() {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 rounded-full bg-gray-200" />
        <div className="h-10 w-10 rounded-xl bg-gray-100" />
      </div>
      <div className="h-9 w-20 rounded-lg bg-gray-200" />
      <div className="h-3 w-32 rounded-full bg-gray-100" />
    </div>
  );
});

// ─── AnalyticsChart ───────────────────────────────────────────────────────────

interface ChartSeries { key: string; color: string; label: string; }

interface AnalyticsChartProps {
  data:    Record<string, string | number>[];
  series:  ChartSeries[];
  title:   string;
  subtitle?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-gray-500 mb-1.5">{fmtDate(label as string)}</p>
      {payload.map((e: { name: string; value: number; color: string }) => (
        <p key={e.name} style={{ color: e.color }} className="flex items-center gap-1.5 py-0.5">
          <span className="h-2 w-2 rounded-full inline-block" style={{ background: e.color }} />
          <span className="text-gray-600">{e.name}:</span>
          <span className="font-bold">{e.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

export const AnalyticsChart = memo(function AnalyticsChart({ data, series, title, subtitle }: AnalyticsChartProps) {
  const interval = data.length > 0 ? Math.max(0, Math.floor(data.length / 6) - 1) : 0;
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="date" stroke="#D1D5DB" fontSize={10} tickLine={false} axisLine={false}
              tickFormatter={fmtDate} interval={interval} tick={{ fill: '#9CA3AF' }} />
            <YAxis stroke="#D1D5DB" fontSize={10} tickLine={false} axisLine={false}
              allowDecimals={false} tick={{ fill: '#9CA3AF' }} />
            <Tooltip content={<CustomTooltip />} />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
});

export const SkeletonChart = memo(function SkeletonChart({ title }: { title: string }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 animate-pulse">
      <div className="h-4 w-36 rounded-full bg-gray-200 mb-4" />
      <div className="h-[240px] rounded-xl bg-gray-100" />
    </div>
  );
});

// ─── CampaignHealthDonut ──────────────────────────────────────────────────────

const HEALTH_COLORS = {
  excellent: '#10B981',
  healthy:   '#3B82F6',
  warning:   '#F59E0B',
  stalled:   '#EF4444',
};

export const CampaignHealthDonut = memo(function CampaignHealthDonut({ health }: { health: CampaignHealth }) {
  const total = health.excellent + health.healthy + health.warning + health.stalled;
  const data = [
    { name: 'Excellent', value: health.excellent, color: HEALTH_COLORS.excellent },
    { name: 'Healthy',   value: health.healthy,   color: HEALTH_COLORS.healthy   },
    { name: 'Warning',   value: health.warning,   color: HEALTH_COLORS.warning   },
    { name: 'Stalled',   value: health.stalled,   color: HEALTH_COLORS.stalled   },
  ].filter(d => d.value > 0);

  if (total === 0) return (
    <div className="flex flex-col items-center justify-center h-[200px] text-sm text-gray-400">No campaigns yet</div>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
              dataKey="value" paddingAngle={3} strokeWidth={0}>
              {data.map(d => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => [`${v} sequences (${fmtPct((v / total) * 100)})`, '']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 w-full">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span className="text-xs text-gray-500">{d.name}</span>
            <span className="text-xs font-bold text-gray-800 ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── ActivityTimeline ────────────────────────────────────────────────────────

const ACTIVITY_CFG: Record<ActivityType, { icon: React.ElementType; label: string; verb: string; color: string; bg: string }> = {
  email_sent:     { icon: Send,               label: 'Email sent',     verb: 'to',   color: 'text-violet-600',  bg: 'bg-violet-50'  },
  email_opened:   { icon: Eye,                label: 'Email opened',   verb: 'by',   color: 'text-amber-600',   bg: 'bg-amber-50'   },
  link_clicked:   { icon: Link2,              label: 'Link clicked',   verb: 'by',   color: 'text-cyan-600',    bg: 'bg-cyan-50'    },
  reply_received: { icon: MessageSquareReply, label: 'Reply received', verb: 'from', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  email_bounced:  { icon: AlertTriangle,      label: 'Email bounced',  verb: 'for',  color: 'text-red-600',     bg: 'bg-red-50'     },
};

export const ActivityTimeline = memo(function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
        <Mail className="h-10 w-10 opacity-30" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-gray-50">
      {events.map((ev, idx) => {
        const cfg = ACTIVITY_CFG[ev.type] ?? ACTIVITY_CFG.email_sent;
        const Icon = cfg.icon;
        return (
          <div key={`${ev.type}-${ev.email}-${idx}`}
            className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/70 transition-colors">
            <div className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${cfg.bg}`}>
              <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">
                <span className="font-medium">{cfg.label}</span>{' '}{cfg.verb}{' '}
                <span className="font-semibold text-gray-900">{ev.email}</span>
              </p>
              <p className="text-xs text-gray-400 truncate">{ev.sequenceName}</p>
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 tabular-nums">
              {relTime(ev.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export const SkeletonActivity = memo(function SkeletonActivity() {
  return (
    <div className="divide-y divide-gray-50 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <div className="h-8 w-8 rounded-lg bg-gray-100 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-52 rounded-full bg-gray-200" />
            <div className="h-3 w-32 rounded-full bg-gray-100" />
          </div>
          <div className="h-3 w-14 rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
});

// ─── AnalyticsTable (sequences) ───────────────────────────────────────────────

export interface SeqRow {
  sequenceId: string; name: string; status: string; sent: number;
  openRate: number; replyRate: number; bounceRate: number; health: SequenceHealth;
}

interface AnalyticsTableProps { rows: SeqRow[]; onRowClick?: (id: string) => void; onRefresh?: () => void; }

import { SequenceActionMenu, SenderActionMenu } from './ActionComponents';

export const AnalyticsTable = memo(function AnalyticsTable({ rows, onRowClick }: AnalyticsTableProps) {
  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
      <Send className="h-10 w-10 opacity-30" />
      <p className="text-sm">No sequences to display</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70">
            {['Sequence', 'Status', 'Sent', 'Open Rate', 'Reply Rate', 'Bounce Rate', 'Health', ''].map((h, i) => (
              <th key={i} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(row => (
            <tr key={row.sequenceId}
              className={`hover:bg-gray-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={() => onRowClick?.(row.sequenceId)}>
              <td className="px-5 py-3.5 font-medium text-gray-900 max-w-[220px] truncate" title={row.name}>{row.name}</td>
              <td className="px-5 py-3.5"><StatusBadge status={row.status} /></td>
              <td className="px-5 py-3.5 tabular-nums text-gray-700">{fmtNum(row.sent)}</td>
              <td className="px-5 py-3.5 tabular-nums font-medium text-amber-600">{fmtPct(row.openRate)}</td>
              <td className="px-5 py-3.5 tabular-nums font-medium text-emerald-600">{fmtPct(row.replyRate)}</td>
              <td className={`px-5 py-3.5 tabular-nums font-medium ${row.bounceRate >= 5 ? 'text-red-600' : 'text-gray-600'}`}>{fmtPct(row.bounceRate)}</td>
              <td className="px-5 py-3.5"><HealthBadge health={row.health} variant="sequence" /></td>
              <td className="px-5 py-3.5">
                <SequenceActionMenu
                  sequenceId={row.sequenceId}
                  status={row.status}
                  onAction={(a) => {
                    if (a === 'analytics') onRowClick?.(row.sequenceId);
                    else onRefresh?.();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export const SkeletonTable = memo(function SkeletonTable({ cols = 7 }: { cols?: number }) {
  return (
    <div className="overflow-x-auto animate-pulse">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-5 py-3"><div className="h-3 rounded-full bg-gray-200" style={{ width: `${50 + i * 10}px` }} /></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }).map((__, j) => (
                <td key={j} className="px-5 py-3.5">
                  <div className="h-3.5 rounded-full bg-gray-100" style={{ width: `${40 + ((i + j) * 11) % 50}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ─── SenderRow ────────────────────────────────────────────────────────────────

export interface SenderTableRow {
  connectionId: string; email: string; label: string;
  dailyVolume: number; dailyLimit: number; limitUsagePercent: number;
  openRate: number; bounceRate: number; failureRate: number;
  health: SenderHealth;
}

interface SenderTableProps { rows: SenderTableRow[]; onRefresh?: () => void; }

export const SenderTable = memo(function SenderTable({ rows, onRefresh }: SenderTableProps) {
  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
      <Mail className="h-10 w-10 opacity-30" />
      <p className="text-sm">No senders configured</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70">
            {['Sender', 'Daily Volume', 'Open Rate', 'Bounce Rate', 'Failure Rate', 'Health', ''].map((h, i) => (
              <th key={i} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(row => (
            <tr key={row.connectionId} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-3.5">
                <p className="font-medium text-gray-900 truncate max-w-[200px]">{row.email}</p>
                {row.label && <p className="text-xs text-gray-400">{row.label}</p>}
              </td>
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-700">{row.dailyVolume}/{row.dailyLimit}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden w-16">
                    <div className={`h-full rounded-full ${row.limitUsagePercent > 85 ? 'bg-red-400' : row.limitUsagePercent > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(100, row.limitUsagePercent)}%` }} />
                  </div>
                </div>
              </td>
              <td className="px-5 py-3.5 tabular-nums font-medium text-amber-600">{fmtPct(row.openRate)}</td>
              <td className={`px-5 py-3.5 tabular-nums font-medium ${row.bounceRate >= 5 ? 'text-red-600' : row.bounceRate >= 3 ? 'text-amber-600' : 'text-gray-600'}`}>{fmtPct(row.bounceRate)}</td>
              <td className={`px-5 py-3.5 tabular-nums font-medium ${row.failureRate > 5 ? 'text-red-600' : 'text-gray-600'}`}>{fmtPct(row.failureRate)}</td>
              <td className="px-5 py-3.5"><HealthBadge health={row.health} variant="sender" /></td>
              <td className="px-5 py-3.5">
                <SenderActionMenu
                  senderId={row.connectionId}
                  status={row.health === 'critical' ? 'paused' : 'active'} /* Fallback for missing status in summary */
                  onAction={() => onRefresh?.()}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ─── ErrorCard ────────────────────────────────────────────────────────────────

export const ErrorCard = memo(function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-8 flex flex-col items-center gap-3">
      <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <p className="text-sm font-medium text-gray-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-1 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm">
          Try Again
        </button>
      )}
    </div>
  );
});
