import React, { useState, useEffect } from 'react';
import { X, Calendar } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { sequenceService } from '../../services/sequence.service';

interface RescheduleCampaignModalProps {
  sequenceId: string;
  contactIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const TIME_OPTIONS = Array.from({ length: 48 }).map((_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return {
    label: `${displayHour}:${minute} ${ampm}`,
    value: `${hour}:${minute}`
  };
});

export function RescheduleCampaignModal({
  sequenceId,
  contactIds,
  onClose,
  onSuccess
}: RescheduleCampaignModalProps) {
  const [action, setAction] = useState<'immediately' | 'today' | 'tomorrow' | 'custom'>('custom');
  const [launchDate, setLaunchDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('17:30');
  const [endTime, setEndTime] = useState<string>('18:00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [browserTimezone, setBrowserTimezone] = useState('UTC');

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setBrowserTimezone(tz || 'UTC');
    } catch (e) {
      setBrowserTimezone('UTC');
    }
    // Set default launch date to today for "June 26, 2026" example
    const today = new Date();
    setLaunchDate(today.toISOString().split('T')[0]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (contactIds.length === 0) return;

    try {
      setIsSubmitting(true);
      
      const payload: any = {
        contact_ids: contactIds,
        action,
        browser_timezone: browserTimezone
      };

      if (action === 'custom') {
        const [start_hour, start_minute] = startTime.split(':').map(Number);
        const [end_hour, end_minute] = endTime.split(':').map(Number);
        payload.launch_date = launchDate;
        payload.start_hour = start_hour;
        payload.start_minute = start_minute;
        payload.end_hour = end_hour;
        payload.end_minute = end_minute;
      }

      await sequenceService.rescheduleCampaign(sequenceId, payload);
      toast.success(`Successfully rescheduled ${contactIds.length} contacts`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to reschedule campaign');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[500px] overflow-hidden flex flex-col font-sans">
        
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-gray-900 tracking-tight">
            Reschedule Selected Emails ({contactIds.length} recipients)
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-5 h-5 stroke-[1.5]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 bg-white">
          <form id="reschedule-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-gray-900">
                What would you like to do with these {contactIds.length} emails?
              </label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as any)}
                className="w-full h-11 px-3 border border-gray-200 rounded-md text-[14px] text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm bg-white appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em' }}
              >
                <option value="custom">Custom Date</option>
                <option value="tomorrow">Send Tomorrow (within existing window)</option>
                <option value="today">Send Today (within existing window)</option>
                <option value="immediately">Send Immediately</option>
              </select>
            </div>

            {action === 'custom' && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2 relative">
                  <label className="text-[14px] text-gray-700">Launch Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={launchDate}
                      onChange={(e) => setLaunchDate(e.target.value)}
                      className="w-full h-11 pl-3 pr-10 border border-gray-200 rounded-md text-[14px] text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm"
                      required
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[14px] text-gray-700">
                    Run Between <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <select
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="h-11 px-3 w-[140px] border border-gray-200 rounded-md text-[14px] text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm bg-white appearance-none"
                      style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em' }}
                    >
                      {TIME_OPTIONS.map(opt => (
                        <option key={`start-${opt.value}`} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <span className="text-gray-500 text-[14px]">to</span>
                    <select
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="h-11 px-3 w-[140px] border border-gray-200 rounded-md text-[14px] text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm bg-white appearance-none"
                      style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em' }}
                    >
                      {TIME_OPTIONS.map(opt => (
                        <option key={`end-${opt.value}`} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[13px] text-gray-500 mt-1">
                    Your sequence will run on selected days within this time range.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-[#F9FAFB] rounded-xl px-4 py-3 border border-gray-100 text-[14px] text-gray-700">
              This will not affect contacts with the <span className="font-semibold text-gray-900">Finished</span> status.
            </div>

          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 bg-white flex items-center justify-end gap-3 mt-2 mb-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-md text-[14px] font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="reschedule-form"
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-md text-[14px] font-medium text-white bg-[#111827] hover:bg-[#1f2937] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Rescheduling...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
