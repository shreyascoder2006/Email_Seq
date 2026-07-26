import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Rocket } from 'lucide-react';
import type { Sequence } from '../../types';
import { SequenceStateToggle } from './SequenceStateToggle';
import { SequenceRowActionsMenu } from './SequenceRowActionsMenu';
import { toast } from 'react-hot-toast';

// ─── State display helper ──────────────────────────────────────────────────────
function getStateDisplay(status: Sequence['status']): { label: string; colorClass: string } {
  switch (status) {
    case 'active':    return { label: 'ON',       colorClass: 'text-emerald-500' };
    case 'paused':    return { label: 'PAUSED',   colorClass: 'text-orange-400'  };
    case 'draft':     return { label: 'DRAFT',    colorClass: 'text-gray-400'    };
    case 'completed': return { label: 'DONE',     colorClass: 'text-blue-500'    };
    case 'archived':  return { label: 'ARCHIVED', colorClass: 'text-gray-400'    };
    default:          return { label: (status as string).toUpperCase(), colorClass: 'text-gray-400' };
  }
}

// ─── Last-activity formatter ──────────────────────────────────────────────────
function formatLastActivity(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return formatDistanceToNow(new Date(isoString), { addSuffix: true });
  } catch {
    return '—';
  }
}

// ─── Compact schedule formatter ───────────────────────────────────────────────
function formatSchedule(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(new Date(isoString), 'MMM d');
  } catch {
    return '—';
  }
}

// ─── Metric Mapping Helper ────────────────────────────────────────────────────
export const mapSequenceToDashboardRow = (seq: Sequence) => ({
  _id:              seq._id,
  name:             seq.name,
  step_count:       seq.step_count || 0,
  status:           seq.status,
  active_contacts:  seq.stats?.active_contacts  ?? 0,
  paused_contacts:  seq.stats?.paused_contacts  ?? 0,
  total_contacts:   seq.stats?.total_contacts   ?? 0,
  completed:        seq.stats?.completed        ?? 0,
  sent:             seq.stats?.total_sent       ?? 0,
  pending_count:    seq.pending_count           ?? 0,
  schedule:         formatSchedule(seq.launch_date),
  last_activity:    formatLastActivity(seq.last_activity_at),
  raw:              seq,
});

// ─── Props ────────────────────────────────────────────────────────────────────
interface SequenceMetricsTableProps {
  sequences:       Sequence[];
  selectedIds:     string[];
  onSelectAll:     (checked: boolean) => void;
  onSelectRow:     (id: string, checked: boolean) => void;
  onView:          (id: string) => void;
  onEdit:          (id: string) => void;
  onUpdateStatus:  (id: string, status: Sequence['status']) => void;
  onDelete:        (id: string) => void;
}

// ─── Shared cell styles ───────────────────────────────────────────────────────
const TH = 'py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none leading-snug';
const TD = 'py-2.5 whitespace-nowrap';

