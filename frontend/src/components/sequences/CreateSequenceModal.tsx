import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X, Zap, Calendar as CalendarIcon, Clock, Info,
  CheckCircle2, Globe, TrendingUp
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sequenceService } from '../../services/sequence.service';
import { calculateNextValidSlot, getLocalParts, type SendingWindow } from '@email-sequencing/shared';
import { useAuthStore } from '../../store/useAuthStore';
import { LoadingSpinner } from '../ui/LoadingSpinner';

// ─── Types ────────────────────────────────────────────────────────────────────

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const timeSchema = z.string().regex(/^([0-1]?[0-9]|2[0-3]):(00|30)$/);

const wizardSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Maximum 50 characters'),
  sending_preference: z.enum(['immediate', 'scheduled']),
  launch_date: z.string().min(1, 'Launch date is required'),
  timezone: z.string().min(1, 'Timezone is required'),
  start_time_str: timeSchema,
  end_time_str: timeSchema,
  custom_days: z.array(z.number()).min(1, 'Select at least one active day'),
  daily_sending_limit: z.coerce.number().min(1, 'Must be greater than 0'),
}).refine(data => {
  const [sh, sm] = data.start_time_str.split(':').map(Number);
  const [eh, em] = data.end_time_str.split(':').map(Number);
  return (sh * 60 + sm) < (eh * 60 + em);
}, {
  message: 'Start time must be before end time',
  path: ['start_time_str'],
});

type WizardData = z.infer<typeof wizardSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateSequenceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(h: number, m: number) {
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

const TIMEZONES = [
  { value: 'UTC', label: 'UTC (Universal)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Berlin', label: 'Central European (CET)' },
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST)' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Australia Eastern (AEST)' },
];

const timeOptions = Array.from({ length: 48 }).map((_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? 0 : 30;
  return {
    value: `${hour}:${minute.toString().padStart(2, '0')}`,
    label: formatTime(hour, minute),
  };
});

// ─── Modal ────────────────────────────────────────────────────────────────────

