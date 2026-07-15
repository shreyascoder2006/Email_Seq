import React, { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Mail, Eye, MousePointerClick,
  MessageSquareReply, AlertTriangle, UserMinus, Users,
  Send, Clock, Globe, Zap, TrendingUp, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from 'recharts';
import {
  analyticsService,
  type FullSequencePayload, type StepBreakdown, type FunnelData,
  type RecipientSummary,
} from '../services/analytics.service';
import {
  AnalyticsChart, SkeletonChart,
  ActivityTimeline, SkeletonActivity,
  StatusBadge, HealthBadge, ErrorCard,
  fmtNum, fmtPct, fmtDate, SkeletonKPI,
} from '../components/analytics';
import { AnalyticsFilterBar } from '../components/analytics/FilterBar';
import { useAnalyticsFilters } from '../hooks/useAnalyticsFilters';
import { RecipientTable } from '../components/analytics/RecipientTable';
import { SequenceActionMenu, SavedViewsPanel } from '../components/analytics/ActionComponents';

// ─── helpers ─────────────────────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl bg-white border border-gray-100 shadow-sm ${className}`}>{children}</div>
);

const CardHead: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({ title, sub, right }) => (
  <div className="flex items-start justify-between px-5 py-4 border-b border-gray-50">
    <div>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
    {right}
  </div>
);

// Compact KPI tile for this page
const Tile = memo(function Tile({
  label, value, rate, rateLabel, icon: Icon, iconColor, iconBg, highlight, onClick,
}: {
  label: string; value: number; rate?: number; rateLabel?: string;
  icon: React.ElementType; iconColor: string; iconBg: string; highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className={`w-full text-left rounded-2xl border p-4 flex flex-col gap-2 transition-all ${
      highlight ? 'bg-red-50 border-red-100 hover:border-red-300' : 'bg-white border-gray-100 shadow-sm hover:border-indigo-300 hover:shadow-md cursor-pointer'
    }`}>
      <div className="flex items-center justify-between w-full">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
      </div>
      <span className="text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(value)}</span>
      {rate !== undefined && (
        <p className="text-xs text-gray-400">{rateLabel}: <span className="font-semibold text-gray-600">{fmtPct(rate)}</span></p>
      )}
    </button>
  );
});

const SkeletonTile = () => (
  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-2 animate-pulse">
    <div className="flex items-center justify-between">
      <div className="h-3 w-20 rounded-full bg-gray-200" />
      <div className="h-8 w-8 rounded-lg bg-gray-100" />
    </div>
    <div className="h-7 w-16 rounded-lg bg-gray-200" />
    <div className="h-3 w-28 rounded-full bg-gray-100" />
  </div>
);

// ─── Funnel ───────────────────────────────────────────────────────────────────

const FUNNEL_COLORS = ['#7C3AED','#3B82F6','#F59E0B','#06B6D4','#10B981'];

const FunnelChart = memo(function FunnelChart({ funnel }: { funnel: FunnelData }) {
  const steps: { label: string; value: number; color: string }[] = [
    { label: 'Enrolled', value: funnel.enrolled, color: FUNNEL_COLORS[0] },
    { label: 'Sent',     value: funnel.sent,     color: FUNNEL_COLORS[1] },
    { label: 'Opened',  value: funnel.opened,   color: FUNNEL_COLORS[2] },
    { label: 'Clicked', value: funnel.clicked,  color: FUNNEL_COLORS[3] },
    { label: 'Replied', value: funnel.replied,  color: FUNNEL_COLORS[4] },
  ];
  const max = Math.max(funnel.enrolled, 1);

  return (
    <div className="flex flex-col gap-2 py-2">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / max) * 100);
        const convPct = i > 0 && steps[i - 1].value > 0
          ? Math.round((s.value / steps[i - 1].value) * 100)
          : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 w-16 text-right">{s.label}</span>
            <div className="flex-1 h-7 rounded-lg bg-gray-50 overflow-hidden relative">
              <div className="h-full rounded-lg transition-all duration-500"
                style={{ width: `${pct}%`, background: s.color, opacity: 0.85 }} />
              <span className="absolute inset-0 flex items-center px-2.5 text-xs font-bold text-gray-800">
                {fmtNum(s.value)}
              </span>
            </div>
            {convPct !== null && (
              <span className="text-xs text-gray-400 w-12 text-right">{convPct}%</span>
            )}
            {convPct === null && <span className="w-12" />}
          </div>
        );
      })}
    </div>
  );
});

