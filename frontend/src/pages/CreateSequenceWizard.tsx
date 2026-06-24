import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, X, Edit2, Zap, Calendar as CalendarIcon, Clock, Info, Trash2 } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { sequenceService } from '../services/sequence.service';
import { calculateNextValidSlot, getLocalParts, type SendingWindow } from '@email-sequencing/shared';
import { useAuthStore } from '../store/useAuthStore';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const timeSchema = z.string().regex(/^([0-1]?[0-9]|2[0-3]):(00|30)$/); // Format "H:MM" or "HH:MM"

const wizardSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Maximum 50 characters allowed'),
  sending_preference: z.enum(['immediate', 'scheduled']),
  launch_date: z.string().min(1, 'Launch date is required'),
  timezone: z.string().min(1, 'Timezone is required'),
  start_time_str: timeSchema,
  end_time_str: timeSchema,
  custom_days: z.array(z.number()).min(1, 'Please select at least one active day.'),
  daily_sending_limit: z.coerce.number().min(1, 'Must be greater than 0'),
}).refine(data => {
  const [sh, sm] = data.start_time_str.split(':').map(Number);
  const [eh, em] = data.end_time_str.split(':').map(Number);
  return (sh * 60 + sm) < (eh * 60 + em);
}, {
  message: "Start time must be less than End time",
  path: ["start_time_str"]
});

type WizardData = z.infer<typeof wizardSchema>;

