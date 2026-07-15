/**
 * AnalyticsFilterBar.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6/7: Reusable enterprise filter bar.
 * Supports: Date presets, custom range, status, health, search, clear all.
 * Fully controlled — call onApply() only when the user explicitly applies.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { memo, useRef, useEffect, useState } from 'react';
import { Calendar, ChevronDown, X, Search, Filter, SlidersHorizontal } from 'lucide-react';
import type { AnalyticsFilters, DatePreset } from '../../hooks/useAnalyticsFilters';

// ─── Preset labels ────────────────────────────────────────────────────────────

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7',     label: 'Last 7 Days' },
  { value: 'last30',    label: 'Last 30 Days' },
  { value: 'last90',    label: 'Last 90 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom',    label: 'Custom Range' },
];

const STATUS_OPTIONS = [
  { value: '',          label: 'All Statuses' },
  { value: 'active',    label: 'Active' },
  { value: 'paused',    label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'draft',     label: 'Draft' },
  { value: 'archived',  label: 'Archived' },
];

const HEALTH_OPTIONS = [
  { value: '',          label: 'All Health' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'healthy',   label: 'Healthy' },
  { value: 'warning',   label: 'Warning' },
  { value: 'stalled',   label: 'Stalled' },
];

// ─── Popover utility ──────────────────────────────────────────────────────────

function useOutsideClick(ref: React.RefObject<HTMLElement>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, cb]);
}

// ─── DatePresetPicker ─────────────────────────────────────────────────────────

interface DatePresetPickerProps {
  preset?: DatePreset;
  from?: string; to?: string;
  onPreset: (p: DatePreset) => void;
  onCustomRange: (from: string, to: string) => void;
}

const DatePresetPicker = memo(function DatePresetPicker({ preset, from, to, onPreset, onCustomRange }: DatePresetPickerProps) {
  const [open, setOpen] = useState(false);
  const [localFrom, setLocalFrom] = useState(from ?? '');
  const [localTo,   setLocalTo]   = useState(to   ?? '');
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref as React.RefObject<HTMLElement>, () => setOpen(false));

  const label = preset && preset !== 'custom'
    ? PRESETS.find(p => p.value === preset)?.label
    : (from && to ? `${from} → ${to}` : 'Date Range');

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(p => !p)}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all shadow-sm">
        <Calendar className="h-3.5 w-3.5 text-gray-500" />
        <span className="text-gray-700 font-medium max-w-[140px] truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white rounded-2xl border border-gray-100 shadow-xl p-2">
          {/* Presets */}
          <div className="grid grid-cols-2 gap-1 p-2 border-b border-gray-50 mb-2">
            {PRESETS.filter(p => p.value !== 'custom').map(p => (
              <button key={p.value}
                onClick={() => { onPreset(p.value); setOpen(false); }}
                className={`px-3 py-2 text-xs rounded-lg text-left font-medium transition-colors ${
                  preset === p.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom range */}
          <div className="px-2 pb-2 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Custom Range</p>
            <div className="flex gap-2">
              <input type="date" value={localFrom} onChange={e => setLocalFrom(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input type="date" value={localTo} onChange={e => setLocalTo(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <button
              onClick={() => { if (localFrom && localTo) { onCustomRange(localFrom, localTo); setOpen(false); } }}
              disabled={!localFrom || !localTo}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40">
              Apply Custom Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── SelectFilter ─────────────────────────────────────────────────────────────

const SelectFilter = memo(function SelectFilter({
  value, options, onChange, icon: Icon, placeholder,
}: {
  value?: string;
  options: { value: string; label: string }[];
  onChange: (v: string | undefined) => void;
  icon?: React.ElementType;
  placeholder: string;
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />}
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
        className={`appearance-none px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white hover:border-indigo-300 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-medium text-gray-700 ${Icon ? 'pl-8' : ''} pr-8`}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
    </div>
  );
});

// ─── SearchInput ──────────────────────────────────────────────────────────────

const SearchInput = memo(function SearchInput({
  value, onChange, placeholder = 'Search…',
}: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        className="pl-8 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm w-52 font-medium text-gray-700 placeholder:font-normal placeholder:text-gray-400"
      />
    </div>
  );
});

// ─── AnalyticsFilterBar (main export) ────────────────────────────────────────

export interface AnalyticsFilterBarProps {
  filters:         AnalyticsFilters;
  hasActiveFilters:boolean;
  onPreset:        (p: DatePreset) => void;
  onDateRange:     (from: string, to: string) => void;
  onFilter:        (key: keyof AnalyticsFilters, value: string | undefined) => void;
  onClear:         () => void;
  /** Which filter controls to show */
  show?: {
    dateRange?:  boolean;
    status?:     boolean;
    health?:     boolean;
    search?:     boolean;
  };
  searchPlaceholder?: string;
  className?: string;
}

export const AnalyticsFilterBar = memo(function AnalyticsFilterBar({
  filters, hasActiveFilters,
  onPreset, onDateRange, onFilter, onClear,
  show = { dateRange: true },
  searchPlaceholder,
  className = '',
}: AnalyticsFilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-2xl bg-white border border-gray-100 shadow-sm p-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Toggle */}
        <button
          onClick={() => setExpanded(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-all shadow-sm font-medium ${
            hasActiveFilters
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
          }`}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="ml-0.5 h-4 w-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
              {[filters.from, filters.status, filters.health, filters.search].filter(Boolean).length}
            </span>
          )}
        </button>

        {expanded && (
          <>
            {show.dateRange !== false && (
              <DatePresetPicker
                preset={filters.preset}
                from={filters.from}
                to={filters.to}
                onPreset={onPreset}
                onCustomRange={onDateRange}
              />
            )}

            {show.status !== false && (
              <SelectFilter
                value={filters.status}
                options={STATUS_OPTIONS}
                onChange={v => onFilter('status', v)}
                placeholder="Status"
              />
            )}

            {show.health && (
              <SelectFilter
                value={filters.health}
                options={HEALTH_OPTIONS}
                onChange={v => onFilter('health', v)}
                placeholder="Health"
                icon={Filter}
              />
            )}

            {show.search !== false && (
              <SearchInput
                value={filters.search}
                onChange={v => onFilter('search', v)}
                placeholder={searchPlaceholder}
              />
            )}
          </>
        )}

        {/* Active filter chips */}
        {!expanded && hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.from && filters.to && (
              <Chip label={`${filters.from} → ${filters.to}`} onRemove={() => { onFilter('from', undefined); onFilter('to', undefined); }} />
            )}
            {filters.status && <Chip label={filters.status} onRemove={() => onFilter('status', undefined)} />}
            {filters.health && <Chip label={filters.health} onRemove={() => onFilter('health', undefined)} />}
            {filters.search && <Chip label={`"${filters.search}"`} onRemove={() => onFilter('search', undefined)} />}
          </div>
        )}

        {/* Clear all */}
        {hasActiveFilters && (
          <button onClick={onClear}
            className="ml-auto flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
            <X className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Chip ─────────────────────────────────────────────────────────────────────

const Chip = memo(function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100">
      {label}
      <button onClick={onRemove} className="hover:text-indigo-900 transition-colors"><X className="h-3 w-3" /></button>
    </span>
  );
});