// ─── Step Performance Table ────────────────────────────────────────────────────

type SortKey = 'stepIndex' | 'sent' | 'openRate' | 'clickRate';

const StepTable = memo(function StepTable({ steps }: { steps: StepBreakdown[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('stepIndex');
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    return [...steps].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return asc ? diff : -diff;
    });
  }, [steps, sortKey, asc]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) setAsc(p => !p);
    else { setSortKey(k); setAsc(false); }
  };

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-gray-800 transition-colors"
      onClick={() => toggle(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k ? (asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
      </span>
    </th>
  );

  if (steps.length === 0) return (
    <div className="flex flex-col items-center py-10 gap-2 text-gray-400">
      <Mail className="h-8 w-8 opacity-30" />
      <p className="text-sm">No step data yet</p>
    </div>
  );

  const maxSent = Math.max(...steps.map(s => s.sent), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            <Th k="stepIndex" label="Step" />
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Label</th>
            <Th k="sent"     label="Sent" />
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Volume</th>
            <Th k="openRate"  label="Open Rate" />
            <Th k="clickRate" label="Click Rate" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map(s => {
            const barW = Math.round((s.sent / maxSent) * 100);
            const health = s.openRate >= 30 ? 'excellent' : s.openRate >= 15 ? 'healthy' : s.openRate > 0 ? 'warning' : 'stalled';
            return (
              <tr key={s.stepIndex} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3.5 tabular-nums text-gray-500 font-medium">#{s.stepIndex + 1}</td>
                <td className="px-4 py-3.5 font-medium text-gray-900 max-w-[180px] truncate">{s.label}</td>
                <td className="px-4 py-3.5 tabular-nums text-gray-700">{fmtNum(s.sent)}</td>
                <td className="px-4 py-3.5 w-32">
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-400" style={{ width: `${barW}%` }} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`tabular-nums font-semibold ${s.openRate >= 20 ? 'text-amber-600' : s.openRate >= 10 ? 'text-gray-700' : 'text-red-500'}`}>
                    {fmtPct(s.openRate)}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className={`tabular-nums font-semibold ${s.clickRate >= 5 ? 'text-cyan-600' : 'text-gray-600'}`}>
                      {fmtPct(s.clickRate)}
                    </span>
                    <HealthBadge health={health} variant="sequence" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// ─── Recipient Donut ─────────────────────────────────────────────────────────

const RECIPIENT_COLORS: Record<keyof RecipientSummary, string> = {
  active:       '#10B981',
  completed:    '#3B82F6',
  replied:      '#7C3AED',
  paused:       '#F59E0B',
  bounced:      '#EF4444',
  unsubscribed: '#9CA3AF',
};

const RecipientDonut = memo(function RecipientDonut({ summary }: { summary: RecipientSummary }) {
  const data = (Object.keys(summary) as Array<keyof RecipientSummary>)
    .map(k => ({ name: k, value: summary[k], color: RECIPIENT_COLORS[k] }))
    .filter(d => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) return (
    <div className="flex flex-col items-center justify-center h-[180px] text-sm text-gray-400">No recipients yet</div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
              dataKey="value" paddingAngle={2} strokeWidth={0}>
              {data.map(d => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => [`${v} contacts`, '']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span className="text-xs text-gray-500 capitalize">{d.name}</span>
            <span className="text-xs font-bold text-gray-800 ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Quick Insights ───────────────────────────────────────────────────────────

const Insights = memo(function Insights({ data }: { data: FullSequencePayload }) {
  const insights: { icon: React.ElementType; color: string; bg: string; text: string }[] = [];

  const best = [...data.stepBreakdown].sort((a, b) => b.openRate - a.openRate)[0];
  const worst = [...data.stepBreakdown].sort((a, b) => a.openRate - b.openRate)[0];

  if (best) insights.push({ icon: TrendingUp, color: 'text-emerald-700', bg: 'bg-emerald-50', text: `Step "${best.label}" is your best performer with ${fmtPct(best.openRate)} open rate.` });
  if (worst && worst.stepIndex !== best?.stepIndex) insights.push({ icon: AlertTriangle, color: 'text-amber-700', bg: 'bg-amber-50', text: `Step "${worst.label}" has the lowest open rate at ${fmtPct(worst.openRate)} — consider A/B testing the subject line.` });
  if (data.bounceRate >= 5) insights.push({ icon: AlertTriangle, color: 'text-red-700', bg: 'bg-red-50', text: `Bounce rate is ${fmtPct(data.bounceRate)} — above 5% threshold. Validate your contact list.` });
  if (data.replyRate >= 5) insights.push({ icon: Zap, color: 'text-violet-700', bg: 'bg-violet-50', text: `Excellent reply rate of ${fmtPct(data.replyRate)} — this sequence is outperforming industry benchmarks.` });
  if (data.status === 'active' && data.emailsSent === 0) insights.push({ icon: Clock, color: 'text-gray-600', bg: 'bg-gray-50', text: 'Campaign is active but no emails have been sent yet. Check your sending window settings.' });
  if (data.contacts.active > 0 && data.openRate < 5 && data.emailsSent > 10) insights.push({ icon: Eye, color: 'text-blue-700', bg: 'bg-blue-50', text: `Open rate of ${fmtPct(data.openRate)} is below 5%. Consider improving subject lines or sender reputation.` });

  if (insights.length === 0) return (
    <div className="px-5 py-6 text-center text-sm text-gray-400">Insights will appear once emails are sent.</div>
  );

  return (
    <div className="divide-y divide-gray-50">
      {insights.map((ins, i) => {
        const Icon = ins.icon;
        return (
          <div key={i} className={`flex gap-3 px-5 py-4 hover:bg-gray-50/70 transition-colors`}>
            <div className={`flex-shrink-0 h-8 w-8 rounded-lg ${ins.bg} flex items-center justify-center`}>
              <Icon className={`h-4 w-4 ${ins.color}`} />
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{ins.text}</p>
          </div>
        );
      })}
    </div>
  );
});

// ─── Main page ────────────────────────────────────────────────────────────────

const KPI_CFG = [
  { key: 'contacts' as const,     label: 'Total Contacts', icon: Users,              iconColor: 'text-blue-600',    iconBg: 'bg-blue-50',    rateKey: undefined,         rateLabel: undefined, drill: undefined },
  { key: 'emailsSent' as const,   label: 'Emails Sent',    icon: Mail,               iconColor: 'text-violet-600',  iconBg: 'bg-violet-50',  rateKey: undefined,         rateLabel: undefined, drill: undefined },
  { key: 'opens' as const,        label: 'Opens',          icon: Eye,                iconColor: 'text-amber-600',   iconBg: 'bg-amber-50',   rateKey: 'openRate',        rateLabel: 'Open Rate', drill: 'opened' as const },
  { key: 'clicks' as const,       label: 'Clicks',         icon: MousePointerClick,  iconColor: 'text-cyan-600',    iconBg: 'bg-cyan-50',    rateKey: 'clickRate',       rateLabel: 'Click Rate', drill: 'clicked' as const },
  { key: 'replies' as const,      label: 'Replies',        icon: MessageSquareReply, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50', rateKey: 'replyRate',       rateLabel: 'Reply Rate', drill: 'replied' as const },
  { key: 'bounces' as const,      label: 'Bounces',        icon: AlertTriangle,      iconColor: 'text-rose-600',    iconBg: 'bg-rose-50',    rateKey: 'bounceRate',      rateLabel: 'Bounce Rate', drill: 'bounced' as const },
  { key: 'unsubscribes' as const, label: 'Unsubscribes',  icon: UserMinus,          iconColor: 'text-orange-600',  iconBg: 'bg-orange-50',  rateKey: 'unsubscribeRate', rateLabel: 'Unsub Rate', drill: undefined },
] as const;

const TREND_SERIES = [
  { key: 'Sent',    label: 'Sent',    color: '#7C3AED' },
  { key: 'Opens',   label: 'Opens',   color: '#F59E0B' },
  { key: 'Clicks',  label: 'Clicks',  color: '#06B6D4' },
  { key: 'Replies', label: 'Replies', color: '#10B981' },
];

export const SequenceAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { filters, queryString, setFilter, setPreset, setDateRange, clearFilters, hasActiveFilters } =
    useAnalyticsFilters();

  const [data,    setData]    = useState<FullSequencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Recipient Table State
  const [recipientsData, setRecipientsData] = useState<any>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientPage, setRecipientPage] = useState(1);
  const [drillFilter, setDrillFilter] = useState<'opened' | 'clicked' | 'replied' | 'bounced' | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try { setData(await analyticsService.getFullSequence(id, queryString)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [id, queryString]);

  const loadRecipients = useCallback(async () => {
    if (!id) return;
    setRecipientsLoading(true);
    try {
      const qs = queryString ? `${queryString}&page=${recipientPage}` : `page=${recipientPage}`;
      setRecipientsData(await analyticsService.getRecipientMetrics(id, qs));
    } catch (e) { console.error('Failed to load recipients', e); }
    finally { setRecipientsLoading(false); }
  }, [id, queryString, recipientPage]);

  // Combined refresh
  const refreshAll = useCallback(() => {
    load();
    loadRecipients();
  }, [load, loadRecipients]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.dailyTrend.sent.map((pt, i) => ({
      date:    pt.date,
      Sent:    pt.count,
      Opens:   data.dailyTrend.opens[i]?.count   ?? 0,
      Clicks:  data.dailyTrend.clicks[i]?.count  ?? 0,
      Replies: data.dailyTrend.replies[i]?.count ?? 0,
    }));
  }, [data]);

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm">
          <ArrowLeft className="h-4 w-4 text-gray-600" />
        </button>
        <div>
          {loading
            ? <div className="h-6 w-48 rounded-full bg-gray-200 animate-pulse" />
            : <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{data?.name ?? 'Sequence Analytics'}</h1>
                {data && <StatusBadge status={data.status} />}
              </div>
          }
          <p className="text-xs text-gray-400 mt-0.5">Sequence performance analytics</p>
        </div>
      </div>
      <div className="flex gap-2">
        <SavedViewsPanel
          page="sequence-analytics"
          currentFilters={filters as any}
          onLoad={(f) => {
            clearFilters();
            Object.entries(f).forEach(([k, v]) => setFilter(k, v));
          }}
        />
        <button onClick={refreshAll} disabled={loading || recipientsLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${(loading || recipientsLoading) ? 'animate-spin' : ''}`} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {id && data && (
          <SequenceActionMenu
            sequenceId={id}
            status={data.status}
            onAction={(action) => {
              if (action === 'analytics') return;
              refreshAll();
            }}
          />
        )}
      </div>
    </div>
  );

  if (!loading && error) return (
    <div>{header}<ErrorCard message={error} onRetry={load} /></div>
  );

  return (
    <div className="space-y-5">
      {header}

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <AnalyticsFilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onPreset={setPreset}
        onDateRange={setDateRange}
        onFilter={(k, v) => setFilter(k, v)}
        onClear={clearFilters}
        show={{ dateRange: true, search: true }}
        searchPlaceholder="Search recipients…"
      />

      {/* ── Section 1: Sequence Header ───────────────────────────────── */}
      {!loading && data && (
        <Card>
          <div className="px-5 py-4 flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500">Timezone:</span>
              <span className="text-xs font-medium text-gray-800">
                {(data.sendingWindow as Record<string,string> | undefined)?.timezone ?? 'UTC'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500">Window:</span>
              <span className="text-xs font-medium text-gray-800">
                {(data.sendingWindow as Record<string,string> | undefined)?.start_time ?? '09:00'} –{' '}
                {(data.sendingWindow as Record<string,string> | undefined)?.end_time ?? '17:00'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500">Total Steps:</span>
              <span className="text-xs font-medium text-gray-800">{data.stepBreakdown.length}</span>
            </div>
            <div className="ml-auto">
              <HealthBadge
                health={data.bounceRate >= 5 ? 'warning' : data.replyRate >= 5 ? 'excellent' : data.emailsSent === 0 ? 'stalled' : 'healthy'}
                variant="sequence"
              />
            </div>
          </div>
        </Card>
      )}

      {/* ── Section 2: KPI Cards ─────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {loading
          ? Array.from({ length: 7 }).map((_, i) => <SkeletonTile key={i} />)
          : KPI_CFG.map(cfg => (
              <Tile
                key={cfg.key}
                label={cfg.label}
                value={cfg.key === 'contacts' ? data?.contacts.total ?? 0 : (data as any)?.[cfg.key] ?? 0}
                icon={cfg.icon}
                iconColor={cfg.iconColor}
                iconBg={cfg.iconBg}
                rate={cfg.rateKey ? (data as any)?.[cfg.rateKey] : undefined}
                rateLabel={cfg.rateLabel}
                highlight={cfg.key === 'bounces' && (data as any)?.bounceRate >= 5}
                onClick={() => {
                  if (cfg.drill) setDrillFilter(cfg.drill);
                  else if (cfg.key === 'contacts') clearFilters();
                  document.getElementById('recipient-table')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            ))}
      </div>

      {/* ── Section 3 + 4: Trend Chart + Funnel ─────────────────────── */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {loading
            ? <SkeletonChart title="30-Day Trend" />
            : <AnalyticsChart data={chartData} series={TREND_SERIES}
                title="30-Day Trend" subtitle="Sent, opens, clicks, replies" />
          }
        </div>
        <Card>
          <CardHead title="Conversion Funnel" sub="Enrolled → Replied" />
          <div className="px-5 py-4">
            {loading
              ? <div className="space-y-2 animate-pulse">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-7 rounded-lg bg-gray-100" />)}</div>
              : data && <FunnelChart funnel={data.funnel} />
            }
          </div>
        </Card>
      </div>

      {/* ── Section 5: Step Performance ──────────────────────────────── */}
      <Card>
        <CardHead title="Step Performance" sub="Click column headers to sort" />
        {loading
          ? <div className="p-5 space-y-3 animate-pulse">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 rounded-xl bg-gray-100" />)}</div>
          : data && <StepTable steps={data.stepBreakdown} />
        }
      </Card>

      {/* ── Section 6 + 7: Recipient Donut + Activity ────────────────── */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-3">
        <Card>
          <CardHead title="Recipient Status" sub="Contact distribution" />
          <div className="px-5 py-4">
            {loading
              ? <div className="h-[180px] rounded-xl bg-gray-100 animate-pulse" />
              : data && <RecipientDonut summary={data.recipientSummary} />
            }
          </div>
        </Card>
        <div className="lg:col-span-2">
          <Card>
            <CardHead title="Recent Activity" sub="Latest events in this sequence" />
            {loading
              ? <SkeletonActivity />
              : data && <ActivityTimeline events={data.recentActivity} />
            }
          </Card>
        </div>
      </div>

      {/* ── Section 8: Quick Insights ─────────────────────────────────── */}
      <Card>
        <CardHead title="Quick Insights" sub="AI-interpreted from backend metrics" />
        {loading
          ? <div className="p-5 space-y-3 animate-pulse">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-100" />)}</div>
          : data && <Insights data={data} />
        }
      </Card>

      {/* ── Section 9: Recipient Table ───────────────────────────────── */}
      <div id="recipient-table" className="pt-4">
        {id && (
          <RecipientTable
            sequenceId={id}
            recipients={recipientsData?.contacts ?? []}
            totalCount={recipientsData?.total ?? 0}
            page={recipientPage}
            totalPages={recipientsData?.totalPages ?? 1}
            loading={recipientsLoading}
            onPageChange={setRecipientPage}
            onRefresh={refreshAll}
            drillFilter={drillFilter}
            onDrillFilterChange={setDrillFilter}
          />
        )}
      </div>
    </div>
  );
};
