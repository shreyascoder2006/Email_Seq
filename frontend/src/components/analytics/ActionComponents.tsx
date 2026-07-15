/**
 * ActionComponents.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable analytics action UI components.
 * Phase 1–3: Bulk action bar, confirmation dialog, sequence/sender menus.
 * Phase 6: Saved views panel.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { memo, useState, useRef, useEffect, useCallback } from 'react';
import {
  Trash2, Pause, Play, RotateCcw, UserMinus, Download,
  ChevronDown, X, AlertTriangle, Check, Loader2,
  MoreHorizontal, Archive, Copy, TestTube2, ExternalLink,
  Bookmark, BookmarkCheck, SlidersHorizontal,
} from 'lucide-react';

// ─── Utility: click-outside hook ─────────────────────────────────────────────

function useOutside(ref: React.RefObject<HTMLElement>, cb: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, cb]);
}

// ─── Phase 7: ConfirmDialog ───────────────────────────────────────────────────

export interface ConfirmDialogProps {
  open:            boolean;
  title:           string;
  description:     string;
  confirmLabel?:   string;
  destructive?:    boolean;
  affectedCount?:  number;
  loading?:        boolean;
  onConfirm:       () => void;
  onCancel:        () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirm',
  destructive = false, affectedCount, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4">
          <div className={`flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ${
            destructive ? 'bg-red-50' : 'bg-amber-50'
          }`}>
            <AlertTriangle className={`h-5 w-5 ${destructive ? 'text-red-600' : 'text-amber-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>
            {affectedCount !== undefined && (
              <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                destructive ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
              }`}>
                {affectedCount} recipient{affectedCount !== 1 ? 's' : ''} will be affected
              </div>
            )}
          </div>
          <button onClick={onCancel} className="flex-shrink-0 h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all flex items-center gap-2 disabled:opacity-60 ${
              destructive
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
            }`}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── Phase 1: BulkActionBar ───────────────────────────────────────────────────

export interface BulkAction {
  id:          string;
  label:       string;
  icon:        React.ElementType;
  variant?:    'default' | 'danger';
  confirm?:    { title: string; description: string; destructive?: boolean };
}

export const RECIPIENT_BULK_ACTIONS: BulkAction[] = [
  { id: 'pause',    label: 'Pause',     icon: Pause,     confirm: { title: 'Pause recipients?', description: 'Selected recipients will stop receiving emails until resumed.' } },
  { id: 'resume',   label: 'Resume',    icon: Play       },
  { id: 'reenroll', label: 'Re-enroll', icon: RotateCcw, confirm: { title: 'Re-enroll recipients?', description: 'Selected recipients will restart from Step 1.' } },
  { id: 'remove',   label: 'Remove',    icon: UserMinus, variant: 'danger', confirm: { title: 'Remove recipients?', description: 'Recipients will be soft-deleted from this sequence.', destructive: true } },
  { id: 'delete',   label: 'Delete',    icon: Trash2,    variant: 'danger', confirm: { title: 'Permanently delete?', description: 'This cannot be undone. All recipient data will be deleted.', destructive: true } },
  { id: 'export',   label: 'Export CSV', icon: Download  },
];

interface BulkActionBarProps {
  selectedCount: number;
  onAction:      (actionId: string) => void;
  onClear:       () => void;
  loading?:      boolean;
  actions?:      BulkAction[];
}

export const BulkActionBar = memo(function BulkActionBar({
  selectedCount, onAction, onClear, loading = false, actions = RECIPIENT_BULK_ACTIONS,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky top-2 z-30 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 shadow-xl shadow-indigo-200 border border-indigo-500 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 mr-2">
        <div className="h-6 w-6 rounded-md bg-white/20 flex items-center justify-center">
          <Check className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white">{selectedCount} selected</span>
      </div>
      <div className="h-4 w-px bg-white/30" />
      <div className="flex items-center gap-1 flex-wrap">
        {actions.map(action => {
          const Icon = action.icon;
          return (
            <button key={action.id}
              onClick={() => onAction(action.id)}
              disabled={loading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 ${
                action.variant === 'danger'
                  ? 'bg-red-500 hover:bg-red-400 text-white'
                  : 'bg-white/15 hover:bg-white/25 text-white'
              }`}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
              {action.label}
            </button>
          );
        })}
      </div>
      <button onClick={onClear} className="ml-auto h-7 w-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
        <X className="h-3.5 w-3.5 text-white" />
      </button>
    </div>
  );
});

// ─── Phase 2: SequenceActionMenu ──────────────────────────────────────────────

export interface SequenceActionMenuProps {
  sequenceId:  string;
  status:      string;
  onAction:    (action: 'pause' | 'resume' | 'archive' | 'delete' | 'duplicate' | 'analytics') => void;
}

export const SequenceActionMenu = memo(function SequenceActionMenu({
  sequenceId, status, onAction,
}: SequenceActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref as React.RefObject<HTMLElement>, () => setOpen(false));

  const items: { id: string; label: string; icon: React.ElementType; danger?: boolean; hidden?: boolean }[] = [
    { id: 'analytics', label: 'Open Analytics',  icon: ExternalLink },
    { id: 'pause',     label: 'Pause',            icon: Pause,    hidden: status !== 'active'  },
    { id: 'resume',    label: 'Resume',           icon: Play,     hidden: status !== 'paused'  },
    { id: 'archive',   label: 'Archive',          icon: Archive,  hidden: status === 'archived' },
    { id: 'duplicate', label: 'Duplicate',        icon: Copy      },
    { id: 'delete',    label: 'Delete',           icon: Trash2,   danger: true },
  ].filter(i => !i.hidden);

  return (
    <div ref={ref} className="relative">
      <button onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        className="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center transition-colors shadow-sm">
        <MoreHorizontal className="h-4 w-4 text-gray-500" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-44 bg-white rounded-xl border border-gray-100 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-150">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id}
                onClick={e => { e.stopPropagation(); setOpen(false); onAction(item.id as any); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
                  item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
                }`}>
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ─── Phase 3: SenderActionMenu ────────────────────────────────────────────────

export interface SenderActionMenuProps {
  senderId: string;
  status:   string;
  onAction: (action: 'pause' | 'resume' | 'test') => void;
}

export const SenderActionMenu = memo(function SenderActionMenu({
  senderId, status, onAction,
}: SenderActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref as React.RefObject<HTMLElement>, () => setOpen(false));

  const items = [
    { id: 'test',   label: 'Test SMTP',     icon: TestTube2 },
    { id: 'pause',  label: 'Pause Sender',  icon: Pause, hidden: status === 'paused'  },
    { id: 'resume', label: 'Resume Sender', icon: Play,  hidden: status !== 'paused'  },
  ].filter(i => !i.hidden);

  return (
    <div ref={ref} className="relative">
      <button onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        className="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center transition-colors shadow-sm">
        <MoreHorizontal className="h-4 w-4 text-gray-500" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-40 bg-white rounded-xl border border-gray-100 shadow-xl py-1">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id}
                onClick={e => { e.stopPropagation(); setOpen(false); onAction(item.id as any); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left">
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ─── Phase 6: SavedViewsPanel ─────────────────────────────────────────────────

import { savedViewsService, type SavedView } from '../../services/actions.service';
import type { AnalyticsFilters } from '../../hooks/useAnalyticsFilters';

interface SavedViewsPanelProps {
  page:         string;
  currentFilters: AnalyticsFilters;
  onLoad:       (filters: AnalyticsFilters) => void;
}

export const SavedViewsPanel = memo(function SavedViewsPanel({
  page, currentFilters, onLoad,
}: SavedViewsPanelProps) {
  const [open,    setOpen]    = useState(false);
  const [views,   setViews]   = useState<SavedView[]>([]);
  const [name,    setName]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref as React.RefObject<HTMLElement>, () => setOpen(false));

  const refresh = useCallback(() => setViews(savedViewsService.list().filter(v => v.page === page)), [page]);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const hasFilters = !!(currentFilters.from || currentFilters.status || currentFilters.search || currentFilters.health);

  const handleSave = () => {
    if (!name.trim()) return;
    setSaving(true);
    savedViewsService.save({ name: name.trim(), page, filters: currentFilters as Record<string,string> });
    setName('');
    refresh();
    setSaving(false);
  };

  const handleDelete = (id: string) => { savedViewsService.delete(id); refresh(); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-all shadow-sm font-medium ${
          views.length > 0 ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
        }`}>
        <Bookmark className="h-3.5 w-3.5" />
        Saved Views
        {views.length > 0 && <span className="text-xs font-bold">({views.length})</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white rounded-2xl border border-gray-100 shadow-xl p-3 space-y-3">
          {hasFilters && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Save Current View</p>
              <div className="flex gap-2">
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="View name…"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={handleSave} disabled={!name.trim() || saving}
                  className="px-3 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                  <BookmarkCheck className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          {views.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Saved Views</p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {views.map(v => (
                  <div key={v.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                    <button onClick={() => { onLoad(v.filters as AnalyticsFilters); setOpen(false); }}
                      className="flex-1 text-sm text-left text-gray-700 font-medium truncate">{v.name}</button>
                    <button onClick={() => handleDelete(v.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 rounded flex items-center justify-center hover:bg-red-50">
                      <X className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {views.length === 0 && !hasFilters && (
            <p className="text-xs text-gray-400 text-center py-4">Apply filters first to save a view.</p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Phase 9: ActionToast (progress indicator) ───────────────────────────────

interface ActionToastProps {
  message: string;
  type:    'loading' | 'success' | 'error';
  onDismiss: () => void;
}

export const ActionToast = memo(function ActionToast({ message, type, onDismiss }: ActionToastProps) {
  useEffect(() => {
    if (type !== 'loading') {
      const t = setTimeout(onDismiss, 3500);
      return () => clearTimeout(t);
    }
  }, [type, onDismiss]);

  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border text-sm font-medium animate-in slide-in-from-bottom-3 duration-300 ${
      type === 'loading' ? 'bg-white border-gray-200 text-gray-700' :
      type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                           'bg-red-50 border-red-200 text-red-800'
    }`}>
      {type === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
      {type === 'success' && <Check className="h-4 w-4 text-emerald-600" />}
      {type === 'error'   && <X    className="h-4 w-4 text-red-600" />}
      {message}
      {type !== 'loading' && (
        <button onClick={onDismiss} className="ml-2 hover:opacity-60 transition-opacity">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});

// ─── useActionToast hook ──────────────────────────────────────────────────────

type ToastState = { message: string; type: 'loading' | 'success' | 'error' } | null;

export function useActionToast() {
  const [toast, setToast] = useState<ToastState>(null);

  const run = useCallback(async <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error?: string }
  ): Promise<T | null> => {
    setToast({ message: messages.loading, type: 'loading' });
    try {
      const result = await promise;
      setToast({ message: messages.success, type: 'success' });
      return result;
    } catch (err) {
      const msg = messages.error ?? (err instanceof Error ? err.message : 'Action failed');
      setToast({ message: msg, type: 'error' });
      return null;
    }
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  const ToastComponent = toast
    ? <ActionToast message={toast.message} type={toast.type} onDismiss={dismiss} />
    : null;

  return { run, toast, ToastComponent };
}