export const CreateSequenceWizard: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { user } = useAuthStore();

  const getDefaultTimezone = () => {
    // Priority: User profile -> Signup country -> Browser fallback
    if (user && (user as any).timezone) return (user as any).timezone;
    // In a real app, you might map country to timezone or have a country-specific default
    // We fall back to browser timezone
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  };

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: '',
      sending_preference: 'immediate',
      timezone: getDefaultTimezone(),
      start_time_str: '9:00',
      end_time_str: '17:00',
      custom_days: [1, 2, 3, 4, 5], // MON-FRI
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

  const [nextSlot, setNextSlot] = useState('');

  // 30 minute options
  const timeOptions = Array.from({ length: 48 }).map((_, i) => {
    const hour = Math.floor(i / 2);
    const minute = i % 2 === 0 ? 0 : 30;
    const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const ampm = hour < 12 ? 'AM' : 'PM';
    const minStr = minute.toString().padStart(2, '0');
    return {
      value: `${hour}:${minStr}`,
      label: `${h}:${minStr} ${ampm}`
    };
  });

  useEffect(() => {
    const [sH, sM] = startTimeStr.split(':').map(Number);
    const [eH, eM] = endTimeStr.split(':').map(Number);
    
    const window: SendingWindow = {
      timezone,
      schedule: 'custom',
      custom_days: customDays,
      start_hour: sH,
      start_minute: sM,
      end_hour: eH,
      end_minute: eM
    };

    const nextDate = calculateNextValidSlot(new Date(), window);
    
    // Format display string
    const parts = getLocalParts(nextDate, timezone);
    const h = parts.hour === 0 ? 12 : parts.hour > 12 ? parts.hour - 12 : parts.hour;
    const ampm = parts.hour < 12 ? 'AM' : 'PM';
    const mStr = parts.minute.toString().padStart(2, '0');
    
    // Very simple "is it today?" heuristic using the calculated date vs now in the target timezone
    const nowParts = getLocalParts(new Date(), timezone);
    const isToday = (parts.year === nowParts.year && parts.month === nowParts.month && parts.day === nowParts.day);
    
    const dateStr = isToday ? 'Today' : nextDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    
    // Also format end time
    const endH = eH === 0 ? 12 : eH > 12 ? eH - 12 : eH;
    const endAmpm = eH < 12 ? 'AM' : 'PM';
    const endMStr = eM.toString().padStart(2, '0');

    setNextSlot(`${dateStr} • ${h}:${mStr} ${ampm} – ${endH}:${endMStr} ${endAmpm} ${timezone}`);
  }, [customDays, launchDate, timezone, startTimeStr, endTimeStr]);

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
        reserved_limit_phase1: 0, // removed from UI, default to 0
        sending_window: {
          timezone: data.timezone,
          schedule: 'custom',
          custom_days: data.custom_days,
          start_hour,
          start_minute,
          end_hour,
          end_minute,
        },
        is_wizard: true,
      });
      toast.success('Sequence created successfully!');
      navigate(`/sequences/${newSequence._id}/builder-v2`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create sequence');
      setIsSubmitting(false);
    }
  };

  const handleClearAll = () => {
    setValue('name', '');
    setValue('sending_preference', 'immediate');
    setValue('launch_date', new Date().toISOString().split('T')[0]);
    setValue('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    setValue('start_time_str', '9:00');
    setValue('end_time_str', '17:00');
    setValue('custom_days', [1, 2, 3, 4, 5]);
    setValue('daily_sending_limit', 200);
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] flex flex-col font-sans">
      <Toaster position="top-right" />
      
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            type="button"
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors" 
            onClick={() => navigate('/sequences')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">New Sequence Setup</h1>
            <p className="text-sm text-gray-500">Create and configure your outreach sequence</p>
          </div>
        </div>
        <button 
          type="button"
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full border border-gray-200 transition-colors"
          onClick={() => navigate('/sequences')}
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10 pb-32">
        <form id="wizard-form" onSubmit={handleSubmit(onSubmit)} className="space-y-12">
          
          {/* Section 1: Sequence Title */}
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900">Sequence Title</h2>
              <p className="text-sm text-gray-500">Give your sequence a unique and descriptive name</p>
            </div>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary-500">
                <Edit2 className="w-5 h-5" />
              </div>
              <input
                type="text"
                className={`w-full pl-12 pr-4 py-3.5 bg-white border ${errors.name ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200 focus:ring-primary-500 focus:border-primary-500'} rounded-xl shadow-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all`}
                placeholder="Type sequence title here..."
                maxLength={50}
                {...register('name')}
              />
            </div>
            <div className="flex justify-between items-center mt-2">
              <p className="text-sm text-red-500">{errors.name?.message}</p>
              <p className="text-xs text-gray-400 font-medium ml-auto">{nameValue.length} / 50 characters</p>
            </div>
          </section>

          {/* Section 2: Sending Preference */}
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900">Sending Preference</h2>
              <p className="text-sm text-gray-500">Choose how you want this sequence to start</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Option A */}
              <label 
                className={`relative flex flex-col p-6 cursor-pointer rounded-xl border-2 transition-all duration-200 ${
                  sendingPreference === 'immediate' 
                    ? 'border-primary-500 bg-primary-50/30' 
                    : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
              >
                <input type="radio" value="immediate" className="sr-only" {...register('sending_preference')} />
                <div className="flex items-center mb-3">
                  <Zap className={`w-5 h-5 mr-3 ${sendingPreference === 'immediate' ? 'text-primary-600' : 'text-gray-400'}`} />
                  <span className="font-bold text-gray-900">Send immediately</span>
                  <span className="ml-auto text-[10px] font-bold tracking-wider text-green-700 bg-green-100 px-2 py-0.5 rounded-full uppercase">Recommended</span>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">
                  We'll send your emails in the next available time slot based on your configured sending schedule.
                </p>
              </label>

              {/* Option B */}
              <label 
                className={`relative flex flex-col p-6 cursor-pointer rounded-xl border-2 transition-all duration-200 ${
                  sendingPreference === 'scheduled' 
                    ? 'border-primary-500 bg-primary-50/30' 
                    : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
              >
                <input type="radio" value="scheduled" className="sr-only" {...register('sending_preference')} />
                <div className="flex items-center mb-3">
                  <CalendarIcon className={`w-5 h-5 mr-3 ${sendingPreference === 'scheduled' ? 'text-primary-600' : 'text-gray-400'}`} />
                  <span className="font-bold text-gray-900">Schedule later</span>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Sequence starts according to the selected start date and sending calendar.
                </p>
              </label>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5 flex items-center shadow-sm">
              <div className="p-2 bg-primary-50 rounded-lg shrink-0 mr-4">
                <Clock className="w-5 h-5 text-primary-600" />
              </div>
              <div className="flex-1 flex justify-between items-center">
                <div>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-0.5">Next Available Slot</p>
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                    {nextSlot}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 bg-primary-50/50 border border-primary-100 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-primary-500 shrink-0 mt-0.5" />
              <p className="text-sm text-primary-700">
                {sendingPreference === 'immediate' 
                  ? 'If you choose "Send immediately", your sequence will start in the next available slot within your selected window.'
                  : 'Sequence starts according to the selected start date and sending calendar.'}
              </p>
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* Section 3: Active Days */}
          <section>
            <div className="flex justify-between items-end mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Active Days</h2>
                <p className="text-sm text-gray-500">Select the days when this sequence should run</p>
              </div>
              <div className="text-sm font-medium text-gray-700 flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                {customDays.length} day(s) selected
              </div>
            </div>
            
            <Controller
              name="custom_days"
              control={control}
              render={({ field }) => (
                <div className="grid grid-cols-7 gap-2">
                  {DAYS.map((day, idx) => {
                    const isSelected = field.value.includes(idx);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? field.value.filter(d => d !== idx)
                            : [...field.value, idx].sort();
                          field.onChange(newValue);
                        }}
                        className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                          isSelected
                            ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20 translate-y-[-2px]'
                            : 'bg-white border border-gray-200 text-gray-500 hover:border-primary-300 hover:text-primary-600'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              )}
            />
            {errors.custom_days && <p className="text-sm text-red-500 mt-2">{errors.custom_days.message}</p>}
          </section>

          {/* Section 4: Schedule Configuration */}
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-900">Start Date</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <CalendarIcon className="w-5 h-5" />
                  </div>
                  <input
                    type="date"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 rounded-xl shadow-sm text-gray-900 text-sm"
                    {...register('launch_date')}
                  />
                </div>
                {errors.launch_date && <p className="text-sm text-red-500">{errors.launch_date.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-900">Timezone</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <select 
                    {...register('timezone')} 
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 rounded-xl shadow-sm text-gray-900 text-sm appearance-none"
                  >
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="Asia/Kolkata">India Standard Time (IST)</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-900">Sequence Start Time</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <select 
                    {...register('start_time_str')} 
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 rounded-xl shadow-sm text-gray-900 text-sm appearance-none"
                  >
                    {timeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {errors.start_time_str && <p className="text-sm text-red-500">{errors.start_time_str.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-900">Sequence End Time</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <select 
                    {...register('end_time_str')} 
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 rounded-xl shadow-sm text-gray-900 text-sm appearance-none"
                  >
                    {timeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {errors.end_time_str && <p className="text-sm text-red-500">{errors.end_time_str.message}</p>}
              </div>
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* Section 5: Execution Controls */}
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 w-full mb-6">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-900">Daily Execution Cap</label>
                <p className="text-xs text-gray-500 mb-2">Maximum number of emails that can be sent per day.</p>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Zap className="w-5 h-5 text-primary-500" />
                  </div>
                  <input
                    type="number"
                    min="1"
                    placeholder="Enter maximum executions per day"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 rounded-xl shadow-sm text-gray-900 text-sm"
                    {...register('daily_sending_limit')}
                  />
                </div>
                {errors.daily_sending_limit && <p className="text-sm text-red-500">{errors.daily_sending_limit.message}</p>}
              </div>
            </div>
          </section>

        </form>
      </main>

      {/* Footer Actions */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-2 md:px-6">
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate('/sequences')} className="px-6 py-2.5 rounded-xl font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
              Cancel
            </Button>
            <button 
              type="button" 
              onClick={handleClearAll}
              className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          </div>
          
          <div className="flex gap-3">
            <Button 
              type="button" 
              onClick={handleSubmit(onSubmit)} 
              isLoading={isSubmitting}
              className="px-8 py-2.5 rounded-xl font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-600/20"
            >
              <Zap className="w-4 h-4 mr-2" />
              Create Sequence
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};
