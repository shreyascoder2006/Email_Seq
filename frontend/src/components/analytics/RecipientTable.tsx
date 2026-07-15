/**
 * RecipientTable.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1 + 4: Paginated recipient table with:
 *  - Row selection + bulk action bar
 *  - KPI drill-down filter (opened/clicked/replied/bounced)
 *  - Per-row quick actions (pause/resume/remove)
 *  - Sort by any column
 *  - Status badge coloring
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Pause, Play, UserMinus, RotateCcw,
  Eye, MousePointerClick, MessageSquareReply, AlertTriangle,
  Check, Minus, Loader2,
} from 'lucide-react';
import { actionsService, type BulkActionPayload } from '../../services/actions.service';
import {
  BulkActionBar, ConfirmDialog, useActionToast,
  RECIPIENT_BULK_ACTIONS, type BulkAction,
} from './ActionComponents';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipientRow {
  contactId:       string;
  email:           string;
  firstName?:      string;
  lastName?:       string;
  company?:        string;
  status:          string;
  currentStep:     number;
  totalSteps:      number;
  progressPercent: number;
  enrolledAt?:     string;
  lastActivityAt?: string | null;
  emailsReceived:  number;
  hasOpened:       boolean;
  hasClicked:      boolean;
  hasReplied:      boolean;
  hasBounced:      boolean;
}

export interface RecipientTableProps {
  sequenceId:   string;
  recipients:   RecipientRow[];
  totalCount:   number;
  page:         number;
  totalPages:   number;
  loading?:     boolean;
  onPageChange: (p: number) => void;
  onRefresh:    () => void;
  /** KPI drill-down: pre-filter by engagement type */
  drillFilter?: 'opened' | 'clicked' | 'replied' | 'bounced' | null;
  onDrillFilterChange?: (f: 'opened' | 'clicked' | 'replied' | 'bounced' | null) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:       'bg-emerald-50 text-emerald-700 border-emerald-100',
  paused:       'bg-amber-50  text-amber-700  border-amber-100',
  completed:    'bg-blue-50   text-blue-700   border-blue-100',
  replied:      'bg-violet-50 text-violet-700 border-violet-100',
  bounced:      'bg-red-50    text-red-700    border-red-100',
  unsubscribed: 'bg-gray-50   text-gray-600   border-gray-200',
  failed:       'bg-rose-50   text-rose-700   border-rose-100',
  removed:      'bg-gray-100  text-gray-400   border-gray-200',
};

const DRILL_FILTERS = [
  { id: 'opened',  label: 'Opened',   icon: Eye,                color: 'text-amber-600',   bg: 'bg-amber-50'   },
  { id: 'clicked', label: 'Clicked',  icon: MousePointerClick,  color: 'text-cyan-600',    bg: 'bg-cyan-50'    },
  { id: 'replied', label: 'Replied',  icon: MessageSquareReply, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'bounced', label: 'Bounced',  icon: AlertTriangle,      color: 'text-red-600',     bg: 'bg-red-50'     },
] as const;

type SortKey = 'email' | 'status' | 'currentStep' | 'emailsReceived' | 'lastActivityAt' | 'enrolledAt';

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

const ProgressBar = memo(function ProgressBar({ pct, step, total }: { pct: number; step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">{step}/{total}</span>
    </div>
  );
});

// ─── RowCheckbox ─────────────────────────────────────────────────────────────

