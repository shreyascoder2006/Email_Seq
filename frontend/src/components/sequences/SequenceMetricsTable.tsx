import React from 'react';
import { format } from 'date-fns';
import { Rocket, BarChart2, MoreHorizontal } from 'lucide-react';
import type { Sequence } from '../../types';
import { SequenceStateToggle } from './SequenceStateToggle';
import { SequenceRowActionsMenu } from './SequenceRowActionsMenu';
import { toast } from 'react-hot-toast';

// ─── Metric Mapping Helper ────────────────────────────────────────────────────
export const mapSequenceToDashboardRow = (seq: Sequence) => {
  const sent = seq.stats?.total_sent || 0;

  const calcRate = (part: number) => {
    const count = part || 0;
    const pct = sent > 0 ? Math.round((count / sent) * 100) : 0;
    return { count, label: `${count} (${pct}%)` };
  };

  return {
    _id: seq._id,
    name: seq.name,
    step_count: seq.step_count || 0,
    status: seq.status,
    isActiveToggle: seq.status === 'active',
    active_contacts: seq.stats?.active_contacts ?? 0,
    paused_contacts: seq.stats?.paused_contacts ?? 0,
    completed_phases: 0,      // Fallback — no backend field yet
    sent,
    calendar_schedule: (() => {
      try { return seq.launch_date ? format(new Date(seq.launch_date), 'MMM d, yyyy') : '—'; }
      catch { return '—'; }
    })(),
    read:        calcRate(seq.stats?.total_opens   ?? 0),
    clicked:     calcRate(seq.stats?.total_clicks  ?? 0),
    replied:     calcRate(seq.stats?.total_replies ?? 0),
    hard_bounce: calcRate(seq.stats?.total_bounces ?? 0),
    soft_bounce: { count: 0, label: '0 (0%)' }, // Fallback — no backend field yet
    raw: seq,
  };
};

// ─── Props ───────────────────────────────────────────────────────────────────
interface SequenceMetricsTableProps {
  sequences: Sequence[];
  selectedIds: string[];
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdateStatus: (id: string, status: Sequence['status']) => void;
  onDelete: (id: string) => void;
}

// ─── Shared cell styles ───────────────────────────────────────────────────────
const TH = "py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none leading-snug";
const TD = "py-2.5 whitespace-nowrap";

export const SequenceMetricsTable: React.FC<SequenceMetricsTableProps> = ({
  sequences, selectedIds, onSelectAll, onSelectRow, onView, onEdit, onUpdateStatus, onDelete,
}) => {
  const rows = sequences.map(mapSequenceToDashboardRow);
  const allSelected = sequences.length > 0 && selectedIds.length === sequences.length;

  const handleClone    = () => toast('Clone feature coming soon!',    { icon: '🚀' });
  const handleAnalytics = (_id: string) => toast('Analytics view coming soon!', { icon: '📊' });

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* overflow-x-auto only as safety net on very small screens */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>

          {/* Column widths — total ≈ 1200px (fits 1440px screen minus 192px sidebar minus padding) */}
          <colgroup>
            <col style={{ width: '36px'  }} />  {/* checkbox */}
            <col style={{ width: '200px' }} />  {/* sequence name */}
            <col style={{ width: '84px'  }} />  {/* campaign state */}
            <col style={{ width: '54px'  }} />  {/* active */}
            <col style={{ width: '54px'  }} />  {/* paused */}
            <col style={{ width: '88px'  }} />  {/* completed */}
            <col style={{ width: '48px'  }} />  {/* sent */}
            <col style={{ width: '100px' }} />  {/* schedule */}
            <col style={{ width: '60px'  }} />  {/* read */}
            <col style={{ width: '80px'  }} />  {/* clicked */}
            <col style={{ width: '70px'  }} />  {/* replied */}
            <col style={{ width: '80px'  }} />  {/* hard bounce */}
            <col style={{ width: '80px'  }} />  {/* soft bounce */}
            <col style={{ width: '70px'  }} />  {/* analytics */}
            <col style={{ width: '64px'  }} />  {/* actions */}
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
              <th className={`${TH} px-2 text-center`}>Campaign<br/>State</th>
              <th className={`${TH} px-2 text-right`}>Active</th>
              <th className={`${TH} px-2 text-right`}>Paused</th>
              <th className={`${TH} px-2 text-right`}>All Phases<br/>Completed</th>
              <th className={`${TH} px-2 text-right`}>Sent</th>
              <th className={`${TH} px-2 text-left whitespace-nowrap`}>Calendar Schedule</th>
              <th className={`${TH} px-2 text-right`}>Read</th>
              <th className={`${TH} px-2 text-right`}>Link<br/>Clicked</th>
              <th className={`${TH} px-2 text-right`}>Replied</th>
              <th className={`${TH} px-2 text-right`}>Hard<br/>Bounce</th>
              <th className={`${TH} px-2 text-right`}>Soft<br/>Bounce</th>
              <th className={`${TH} px-2 text-center`}>Analytics</th>
              <th className={`${TH} px-2 text-center`}>Actions</th>
            </tr>
          </thead>

          {/* ── Body ──────────────────────────────────────────────────────── */}
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => {
              const isSelected = selectedIds.includes(row._id);
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

                  {/* Sequence */}
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
                          {row.step_count} Steps
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Campaign State */}
                  <td className={`${TD} px-2 text-center`}>
                    <SequenceStateToggle
                      isActive={row.isActiveToggle}
                      onToggle={(isActive) => onUpdateStatus(row._id, isActive ? 'active' : 'paused')}
                      disabled={row.status === 'completed' || row.status === 'archived'}
                    />
                  </td>

                  {/* Active */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-emerald-500">{row.active_contacts}</span>
                  </td>

                  {/* Paused */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-orange-400">{row.paused_contacts}</span>
                  </td>

                  {/* Completed */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-bold text-violet-500">{row.completed_phases}</span>
                  </td>

                  {/* Sent */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12.5px] font-semibold text-gray-800">{row.sent}</span>
                  </td>

                  {/* Schedule */}
                  <td className={`${TD} px-2 text-left`}>
                    <span className="text-[11.5px] font-semibold text-blue-500">{row.calendar_schedule}</span>
                  </td>

                  {/* Read */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12px] font-semibold text-indigo-600">{row.read.label}</span>
                  </td>

                  {/* Clicked */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12px] font-semibold text-emerald-600">{row.clicked.label}</span>
                  </td>

                  {/* Replied */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12px] font-semibold text-sky-600">{row.replied.label}</span>
                  </td>

                  {/* Hard Bounce */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12px] font-semibold text-red-500">{row.hard_bounce.label}</span>
                  </td>

                  {/* Soft Bounce */}
                  <td className={`${TD} px-2 text-right`}>
                    <span className="text-[12px] font-semibold text-orange-500">{row.soft_bounce.label}</span>
                  </td>

                  {/* Analytics */}
                  <td className={`${TD} px-2 text-center`}>
                    <button
                      onClick={() => handleAnalytics(row._id)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title="View Analytics"
                    >
                      <BarChart2 className="w-[15px] h-[15px]" />
                    </button>
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
