import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X, Zap, Calendar as CalendarIcon, Clock, Globe, ArrowRight,
  ChevronUp, ChevronDown, Info, Send, CheckCircle2
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sequenceService } from '../../services/sequence.service';
import { useAuthStore } from '../../store/useAuthStore';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { DateTime } from 'luxon';

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
  return ((eh * 60 + em) - (sh * 60 + sm)) === 30;
}, {
  message: 'Sending window must be exactly 30 minutes',
  path: ['end_time_str'],
}).refine(data => {
  // Prevent past dates, using the selected timezone
  if (data.sending_preference === 'immediate') return true;
  const now = DateTime.now().setZone(data.timezone).startOf('day');
  const launch = DateTime.fromISO(data.launch_date, { zone: data.timezone }).startOf('day');
  return launch >= now;
}, {
  message: 'Launch date cannot be in the past',
  path: ['launch_date'],
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

const timeOptions = Array.from({ length: 48 }).map((_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? 0 : 30;
  return {
    value: `${hour}:${minute.toString().padStart(2, '0')}`,
    label: formatTime(hour, minute),
  };
});

/**
 * Computes a sensible default 30-minute sending window based on
 * the current local time.
 *
 * Logic:
 *  - Take now, round up to the next :00 or :30 mark.
 *  - If the result is past 23:00 (or would push end_hour to 24), wrap to
 *    09:00 (next morning's first business slot).
 *
 * Returns { start_time_str, end_time_str } in "H:MM" format.
 */
function getDefaultTimeWindow(): { start_time_str: string; end_time_str: string } {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  // Round up to next 30-min boundary
  const rounded = Math.ceil(totalMinutes / 30) * 30;
  const startH = Math.floor(rounded / 60);
  const startM = rounded % 60;

  // If rounded time would go past 23:30 (end would be 24:00), fall back to 09:00
  if (startH >= 24 || (startH === 23 && startM === 30)) {
    return { start_time_str: '9:00', end_time_str: '9:30' };
  }

  const endTotal = rounded + 30;
  const endH = Math.floor(endTotal / 60);
  const endM = endTotal % 60;

  const pad = (m: number) => m.toString().padStart(2, '0');
  return {
    start_time_str: `${startH}:${pad(startM)}`,
    end_time_str:   `${endH}:${pad(endM)}`,
  };
}

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
  const backdropRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewError, setPreviewError] = useState('');

  const getDefaultTimezone = () => {
    if (user && (user as any).timezone) return (user as any).timezone;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  };

  const {
    register, control, handleSubmit, watch, reset,
    formState: { errors, isValid },
  } = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: '',
      sending_preference: 'immediate',
      timezone: getDefaultTimezone(),
      // Default window: auto-detected from browser's current local time,
      // rounded up to the next 30-minute boundary.
      ...getDefaultTimeWindow(),
      // All 7 days active by default (SUN–SAT)
      custom_days: [0, 1, 2, 3, 4, 5, 6],
      daily_sending_limit: 200,
      launch_date: new Date().toISOString().split('T')[0],
    },
    mode: 'onChange',
  });

  const nameValue         = watch('name') || '';
  const sendingPreference = watch('sending_preference');
  const customDays        = watch('custom_days') || [];
  const startTimeStr      = watch('start_time_str') || '9:00';
  const endTimeStr        = watch('end_time_str') || '17:00';
  const timezone          = watch('timezone');
  const launchDate        = watch('launch_date');
  const dailyLimit        = watch('daily_sending_limit');

  // Real-time ticking clock
  const [currentLocalDt, setCurrentLocalDt] = useState(() => DateTime.now().setZone(timezone));
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentLocalDt(DateTime.now().setZone(timezone));
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [timezone]);

  // Debounced preview fetch
  useEffect(() => {
    if (!isOpen) return;

    const fetchPreview = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      setPreviewLoading(true);
      setPreviewError('');

      try {
        const [sH, sM] = startTimeStr.split(':').map(Number);
        const [eH, eM] = endTimeStr.split(':').map(Number);
        const actualLaunchDate = sendingPreference === 'immediate' 
          ? new Date().toISOString() 
          : new Date(launchDate).toISOString();

        const data = await sequenceService.getSchedulePreview({
          timezone,
          launch_date: actualLaunchDate,
          active_days: customDays,
          start_hour: sH,
          start_minute: sM,
          end_hour: eH,
          end_minute: eM,
          daily_cap: dailyLimit
        }, abortControllerRef.current.signal);
        
        setPreviewData(data);
      } catch (err: any) {
        if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') {
          setPreviewError('Failed to load schedule preview');
          setPreviewData(null);
        }
      } finally {
        setPreviewLoading(false);
      }
    };

    const timer = setTimeout(fetchPreview, 500);
    return () => clearTimeout(timer);
  }, [isOpen, sendingPreference, customDays, launchDate, timezone, startTimeStr, endTimeStr, dailyLimit]);

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

  // Local time card computation
  const localTimeStr = currentLocalDt.toFormat('h:mm a ZZZZ');
  const previewTzAbbr = previewData?.timezoneAbbreviation || currentLocalDt.toFormat('ZZZZ');
  
  const formattedStart = formatTime(Number(startTimeStr.split(':')[0]), Number(startTimeStr.split(':')[1]));
  const formattedEnd = formatTime(Number(endTimeStr.split(':')[0]), Number(endTimeStr.split(':')[1]));

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-full max-w-4xl max-h-[94vh]"
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

          {/* Scrollable body with grid */}
          <div className="overflow-y-auto flex-1 flex flex-col md:flex-row bg-gray-50/50">
            
            {/* Form Side */}
            <div className="flex-1 px-6 py-5 bg-white border-r border-gray-100">
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
                          <p className="text-[11.5px] text-gray-500 mt-1 leading-snug">Emails go out as soon as possible based on the window.</p>
                        </div>
                      </label>

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
                          <span className="text-[13px] font-bold text-gray-900">Schedule later</span>
                          <p className="text-[11.5px] text-gray-500 mt-1 leading-snug">Strictly follows the calendar day you specify.</p>
                        </div>
                      </label>
                    </div>

                    {sendingPreference === 'scheduled' && (
                      <div className="mt-4">
                        <label className="block text-[13px] font-bold text-gray-900 mb-2">Launch Date</label>
                        <input
                          type="date"
                          className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${
                            errors.launch_date ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-indigo-500'
                          }`}
                          {...register('launch_date')}
                        />
                        {errors.launch_date && <p className="text-xs text-red-500 mt-1">{errors.launch_date.message}</p>}
                      </div>
                    )}
                  </div>

                  {/* 3. Timezone Information */}
                  <div>
                    <SectionLabel>Your Timezone</SectionLabel>
                    
                    {/* Detected Timezone Card */}
                    <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl mb-2 shadow-sm">
                      <div className="flex flex-col">
                        <span className="text-[14px] font-bold text-gray-900">{timezone.replace('_', ' ')}</span>
                        <span className="text-[11px] text-gray-500 font-medium">Automatically detected from your browser.</span>
                      </div>
                      <div className="p-2 bg-indigo-50 rounded-lg shrink-0">
                        <Globe className="w-5 h-5 text-indigo-600" />
                      </div>
                    </div>
                    
                    {/* Local Time Card */}
                    <div className="flex items-center justify-between px-4 py-3 bg-indigo-50/50 border border-indigo-100 rounded-xl shadow-sm">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider mb-0.5">Current Local Time</span>
                        <span className="text-xs text-indigo-700">Automatically adjusts for DST</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-black text-indigo-900 tracking-tight">{localTimeStr}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. Active Days */}
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

                  {/* 5. Time window row */}
                  <div>
                    <div className="grid grid-cols-[1fr_24px_1fr] items-end gap-2">
                      <div>
                        <label className="block text-[13px] font-bold text-gray-900 mb-2">Start Time</label>
                        <SelectField icon={Clock} {...register('start_time_str')}>
                          {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label} {previewTzAbbr}</option>)}
                        </SelectField>
                      </div>
                      <div className="flex items-center justify-center pb-2.5">
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                      </div>
                      <div>
                        <label className="block text-[13px] font-bold text-gray-900 mb-2">End Time</label>
                        <SelectField icon={Clock} {...register('end_time_str')}>
                          {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label} {previewTzAbbr}</option>)}
                        </SelectField>
                      </div>
                    </div>
                    {errors.start_time_str && <p className="text-xs text-red-500 mt-1">{errors.start_time_str.message}</p>}
                    {errors.end_time_str && <p className="text-xs text-red-500 mt-1">{errors.end_time_str.message}</p>}

                    {/* Info banner */}
                    <div className="mt-3 flex items-start gap-2.5 px-4 py-2.5 bg-blue-50/50 border border-blue-200 rounded-xl">
                      <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      <p className="text-[12px] text-blue-700 font-medium leading-relaxed">
                        Recipients are automatically distributed throughout the selected 30-minute window to improve deliverability and avoid sending spikes.
                      </p>
                    </div>
                  </div>

                  {/* 6. Daily Execution Cap */}
                  <div>
                    <SectionLabel>Daily Limit</SectionLabel>
                    <p className="text-[12px] text-gray-500 -mt-2 mb-3">Maximum number of emails to send per day</p>
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

            {/* Preview Side */}
            <div className="w-full md:w-[320px] p-6 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#5B4CFF]" />
                Campaign Schedule
              </h3>
              
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
                
                {previewLoading && !previewData && (
                  <div className="flex justify-center py-10">
                    <LoadingSpinner size={24} />
                  </div>
                )}
                
                {!previewLoading && previewError && (
                  <div className="text-red-500 text-sm py-4 text-center">
                    {previewError}
                  </div>
                )}

                {previewData && (
                  <>
                    <div className="flex justify-between border-b border-gray-100 pb-3">
                      <span className="text-xs text-gray-500 font-medium">Detected Timezone</span>
                      <span className="text-xs font-semibold text-gray-900 text-right">{timezone.replace('_', ' ')}</span>
                    </div>

                    <div className="flex justify-between border-b border-gray-100 pb-3">
                      <span className="text-xs text-gray-500 font-medium">Launch</span>
                      <span className="text-xs font-semibold text-gray-900 text-right">
                        {DateTime.fromISO(sendingPreference === 'immediate' ? new Date().toISOString() : launchDate).setZone(timezone).toFormat('MMMM d, yyyy')}
                      </span>
                    </div>

                    <div className="flex justify-between border-b border-gray-100 pb-3">
                      <span className="text-xs text-gray-500 font-medium">Window</span>
                      <span className="text-xs font-semibold text-gray-900 text-right">
                        {formattedStart} – {formattedEnd} {previewTzAbbr}
                      </span>
                    </div>

                    <div className="flex justify-between border-b border-gray-100 pb-3">
                      <span className="text-xs text-gray-500 font-medium">Weekdays</span>
                      <span className="text-xs font-semibold text-gray-900 text-right">
                        {customDays.map(d => DAYS[d]).join(' ')}
                      </span>
                    </div>
                    
                    <div className="flex justify-between border-b border-gray-100 pb-3">
                      <span className="text-xs text-gray-500 font-medium">Daily Limit</span>
                      <span className="text-xs font-semibold text-gray-900 text-right">{dailyLimit}</span>
                    </div>

                    <div className="pt-2">
                      <span className="block text-xs text-gray-500 font-medium mb-1.5">Next Email</span>
                      <div className="bg-[#F7F6FF] border border-[#5B4CFF]/20 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-gray-900">
                            {DateTime.fromISO(previewData.nextAvailableSlotLocal).toFormat('hh:mm a')} {previewTzAbbr}
                          </span>
                          {previewLoading && <LoadingSpinner size={12} />}
                        </div>
                        <div className="text-[11px] font-semibold text-[#5B4CFF] mb-1">
                          {DateTime.fromISO(previewData.nextAvailableSlotLocal).toFormat('MMM d, yyyy (EEEE)')}
                        </div>
                        <div className="text-[11px] text-gray-600">
                          {previewData.relativeTime}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ready to Launch
                    </div>
                  </>
                )}

              </div>
            </div>

          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0 bg-white">
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
                disabled={isSubmitting || !isValid}
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
