import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X, Zap, Calendar as CalendarIcon, Clock, Globe, ArrowRight,
  ChevronUp, ChevronDown, Info, Send
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sequenceService } from '../../services/sequence.service';
import { calculateNextValidSlot, getLocalParts, type SendingWindow } from '@email-sequencing/shared';
import { useAuthStore } from '../../store/useAuthStore';
import { LoadingSpinner } from '../ui/LoadingSpinner';

// ─── Constants ────────────────────────────────────────────────────────────────

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

interface CreateSequenceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

// ─── Reusable Field Label ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-bold text-gray-900 mb-3">{children}</p>;
}

// ─── Dropdown Select ──────────────────────────────────────────────────────────

function SelectField({ icon: Icon, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { icon?: React.FC<any> }) {
  return (
    <div className="relative">
      {Icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
          <Icon className="w-4 h-4" />
        </div>
      )}
      <select
        {...props}
        className={`w-full ${Icon ? 'pl-9' : 'pl-3.5'} pr-9 py-2.5 border border-gray-200 rounded-xl text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-white cursor-pointer`}
      >
        {children}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
        <ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}

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

  const nameValue         = watch('name') || '';
  const sendingPreference = watch('sending_preference');
  const customDays        = watch('custom_days') || [];
  const startTimeStr      = watch('start_time_str') || '9:00';
  const endTimeStr        = watch('end_time_str') || '17:00';
  const timezone          = watch('timezone');
  const launchDate        = watch('launch_date');
  const dailyLimit        = watch('daily_sending_limit');

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
      setNextSlot(`${dateStr} • ${formatTime(parts.hour, parts.minute)} – ${formatTime(eH, eM)} IST`);
    } catch {
      setNextSlot('');
    }
  }, [customDays, launchDate, timezone, startTimeStr, endTimeStr]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const handleClose = () => { reset(); onClose(); };

  const onSubmit = async (data: WizardData) => {
    setIsSubmitting(true);
    try {
      const actualLaunchDate = data.sending_preference === 'immediate'
        ? new Date().toISOString()
        : new Date(data.launch_date).toISOString();
      const [start_hour, start_minute] = data.start_time_str.split(':').map(Number);
      const [end_hour, end_minute]     = data.end_time_str.split(':').map(Number);

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

  if (!isOpen) return null;

  const tzLabel = TIMEZONES.find(t => t.value === timezone)?.label?.match(/\(([^)]+)\)/)?.[1] ?? '';

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      {/* Modal shell */}
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 580, maxHeight: '94vh' }}
        onClick={(e) => e.stopPropagation()}
      >

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <div>
              <h2 className="text-[18px] font-bold text-gray-900 leading-tight">New Sequence Setup</h2>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 px-6 py-5">
            <form id="create-seq-form" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-6">

                {/* 1. Sequence Title */}
                <div>
                  <SectionLabel>Sequence Title</SectionLabel>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </div>
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="Type sequence title here..."
                      className={`w-full pl-10 pr-16 py-2.5 border rounded-xl text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${
                        errors.name ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500 focus:border-indigo-400'
                      }`}
                      {...register('name')}
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 pointer-events-none">
                      {nameValue.length} / 50 characters
                    </span>
                  </div>
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
                </div>

                {/* 2. Sending Preference */}
                <div>
                  <SectionLabel>Sending Preference</SectionLabel>
                  <div className="grid grid-cols-2 gap-3">

                    {/* Send immediately */}
                    <label className={`relative flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sendingPreference === 'immediate'
                        ? 'border-[#5B4CFF] bg-[#F7F6FF]'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                      <input type="radio" value="immediate" className="sr-only" {...register('sending_preference')} />
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        sendingPreference === 'immediate' ? 'bg-[#EDE9FF]' : 'bg-gray-100'
                      }`}>
                        <Zap className={`w-4 h-4 ${sendingPreference === 'immediate' ? 'text-[#5B4CFF]' : 'text-gray-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-bold text-gray-900">Send immediately</span>
                          <span className="text-[10px] font-bold tracking-wide text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Recommended</span>
                        </div>
                        <p className="text-[11.5px] text-gray-500 mt-1 leading-snug">We'll send your emails in the next available time slot based on your sending window.</p>
                      </div>
                    </label>

                    {/* Schedule later */}
                    <label className={`relative flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sendingPreference === 'scheduled'
                        ? 'border-[#5B4CFF] bg-[#F7F6FF]'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                      <input type="radio" value="scheduled" className="sr-only" {...register('sending_preference')} />
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        sendingPreference === 'scheduled' ? 'bg-[#EDE9FF]' : 'bg-gray-100'
                      }`}>
                        <CalendarIcon className={`w-4 h-4 ${sendingPreference === 'scheduled' ? 'text-[#5B4CFF]' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <span className="text-[13px] font-bold text-gray-900">Schedule later according to calendar</span>
                        <p className="text-[11.5px] text-gray-500 mt-1 leading-snug">We'll follow your selected days and time window strictly.</p>
                      </div>
                    </label>
                  </div>

                  {/* Next Available Slot */}
                  {nextSlot && (
                    <div className="mt-3 flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-xl">
                      <div className="flex items-center gap-2 text-[12.5px] text-gray-700 font-medium">
                        <Info className="w-3.5 h-3.5 text-gray-400" />
                        <span className="font-semibold text-gray-700">Next Available Slot</span>
                        <span className="flex items-center gap-1.5 text-emerald-600 font-bold ml-1">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
                          {nextSlot}
                        </span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                    </div>
                  )}

                  {/* Scheduled date picker */}
                  {sendingPreference === 'scheduled' && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Start Date</label>
                      <input
                        type="date"
                        className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        {...register('launch_date')}
                      />
                      {errors.launch_date && <p className="text-xs text-red-500 mt-1">{errors.launch_date.message}</p>}
                    </div>
                  )}
                </div>

                {/* 3. Active Days */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <SectionLabel>Active Days</SectionLabel>
                    <span className="text-[12px] text-emerald-600 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
                      {customDays.length} day(s) selected
                    </span>
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
                              className={`flex-1 py-2.5 rounded-xl text-[11px] font-extrabold tracking-wider transition-all border ${
                                isSelected
                                  ? 'bg-[#5B4CFF] text-white border-[#5B4CFF] shadow-sm'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
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

                {/* 4. Start Date + Timezone row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-bold text-gray-900 mb-2">Start Date</label>
                    <SelectField icon={CalendarIcon} {...register('launch_date')}>
                      <option value={new Date().toISOString().split('T')[0]}>
                        {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} ({tzLabel || 'Local'})
                      </option>
                    </SelectField>
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-gray-900 mb-2">Timezone</label>
                    <SelectField icon={Globe} {...register('timezone')}>
                      {TIMEZONES.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </SelectField>
                  </div>
                </div>

                {/* 5. Time window row */}
                <div>
                  <div className="grid grid-cols-[1fr_24px_1fr] items-end gap-2">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-900 mb-2">Sequence Start Time</label>
                      <SelectField icon={Clock} {...register('start_time_str')}>
                        {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </SelectField>
                    </div>
                    <div className="flex items-center justify-center pb-2.5">
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-gray-900 mb-2">Sequence End Time</label>
                      <SelectField icon={Clock} {...register('end_time_str')}>
                        {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </SelectField>
                    </div>
                  </div>
                  {errors.start_time_str && <p className="text-xs text-red-500 mt-1">{errors.start_time_str.message}</p>}

                  {/* Info banner */}
                  <div className="mt-3 flex items-center gap-2.5 px-4 py-2.5 bg-white border border-[#5B4CFF]/30 rounded-xl">
                    <Info className="w-4 h-4 text-[#5B4CFF] shrink-0" />
                    <p className="text-[12px] text-[#5B4CFF] font-medium leading-snug">
                      Emails will be sent randomly within this window to ensure natural delivery and better deliverability.
                    </p>
                  </div>
                </div>

                {/* 6. Daily Execution Cap */}
                <div>
                  <SectionLabel>Daily Execution Cap</SectionLabel>
                  <p className="text-[12px] text-gray-500 -mt-2 mb-3">Set the maximum number of emails to send per day across all steps</p>
                  <div className="relative w-full">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    </div>
                    <input
                      type="number"
                      min={1}
                      placeholder="Enter maximum executions per day"
                      className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${
                        errors.daily_sending_limit ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500'
                      }`}
                      {...register('daily_sending_limit')}
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                      <button type="button" className="text-gray-300 hover:text-gray-600 transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" className="text-gray-300 hover:text-gray-600 transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {errors.daily_sending_limit && <p className="text-xs text-red-500 mt-1">{errors.daily_sending_limit.message}</p>}
                </div>

              </div>
            </form>
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-red-200 text-red-500 text-[13px] font-semibold hover:bg-red-50 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Clear All
              </button>

              <button
                type="submit"
                form="create-seq-form"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#5B4CFF] text-white text-[13px] font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-600/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <><LoadingSpinner size={15} /> Creating...</>
                ) : (
                  <><Send className="w-4 h-4" /> Create Sequence</>
                )}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
};