export const SequenceMetricsTable: React.FC<SequenceMetricsTableProps> = ({
  sequences, selectedIds, onSelectAll, onSelectRow, onView, onEdit, onUpdateStatus, onDelete,
}) => {
  const rows       = sequences.map(mapSequenceToDashboardRow);
  const allSelected = sequences.length > 0 && selectedIds.length === sequences.length;

  const handleClone = () => toast('Clone feature coming soon!', { icon: '🚀' });

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>

          {/*
            12 columns total (checkbox + 10 data + actions).
            Widths sum to ~1020px — comfortable inside a 1440px layout with a 192px sidebar.
            Sequence col gets extra width since 6 analytics cols were removed.
          */}
          <colgroup>
            <col style={{ width: '36px'  }} />{/* checkbox      */}
            <col style={{ width: '220px' }} />{/* Sequence       */}
            <col style={{ width: '90px'  }} />{/* State          */}
            <col style={{ width: '58px'  }} />{/* Active         */}
            <col style={{ width: '58px'  }} />{/* Paused         */}
            <col style={{ width: '68px'  }} />{/* Contacts       */}
            <col style={{ width: '72px'  }} />{/* Completed      */}
            <col style={{ width: '52px'  }} />{/* Sent           */}
            <col style={{ width: '64px'  }} />{/* Pending        */}
            <col style={{ width: '62px'  }} />{/* Schedule       */}
            <col style={{ width: '96px'  }} />{/* Last Activity  */}
            <col style={{ width: '60px'  }} />{/* Actions        */}
          </colgroup>

          {/* ── Header ────────────────────────────────────────────────────── */}
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80">

              {/* Checkbox */}
              <th className={`${TH} px-3 text-center`}>
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                  checked={allSelected}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
              </th>

              <th className={`${TH} px-3 text-left`}>Sequence</th>
              <th className={`${TH} px-2 text-center`}>State</th>
              <th className={`${TH} px-2 text-right`}>Active</th>
              <th className={`${TH} px-2 text-right`}>Paused</th>
              <th className={`${TH} px-2 text-right`}>Contacts</th>
              <th className={`${TH} px-2 text-right`}>Completed</th>
              <th className={`${TH} px-2 text-right`}>Sent</th>
              <th className={`${TH} px-2 text-right`}>Pending</th>
              <th className={`${TH} px-2 text-left`}>Schedule</th>
              <th className={`${TH} px-2 text-left`}>Last Activity</th>
              <th className={`${TH} px-2 text-center`}>Actions</th>
            </tr>
          </thead>

          {/* ── Body ──────────────────────────────────────────────────────── */}
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => {
              const isSelected   = selectedIds.includes(row._id);
              const stateDisplay = getStateDisplay(row.status);
              const canToggle    = row.status === 'active' || row.status === 'paused';

              return (
                <tr
                  key={row._id}
                  className={`group transition-colors duration-75 ${
                    isSelected ? 'bg-indigo-50/50' : 'hover:bg-gray-50/70'
                  }`}
                >
                  {/* Checkbox */}
                  <td className={`${TD} px-3 text-center`}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      checked={isSelected}
                      onChange={(e) => onSelectRow(row._id, e.target.checked)}
                    />
                  </td>

                  {/* Sequence name + step count */}
                  <td className={`${TD} px-3`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                        <Rocket className="w-3.5 h-3.5 text-indigo-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-[12.5px] font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors cursor-pointer truncate leading-tight"
                          onClick={() => onView(row._id)}
                          title={row.name}
                        >
                          {row.name}
                        </p>
                        <p className="text-[10.5px] text-gray-400 mt-0.5 leading-none">
                          {row.step_count} {row.step_count === 1 ? 'Step' : 'Steps'}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* State — dot label + toggle */}
                  <td className={`${TD} px-2`}>
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-[10px] font-bold tracking-wide ${stateDisplay.colorClass}`}>
                        ● {stateDisplay.label}
                      </span>
                      {canToggle && (
                        <SequenceStateToggle
                          isActive={row.status === 'active'}
                          onToggle={(isActive) =>
                            onUpdateStatus(row._id, isActive ? 'active' : 'paused')
                          }
                          disabled={false}
                        />
                      )}
                    </div>
                  </td>

                  {/* Active */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-emerald-500">{row.active_contacts}</span>
                  </td>

                  {/* Paused */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-orange-400">{row.paused_contacts}</span>
                  </td>

                  {/* Contacts */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-semibold text-gray-700">{row.total_contacts}</span>
                  </td>

                  {/* Completed */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-violet-500">{row.completed}</span>
                  </td>

                  {/* Sent */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-semibold text-gray-800">{row.sent}</span>
                  </td>

                  {/* Pending */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-semibold text-amber-500">{row.pending_count}</span>
                  </td>

                  {/* Schedule */}
                  <td className={`${TD} px-2 text-left`}>
                    <span className="text-[11.5px] font-semibold text-blue-500">{row.schedule}</span>
                  </td>

                  {/* Last Activity */}
                  <td className={`${TD} px-2 text-left`}>
                    <span className="text-[11px] text-gray-500 truncate block max-w-[90px]" title={row.last_activity}>
                      {row.last_activity}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className={`${TD} px-2 text-center`}>
                    <SequenceRowActionsMenu
                      sequence={row.raw}
                      onView={onView}
                      onEdit={onEdit}
                      onUpdateStatus={onUpdateStatus}
                      onClone={handleClone}
                      onDelete={onDelete}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