const RowCheckbox = memo(function RowCheckbox({
  checked, indeterminate, onChange,
}: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
        checked || indeterminate
          ? 'bg-indigo-600 border-indigo-600'
          : 'bg-white border-gray-300 hover:border-indigo-400'
      }`}>
      {indeterminate
        ? <Minus className="h-2.5 w-2.5 text-white" />
        : checked ? <Check className="h-2.5 w-2.5 text-white" /> : null
      }
    </button>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────

export const RecipientTable = memo(function RecipientTable({
  sequenceId, recipients, totalCount, page, totalPages, loading = false,
  onPageChange, onRefresh, drillFilter, onDrillFilterChange,
}: RecipientTableProps) {
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [sortKey,    setSortKey]    = useState<SortKey>('enrolledAt');
  const [sortAsc,    setSortAsc]    = useState(false);
  const [confirm,    setConfirm]    = useState<{ action: string; count: number } | null>(null);
  const [actionLoad, setActionLoad] = useState(false);
  const { run, ToastComponent }     = useActionToast();

  // Clear selection when page changes
  useEffect(() => setSelected(new Set()), [page]);

  // Client-side sort (within current page)
  const sorted = useMemo(() => {
    return [...recipients].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'email')          diff = a.email.localeCompare(b.email);
      else if (sortKey === 'status')    diff = a.status.localeCompare(b.status);
      else if (sortKey === 'currentStep') diff = a.currentStep - b.currentStep;
      else if (sortKey === 'emailsReceived') diff = a.emailsReceived - b.emailsReceived;
      else if (sortKey === 'lastActivityAt') diff = (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? '');
      else if (sortKey === 'enrolledAt') diff = (a.enrolledAt ?? '').localeCompare(b.enrolledAt ?? '');
      return sortAsc ? diff : -diff;
    });
  }, [recipients, sortKey, sortAsc]);

  // Apply drill-down filter client-side
  const filtered = useMemo(() => {
    if (!drillFilter) return sorted;
    return sorted.filter(r =>
      drillFilter === 'opened'  ? r.hasOpened :
      drillFilter === 'clicked' ? r.hasClicked :
      drillFilter === 'replied' ? r.hasReplied :
      drillFilter === 'bounced' ? r.hasBounced : true
    );
  }, [sorted, drillFilter]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(p => !p);
    else { setSortKey(k); setSortAsc(false); }
  };

  const toggleAll = useCallback(() => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.contactId)));
  }, [selected.size, filtered]);

  const toggleRow = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkAction = async (actionId: string) => {
    const action = RECIPIENT_BULK_ACTIONS.find(a => a.id === actionId);
    if (!action) return;
    if (action.confirm) {
      setConfirm({ action: actionId, count: selected.size });
      return;
    }
    await executeBulkAction(actionId);
  };

  const executeBulkAction = async (actionId: string) => {
    const payload: BulkActionPayload = { contactIds: Array.from(selected) };
    setActionLoad(true);
    setConfirm(null);

    const actionMessages = {
      pause:    { loading: 'Pausing…',      success: `Paused ${selected.size} recipient(s)` },
      resume:   { loading: 'Resuming…',     success: `Resumed ${selected.size} recipient(s)` },
      reenroll: { loading: 'Re-enrolling…', success: `Re-enrolled ${selected.size} recipient(s)` },
      remove:   { loading: 'Removing…',     success: `Removed ${selected.size} recipient(s)` },
      delete:   { loading: 'Deleting…',     success: `Deleted ${selected.size} recipient(s)` },
      export:   { loading: 'Exporting…',    success: 'CSV download started' },
    }[actionId] ?? { loading: 'Processing…', success: 'Done' };

    let promise: Promise<unknown>;
    if (actionId === 'export') {
      promise = actionsService.exportRecipients(sequenceId);
    } else if (actionId === 'pause') {
      promise = actionsService.pauseRecipients(sequenceId, payload);
    } else if (actionId === 'resume') {
      promise = actionsService.resumeRecipients(sequenceId, payload);
    } else if (actionId === 'reenroll') {
      promise = actionsService.reenrollRecipients(sequenceId, payload);
    } else if (actionId === 'remove') {
      promise = actionsService.removeRecipients(sequenceId, payload);
    } else {
      promise = actionsService.deleteRecipients(sequenceId, payload);
    }

    await run(promise, actionMessages);
    setActionLoad(false);
    setSelected(new Set());
    onRefresh();
  };

  // Column header helper
  const Th = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800 transition-colors whitespace-nowrap ${className}`}
      onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k
          ? sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          : null
        }
      </span>
    </th>
  );

  const allSelected   = filtered.length > 0 && selected.size === filtered.length;
  const someSelected  = selected.size > 0 && !allSelected;
  const isLoading     = loading || actionLoad;

  return (
    <div className="space-y-3">
      {/* ── Phase 4: KPI Drill-down filter strip ─────────────────── */}
      {onDrillFilterChange && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Show only:</span>
          {DRILL_FILTERS.map(f => {
            const Icon = f.icon;
            const active = drillFilter === f.id;
            return (
              <button key={f.id}
                onClick={() => onDrillFilterChange(active ? null : f.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                  active
                    ? `${f.bg} ${f.color} border-current shadow-sm`
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                <Icon className={`h-3 w-3 ${active ? f.color : ''}`} />
                {f.label}
              </button>
            );
          })}
          {drillFilter && (
            <button onClick={() => onDrillFilterChange(null)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-1">
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Phase 1: Bulk Action Bar ──────────────────────────────── */}
      <BulkActionBar
        selectedCount={selected.size}
        onAction={handleBulkAction}
        onClear={() => setSelected(new Set())}
        loading={isLoading}
      />

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-4 py-3 w-8">
                  <RowCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                  />
                </th>
                <Th k="email"           label="Recipient"     />
                <Th k="status"          label="Status"        />
                <Th k="currentStep"     label="Progress"      />
                <Th k="emailsReceived"  label="Emails"        />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Engagement</th>
                <Th k="lastActivityAt"  label="Last Activity" />
                <Th k="enrolledAt"      label="Enrolled"      />
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-400 mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                    No recipients match the current filter.
                  </td>
                </tr>
              )}
              {filtered.map(r => {
                const isSelected = selected.has(r.contactId);
                return (
                  <tr key={r.contactId}
                    className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <RowCheckbox checked={isSelected} onChange={() => toggleRow(r.contactId)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900 text-sm">{r.email}</span>
                        {(r.firstName || r.company) && (
                          <span className="text-xs text-gray-400">
                            {[r.firstName, r.lastName].filter(Boolean).join(' ')}
                            {r.company && ` · ${r.company}`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${STATUS_COLORS[r.status] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar pct={r.progressPercent} step={r.currentStep} total={r.totalSteps} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{r.emailsReceived}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {r.hasOpened  && <span title="Opened"  className="h-5 w-5 rounded-full bg-amber-100 flex items-center justify-center"><Eye               className="h-3 w-3 text-amber-600"   /></span>}
                        {r.hasClicked && <span title="Clicked" className="h-5 w-5 rounded-full bg-cyan-100 flex items-center justify-center"><MousePointerClick  className="h-3 w-3 text-cyan-600"    /></span>}
                        {r.hasReplied && <span title="Replied" className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center"><MessageSquareReply className="h-3 w-3 text-emerald-600" /></span>}
                        {r.hasBounced && <span title="Bounced" className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center"><AlertTriangle      className="h-3 w-3 text-red-600"     /></span>}
                        {!r.hasOpened && !r.hasClicked && !r.hasReplied && !r.hasBounced && <span className="text-xs text-gray-300">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{fmtDate(r.lastActivityAt)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{fmtDate(r.enrolledAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.status === 'active' && (
                          <button title="Pause" onClick={() => run(actionsService.pauseRecipients(sequenceId, { contact_ids: [r.contactId] }), { loading: 'Pausing…', success: 'Paused' }).then(() => onRefresh())}
                            className="h-6 w-6 rounded-md bg-gray-100 hover:bg-amber-100 flex items-center justify-center transition-colors">
                            <Pause className="h-3 w-3 text-gray-500 hover:text-amber-600" />
                          </button>
                        )}
                        {r.status === 'paused' && (
                          <button title="Resume" onClick={() => run(actionsService.resumeRecipients(sequenceId, { contact_ids: [r.contactId] }), { loading: 'Resuming…', success: 'Resumed' }).then(() => onRefresh())}
                            className="h-6 w-6 rounded-md bg-gray-100 hover:bg-emerald-100 flex items-center justify-center transition-colors">
                            <Play className="h-3 w-3 text-gray-500" />
                          </button>
                        )}
                        {['failed','bounced','completed'].includes(r.status) && (
                          <button title="Re-enroll" onClick={() => run(actionsService.reenrollRecipients(sequenceId, { contact_ids: [r.contactId] }), { loading: 'Re-enrolling…', success: 'Re-enrolled' }).then(() => onRefresh())}
                            className="h-6 w-6 rounded-md bg-gray-100 hover:bg-violet-100 flex items-center justify-center transition-colors">
                            <RotateCcw className="h-3 w-3 text-gray-500" />
                          </button>
                        )}
                        <button title="Remove" onClick={() => run(actionsService.removeRecipients(sequenceId, { contact_ids: [r.contactId] }), { loading: 'Removing…', success: 'Removed' }).then(() => onRefresh())}
                          className="h-6 w-6 rounded-md bg-gray-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                          <UserMinus className="h-3 w-3 text-gray-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <span className="text-xs text-gray-400">
              {totalCount} recipients · Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
                className="h-7 w-7 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => onPageChange(p)}
                  className={`h-7 w-7 rounded-lg text-xs font-medium transition-colors ${
                    p === page ? 'bg-indigo-600 text-white' : 'border border-gray-200 hover:bg-gray-50 text-gray-600'
                  }`}>
                  {p}
                </button>
              ))}
              <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
                className="h-7 w-7 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition-colors">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm Dialog (Phase 7) ──────────────────────────────── */}
      <ConfirmDialog
        open={!!confirm}
        title={RECIPIENT_BULK_ACTIONS.find(a => a.id === confirm?.action)?.confirm?.title ?? 'Confirm action'}
        description={RECIPIENT_BULK_ACTIONS.find(a => a.id === confirm?.action)?.confirm?.description ?? ''}
        destructive={RECIPIENT_BULK_ACTIONS.find(a => a.id === confirm?.action)?.confirm?.destructive}
        confirmLabel={confirm?.action === 'delete' ? 'Delete' : 'Confirm'}
        affectedCount={confirm?.count}
        loading={actionLoad}
        onConfirm={() => confirm && executeBulkAction(confirm.action)}
        onCancel={() => setConfirm(null)}
      />

      {ToastComponent}
    </div>
  );
});
