/**
 * useAnalyticsFilters.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8/9: URL-synchronised filter state with debounced search.
 * Persists filters in URL query params → shareable, refresh-safe URLs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'custom';

export interface AnalyticsFilters {
  from?:       string;   // YYYY-MM-DD
  to?:         string;   // YYYY-MM-DD
  preset?:     DatePreset;
  senderId?:   string;
  sequenceId?: string;
  status?:     string;
  search?:     string;
  health?:     string;
  // Recipient-specific
  currentStep?: number;
  sortBy?:      string;
  sortDir?:     'asc' | 'desc';
}

const PRESET_RANGES: Record<Exclude<DatePreset, 'custom'>, () => { from: string; to: string }> = {
  today:     () => { const d = today(); return { from: d, to: d }; },
  yesterday: () => { const d = daysAgo(1); return { from: d, to: d }; },
  last7:     () => ({ from: daysAgo(6),  to: today() }),
  last30:    () => ({ from: daysAgo(29), to: today() }),
  last90:    () => ({ from: daysAgo(89), to: today() }),
  thisMonth: () => {
    const n = new Date(); const f = new Date(n.getFullYear(), n.getMonth(), 1);
    return { from: fmt(f), to: today() };
  },
  lastMonth: () => {
    const n = new Date();
    const f = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const t = new Date(n.getFullYear(), n.getMonth(), 0);
    return { from: fmt(f), to: fmt(t) };
  },
};

function today(): string { return fmt(new Date()); }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); }
function fmt(d: Date): string { return d.toISOString().split('T')[0]; }

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseAnalyticsFiltersReturn {
  filters:       AnalyticsFilters;
  /** Query string to append to API requests */
  queryString:   string;
  setFilter:     (key: keyof AnalyticsFilters, value: string | number | undefined) => void;
  setPreset:     (preset: DatePreset) => void;
  setDateRange:  (from: string, to: string) => void;
  clearFilters:  () => void;
  hasActiveFilters: boolean;
  /** Debounced version of search (for API calls) */
  debouncedSearch?: string;
}

export function useAnalyticsFilters(debounceMs = 350): UseAnalyticsFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial state from URL
  const readFromUrl = useCallback((): AnalyticsFilters => ({
    from:       searchParams.get('from')       || undefined,
    to:         searchParams.get('to')         || undefined,
    preset:     (searchParams.get('preset') as DatePreset) || undefined,
    senderId:   searchParams.get('senderId')   || undefined,
    sequenceId: searchParams.get('sequenceId') || undefined,
    status:     searchParams.get('status')     || undefined,
    search:     searchParams.get('search')     || undefined,
    health:     searchParams.get('health')     || undefined,
    currentStep:searchParams.get('currentStep') ? parseInt(searchParams.get('currentStep')!, 10) : undefined,
    sortBy:     searchParams.get('sortBy')     || undefined,
    sortDir:    (searchParams.get('sortDir') as 'asc' | 'desc') || undefined,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [filters, setFilters] = useState<AnalyticsFilters>(readFromUrl);

  // Debounced search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(filters.search), debounceMs);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [filters.search, debounceMs]);

  // Sync filters → URL
  const syncToUrl = useCallback((f: AnalyticsFilters) => {
    const params: Record<string, string> = {};
    const keys: Array<keyof AnalyticsFilters> = ['from','to','preset','senderId','sequenceId','status','search','health','sortBy','sortDir'];
    keys.forEach(k => { const v = f[k]; if (v !== undefined && v !== '') params[k] = String(v); });
    if (f.currentStep !== undefined) params.currentStep = String(f.currentStep);
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const setFilter = useCallback((key: keyof AnalyticsFilters, value: string | number | undefined) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value === '' ? undefined : value };
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const setPreset = useCallback((preset: DatePreset) => {
    setFilters(prev => {
      const range = preset !== 'custom' ? PRESET_RANGES[preset]() : { from: prev.from, to: prev.to };
      const next: AnalyticsFilters = { ...prev, preset, from: range.from, to: range.to };
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const setDateRange = useCallback((from: string, to: string) => {
    setFilters(prev => {
      const next: AnalyticsFilters = { ...prev, from, to, preset: 'custom' };
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const clearFilters = useCallback(() => {
    const next: AnalyticsFilters = {};
    setFilters(next);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Build query string for API calls (use debouncedSearch for search param)
  const queryString = useMemo(() => {
    const parts: string[] = [];
    const f = { ...filters, search: debouncedSearch };
    if (f.from)       parts.push(`from=${f.from}`);
    if (f.to)         parts.push(`to=${f.to}`);
    if (f.senderId)   parts.push(`senderId=${f.senderId}`);
    if (f.sequenceId) parts.push(`sequenceId=${f.sequenceId}`);
    if (f.status)     parts.push(`status=${f.status}`);
    if (f.search)     parts.push(`search=${encodeURIComponent(f.search)}`);
    if (f.health)     parts.push(`health=${f.health}`);
    if (f.currentStep !== undefined) parts.push(`currentStep=${f.currentStep}`);
    if (f.sortBy)     parts.push(`sortBy=${f.sortBy}`);
    if (f.sortDir)    parts.push(`sortDir=${f.sortDir}`);
    return parts.join('&');
  }, [filters, debouncedSearch]);

  const hasActiveFilters = useMemo(() =>
    !!(filters.from || filters.to || filters.senderId || filters.sequenceId ||
       filters.status || filters.search || filters.health || filters.currentStep !== undefined),
  [filters]);

  return { filters, queryString, setFilter, setPreset, setDateRange, clearFilters, hasActiveFilters, debouncedSearch };
}