export const CreateSequenceModal: React.FC<CreateSequenceModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextSlot, setNextSlot] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);

  const getDefaultTimezone = () => {
    if (user && (user as any).timezone) return (user as any).timezone;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  };

  const {
    register, control, handleSubmit, watch, reset,
    formState: { errors },
  } = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: '',
      sending_preference: 'immediate',
      timezone: getDefaultTimezone(),
      start_time_str: '9:00',
      end_time_str: '17:00',
      custom_days: [1, 2, 3, 4, 5],
      daily_sending_limit: 200,
      launch_date: new Date().toISOString().split('T')[0],
    },
    mode: 'onTouched',
  });

  const nameValue = watch('name') || '';
  const sendingPreference = watch('sending_preference');
  const customDays = watch('custom_days') || [];
  const startTimeStr = watch('start_time_str') || '9:00';
  const endTimeStr = watch('end_time_str') || '17:00';
  const timezone = watch('timezone');
  const launchDate = watch('launch_date');
  const dailyLimit = watch('daily_sending_limit');

  // Compute next slot preview
  useEffect(() => {
    try {
      const [sH, sM] = startTimeStr.split(':').map(Number);
      const [eH, eM] = endTimeStr.split(':').map(Number);
      const window: SendingWindow = {
        timezone, schedule: 'custom', custom_days: customDays,
        start_hour: sH, start_minute: sM, end_hour: eH, end_minute: eM,
      };
      const nextDate = calculateNextValidSlot(new Date(), window);
      const parts = getLocalParts(nextDate, timezone);
      const nowParts = getLocalParts(new Date(), timezone);
      const isToday = parts.year === nowParts.year && parts.month === nowParts.month && parts.day === nowParts.day;
      const dateStr = isToday ? 'Today' : nextDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      setNextSlot(`${dateStr} · ${formatTime(parts.hour, parts.minute)}`);
    } catch {
      setNextSlot('');
    }
  }, [customDays, launchDate, timezone, startTimeStr, endTimeStr]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: WizardData) => {
    setIsSubmitting(true);
    try {
      const actualLaunchDate = data.sending_preference === 'immediate'
        ? new Date().toISOString()
        : new Date(data.launch_date).toISOString();
      const [start_hour, start_minute] = data.start_time_str.split(':').map(Number);
      const [end_hour, end_minute] = data.end_time_str.split(':').map(Number);

      const newSequence = await sequenceService.create({
        name: data.name,
        launch_date: actualLaunchDate,
        daily_sending_limit: data.daily_sending_limit,
        reserved_limit_phase1: 0,
        sending_window: {
          timezone: data.timezone,
          schedule: 'custom',
          custom_days: data.custom_days,
          start_hour, start_minute, end_hour, end_minute,
        },
        is_wizard: true,
      });

      toast.success('Sequence created!');
      handleClose();
      navigate(`/sequences/${newSequence._id}/builder-v2`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create sequence');
      setIsSubmitting(false);
    }
  };

  // Formatted summary values
  const [sH, sM] = startTimeStr.split(':').map(Number);
  const [eH, eM] = endTimeStr.split(':').map(Number);
  const activeDayNames = customDays.sort((a, b) => a - b).map(d => DAYS[d]).join(', ');
  const tzLabel = TIMEZONES.find(t => t.value === timezone)?.label ?? timezone;

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      {/* Modal */}
      <div
        className="bg-white rounded-2xl shadow-2xl w-full flex flex-col"
        style={{ maxWidth: 960, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-7 pt-6 pb-5 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Create New Sequence</h2>
            <p className="text-sm text-gray-500 mt-0.5">Configure your outreach schedule</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 px-7 py-6">
          <form id="create-seq-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-[1fr_260px] gap-6">

              {/* ─── Left Column ─────────────────────────────────── */}
              <div className="space-y-6">

                {/* 1. Name */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                    Sequence Name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="e.g. New Product Outreach"
                      className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${
                        errors.name
                          ? 'border-red-300 focus:ring-red-500'
                          : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-500'
                      }`}
                      {...register('name')}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                      {nameValue.length} / 50
                    </span>
                  </div>
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
                </div>

                {/* 2. Sending Preference */}
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">Sending Preference</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`relative flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sendingPreference === 'immediate'
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                      <input type="radio" value="immediate" className="sr-only" {...register('sending_preference')} />
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        sendingPreference === 'immediate' ? 'bg-indigo-100' : 'bg-gray-100'
                      }`}>
                        <Zap className={`w-4.5 h-4.5 ${sendingPreference === 'immediate' ? 'text-indigo-600' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">Send Immediately</span>
                          <span className="text-[10px] font-bold tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full uppercase">Recommended</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 leading-snug">Starts in next available slot</p>
                      </div>
                      {sendingPreference === 'immediate' && (
                        <CheckCircle2 className="w-4 h-4 text-indigo-500 absolute top-3 right-3" />
                      )}
                    </label>

                    <label className={`relative flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sendingPreference === 'scheduled'
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                      <input type="radio" value="scheduled" className="sr-only" {...register('sending_preference')} />
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        sendingPreference === 'scheduled' ? 'bg-indigo-100' : 'bg-gray-100'
                      }`}>
                        <CalendarIcon className={`w-4.5 h-4.5 ${sendingPreference === 'scheduled' ? 'text-indigo-600' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-gray-900">Schedule Later</span>
                        <p className="text-xs text-gray-500 mt-0.5 leading-snug">Choose a future start date</p>
                      </div>
                      {sendingPreference === 'scheduled' && (
                        <CheckCircle2 className="w-4 h-4 text-indigo-500 absolute top-3 right-3" />
                      )}
                    </label>
                  </div>

                  {/* Next slot chip */}
                  {sendingPreference === 'immediate' && nextSlot && (
                    <div className="mt-2.5 flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-medium">Next slot:</span>
                      <span>{nextSlot}</span>
                    </div>
                  )}

                  {/* Scheduled: date picker */}
                  {sendingPreference === 'scheduled' && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Start Date</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        {...register('launch_date')}
                      />
                      {errors.launch_date && <p className="text-xs text-red-500 mt-1">{errors.launch_date.message}</p>}
                    </div>
                  )}
                </div>

                {/* 3. Active Days */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-800">Active Days</p>
                    <span className="text-xs text-gray-500">{customDays.length} day{customDays.length !== 1 ? 's' : ''} selected</span>
                  </div>
                  <Controller
                    name="custom_days"
                    control={control}
                    render={({ field }) => (
                      <div className="flex gap-2">
                        {DAYS.map((day, idx) => {
                          const isSelected = field.value.includes(idx);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                const next = isSelected
                                  ? field.value.filter(d => d !== idx)
                                  : [...field.value, idx].sort();
                                field.onChange(next);
                              }}
                              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                  {errors.custom_days && <p className="text-xs text-red-500 mt-1">{errors.custom_days.message}</p>}
                </div>

                {/* 4. Schedule Settings (Timezone + Window) */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      <Globe className="w-3 h-3 inline mr-1 opacity-60" />
                      Timezone
                    </label>
                    <div className="relative">
                      <select
                        {...register('timezone')}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-white"
                      >
                        {TIMEZONES.map(tz => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      <Clock className="w-3 h-3 inline mr-1 opacity-60" />
                      Start Time
                    </label>
                    <div className="relative">
                      <select
                        {...register('start_time_str')}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-white"
                      >
                        {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </div>
                    {errors.start_time_str && <p className="text-xs text-red-500 mt-1">{errors.start_time_str.message}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      <Clock className="w-3 h-3 inline mr-1 opacity-60" />
                      End Time
                    </label>
                    <div className="relative">
                      <select
                        {...register('end_time_str')}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-white"
                      >
                        {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </div>
                    {errors.end_time_str && <p className="text-xs text-red-500 mt-1">{errors.end_time_str.message}</p>}
                  </div>
                </div>

                {/* 5. Daily Cap */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 inline mr-1 opacity-60" />
                    Daily Execution Cap
                  </label>
                  <p className="text-xs text-gray-500 mb-2">Maximum emails sent per day across this sequence.</p>
                  <input
                    type="number"
                    min={1}
                    className={`w-48 px-4 py-2.5 border rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 transition-all ${
                      errors.daily_sending_limit ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-indigo-500'
                    }`}
                    {...register('daily_sending_limit')}
                  />
                  {errors.daily_sending_limit && <p className="text-xs text-red-500 mt-1">{errors.daily_sending_limit.message}</p>}
                </div>
              </div>

              {/* ─── Right Column: Live Summary ───────────────────── */}
              <div className="shrink-0">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 sticky top-0">
                  <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-500" />
                    Sequence Summary
                  </h3>

                  <div className="space-y-3.5">
                    <SummaryItem label="Mode">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        sendingPreference === 'immediate' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {sendingPreference === 'immediate' ? '⚡ Send Immediately' : '📅 Scheduled'}
                      </span>
                    </SummaryItem>

                    <SummaryItem label="Active Days">
                      <span className="text-xs text-gray-900 font-medium">
                        {activeDayNames || <span className="text-gray-400 italic">None selected</span>}
                      </span>
                    </SummaryItem>

                    <SummaryItem label="Timezone">
                      <span className="text-xs text-gray-900">{tzLabel}</span>
                    </SummaryItem>

                    <SummaryItem label="Sending Window">
                      <span className="text-xs text-gray-900 font-medium">
                        {formatTime(sH || 0, sM || 0)} – {formatTime(eH || 0, eM || 0)}
                      </span>
                    </SummaryItem>

                    <SummaryItem label="Daily Cap">
                      <span className="text-xs text-gray-900 font-medium">{dailyLimit || 200} emails/day</span>
                    </SummaryItem>

                    {nextSlot && sendingPreference === 'immediate' && (
                      <div className="pt-3 border-t border-gray-200">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">First Send</p>
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="text-xs text-gray-700 font-medium">{nextSlot}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-7 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="create-seq-form"
            disabled={isSubmitting}
            className="flex items-center gap-2.5 px-7 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-600/25 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ minWidth: 180, height: 44 }}
          >
            {isSubmitting ? (
              <>
                <LoadingSpinner size={16} />
                Creating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Create Sequence
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Small helper ─────────────────────────────────────────────────────────────

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      {children}
    </div>
  );
}
