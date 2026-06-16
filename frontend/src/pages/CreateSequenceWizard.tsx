import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { sequenceService } from '../services/sequence.service';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const wizardSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  launch_date: z.string().min(1, 'Launch date is required'),
  timezone: z.string().min(1, 'Timezone is required'),
  start_hour: z.coerce.number().min(0).max(23),
  end_hour: z.coerce.number().min(0).max(23),
  custom_days: z.array(z.number()).min(1, 'Select at least one day'),
  daily_sending_limit: z.coerce.number().min(1, 'Must be greater than 0'),
  reserved_limit_phase1: z.coerce.number().min(0).max(100),
  warmup_percentage: z.coerce.number().min(0).max(100).optional().or(z.literal('')),
}).refine(data => data.start_hour < data.end_hour, {
  message: "Start time must be before end time",
  path: ["start_hour"]
});

type WizardData = z.infer<typeof wizardSchema>;

export const CreateSequenceWizard: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, control, handleSubmit, trigger, getValues, formState: { errors } } = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      start_hour: 9,
      end_hour: 17,
      custom_days: [1, 2, 3, 4, 5], // Mon-Fri default
      daily_sending_limit: 100,
      reserved_limit_phase1: 50,
      launch_date: new Date().toISOString().split('T')[0],
      warmup_percentage: '',
    },
    mode: 'onTouched',
  });

  const nextStep = async () => {
    let isValid = false;
    if (step === 1) {
      isValid = await trigger(['name', 'launch_date', 'timezone', 'start_hour', 'end_hour', 'custom_days']);
    } else if (step === 2) {
      isValid = await trigger(['daily_sending_limit', 'reserved_limit_phase1', 'warmup_percentage']);
    }
    if (isValid) setStep(s => s + 1);
  };

  const prevStep = () => setStep(s => s - 1);

  const onSubmit = async (data: WizardData) => {
    setIsSubmitting(true);
    try {
      const newSequence = await sequenceService.create({
        name: data.name,
        launch_date: new Date(data.launch_date).toISOString(),
        daily_sending_limit: data.daily_sending_limit,
        reserved_limit_phase1: data.reserved_limit_phase1,
        warmup_percentage: data.warmup_percentage === '' ? undefined : Number(data.warmup_percentage),
        sending_window: {
          timezone: data.timezone,
          schedule: 'custom',
          custom_days: data.custom_days,
          start_hour: data.start_hour,
          end_hour: data.end_hour,
        },
        is_wizard: true,
      });
      toast.success('Sequence created successfully!');
      navigate(`/sequences/${newSequence._id}/builder`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create sequence');
      setIsSubmitting(false);
    }
  };

  const currentValues = getValues();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" className="p-2" onClick={() => navigate('/sequences')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Create New Sequence</h1>
          <p className="text-sm text-gray-500">Configure your outreach campaign</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-6 md:p-12">
        {/* Progress Bar */}
        <div className="mb-12 relative">
          <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 -translate-y-1/2 rounded"></div>
          <div className="absolute top-1/2 left-0 h-1 bg-primary-600 -z-10 -translate-y-1/2 rounded transition-all duration-300" style={{ width: `${((step - 1) / 2) * 100}%` }}></div>
          
          <div className="flex justify-between">
            {[1, 2, 3].map((num) => (
              <div key={num} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-4 border-gray-50 transition-colors duration-300 ${step >= num ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {step > num ? <Check className="w-5 h-5" /> : num}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-sm font-medium text-gray-500">
            <span className={step >= 1 ? 'text-gray-900' : ''}>Basic Settings</span>
            <span className={step >= 2 ? 'text-gray-900' : ''}>Sending Config</span>
            <span className={step >= 3 ? 'text-gray-900' : ''}>Review</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form id="wizard-form" onSubmit={handleSubmit(onSubmit)}>
            
            {/* STEP 1 */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Basic Settings</h2>
                
                <Input label="Sequence Name *" placeholder="e.g. Q3 Inbound Leads" {...register('name')} error={errors.name?.message} />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input label="Launch Date *" type="date" {...register('launch_date')} error={errors.launch_date?.message} />
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Timezone *</label>
                    <select {...register('timezone')} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="America/Chicago">Central Time (CT)</option>
                      <option value="America/Denver">Mountain Time (MT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                      <option value="Asia/Kolkata">India Standard Time (IST)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Send Days *</label>
                  <Controller
                    name="custom_days"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-2">
                        {DAYS.map((day, idx) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              const newValue = field.value.includes(idx)
                                ? field.value.filter(d => d !== idx)
                                : [...field.value, idx].sort();
                              field.onChange(newValue);
                            }}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                              field.value.includes(idx)
                                ? 'bg-primary-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                  {errors.custom_days && <p className="text-xs text-red-500 mt-1">{errors.custom_days.message}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Start Time (Hour 0-23)</label>
                    <select {...register('start_hour')} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {Array.from({ length: 24 }).map((_, i) => <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>)}
                    </select>
                    {errors.start_hour && <p className="text-xs text-red-500">{errors.start_hour.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">End Time (Hour 0-23)</label>
                    <select {...register('end_hour')} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      {Array.from({ length: 24 }).map((_, i) => <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>)}
                    </select>
                    {errors.end_hour && <p className="text-xs text-red-500">{errors.end_hour.message}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Sending Configuration</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input label="Daily Sending Limit *" type="number" min="1" {...register('daily_sending_limit')} error={errors.daily_sending_limit?.message} helperText="Max emails sent per day" />
                  <Input label="Reserved Limit For Phase 1 (%) *" type="number" min="0" max="100" {...register('reserved_limit_phase1')} error={errors.reserved_limit_phase1?.message} helperText="Percentage allocated for Phase 1" />
                </div>
                <Input label="Warmup Percentage (%)" type="number" min="0" max="100" {...register('warmup_percentage')} error={errors.warmup_percentage?.message} helperText="Optional continuous warmup throttle" />
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Review & Submit</h2>
                <div className="bg-gray-50 rounded-xl p-6 space-y-4 border border-gray-200">
                  <div className="grid grid-cols-2 gap-y-4 text-sm">
                    <div className="text-gray-500">Name</div>
                    <div className="font-medium text-gray-900">{currentValues.name}</div>
                    
                    <div className="text-gray-500">Launch Date</div>
                    <div className="font-medium text-gray-900">{currentValues.launch_date}</div>
                    
                    <div className="text-gray-500">Schedule</div>
                    <div className="font-medium text-gray-900">
                      {currentValues.custom_days.map(d => DAYS[d]).join(', ')} <br/>
                      {currentValues.start_hour}:00 to {currentValues.end_hour}:00 ({currentValues.timezone})
                    </div>

                    <div className="col-span-2 my-2 border-t border-gray-200"></div>

                    <div className="text-gray-500">Daily Limit</div>
                    <div className="font-medium text-gray-900">{currentValues.daily_sending_limit} emails/day</div>

                    <div className="text-gray-500">Reserved (Phase 1)</div>
                    <div className="font-medium text-gray-900">{currentValues.reserved_limit_phase1}%</div>

                    {currentValues.warmup_percentage && (
                      <>
                        <div className="text-gray-500">Warmup</div>
                        <div className="font-medium text-gray-900">{currentValues.warmup_percentage}%</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="mt-10 flex items-center justify-between pt-6 border-t border-gray-200">
              <Button type="button" variant="ghost" onClick={step === 1 ? () => navigate('/sequences') : prevStep} disabled={isSubmitting}>
                {step === 1 ? 'Cancel' : <><ArrowLeft className="w-4 h-4 mr-2" /> Back</>}
              </Button>
              
              {step < 3 ? (
                <Button type="button" onClick={nextStep}>
                  Next <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button type="submit" isLoading={isSubmitting}>
                  Create Sequence
                </Button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};
