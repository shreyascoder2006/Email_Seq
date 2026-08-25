import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { EmailConnection, CreateEmailConnectionDto } from '../../types';
import type { SmtpPrefill } from './ProviderSelectionModal';

interface EmailAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateEmailConnectionDto) => Promise<void>;
  initialData?: EmailConnection | null;
  /** SMTP defaults injected by ProviderSelectionModal for new-account creation */
  prefillData?: SmtpPrefill;
}

const accountSchema = z.object({
  label: z.string().min(2, 'Label is required'),
  from_name: z.string().min(1, 'Sender name is required'),
  from_email: z.string().email('Invalid email address'),
  reply_to: z.string().email('Invalid email').optional().or(z.literal('')),
  
  smtp_host: z.string().min(4, 'SMTP host is required'),
  smtp_port: z.coerce.number().min(1).max(65535),
  smtp_encryption: z.enum(['tls', 'ssl', 'none']),
  smtp_username: z.string().min(1, 'SMTP username is required'),
  smtp_password: z.string().optional(), // optional for edit

  imap_host: z.string().optional(),
  imap_port: z.coerce.number().optional().or(z.literal('')),
  imap_encryption: z.enum(['tls', 'ssl', 'none']).optional(),
  imap_username: z.string().optional(),
  imap_password: z.string().optional(), // optional for edit

  daily_limit: z.coerce.number().min(1).max(5000),
  hourly_limit: z.coerce.number().min(1).max(1000),
  min_interval_seconds: z.coerce.number().min(0).max(3600),
});

type FormData = z.infer<typeof accountSchema>;

export const EmailAccountModal: React.FC<EmailAccountModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  prefillData,
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [useSameCredentialsForImap, setUseSameCredentialsForImap] = useState(true);
  const [activeTab, setActiveTab] = useState<'basic' | 'smtp' | 'imap'>('basic');
  const isEditing = !!initialData;

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      smtp_port: 587,
      smtp_encryption: 'tls',
      imap_port: 993,
      imap_encryption: 'ssl',
      daily_limit: 200,
      hourly_limit: 50,
      min_interval_seconds: 60,
    }
  });

  const smtpHost = watch('smtp_host');
  const isGoogle = smtpHost?.toLowerCase().includes('gmail') || smtpHost?.toLowerCase().includes('google');

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        // Edit mode: restore saved values, never pre-fill passwords
        reset({
          ...initialData,
          smtp_password: '',
          imap_password: '',
          reply_to: initialData.reply_to || '',
          imap_host: initialData.imap_host || '',
          imap_username: initialData.imap_username || '',
        });
        setUseSameCredentialsForImap(false);
      } else {
        // Create mode: apply provider defaults if provided, otherwise use blank defaults
        reset({
          label: '',
          from_name: '',
          from_email: '',
          reply_to: '',
          smtp_host:       prefillData?.smtp_host       ?? '',
          smtp_port:       prefillData?.smtp_port       ?? 587,
          smtp_encryption: prefillData?.smtp_encryption ?? 'tls',
          smtp_username: '',
          smtp_password: '',
          imap_host:       prefillData?.imap_host       ?? '',
          imap_port:       prefillData?.imap_port       ?? 993,
          imap_encryption: prefillData?.imap_encryption ?? 'ssl',
          imap_username: '',
          imap_password: '',
          daily_limit: 200,
          hourly_limit: 50,
          min_interval_seconds: 60,
        });
        setUseSameCredentialsForImap(true);
      }
      setActiveTab('basic');
      setIsAdvancedOpen(false);
    }
  }, [isOpen, initialData, prefillData, reset]);

  if (!isOpen) return null;

  const onError = (errors: any) => {
    // Check which tab has errors to alert the user
    if (errors.label || errors.from_name || errors.from_email || errors.reply_to) {
      setActiveTab('basic');
    } else if (errors.smtp_host || errors.smtp_port || errors.smtp_username || errors.smtp_password || errors.smtp_encryption) {
      setActiveTab('smtp');
    } else if (errors.imap_host || errors.imap_port || errors.imap_username || errors.imap_password || errors.imap_encryption) {
      setActiveTab('imap');
    } else {
      setIsAdvancedOpen(true);
    }
  };

  const handleFormSubmit = async (data: FormData) => {
    // Manually check passwords for creation
    if (!isEditing && !data.smtp_password) {
      setActiveTab('smtp');
      alert("SMTP Password is required for new accounts.");
      return;
    }
    
    const payload: any = { ...data };
    if (!payload.reply_to) delete payload.reply_to;

    // Clean and strip whitespace from passwords and usernames
    if (payload.smtp_username) payload.smtp_username = payload.smtp_username.trim();
    if (payload.smtp_password) payload.smtp_password = payload.smtp_password.replace(/\s+/g, '');
    if (payload.from_email) payload.from_email = payload.from_email.trim().toLowerCase();

    // Auto-mirror credentials to IMAP if toggle is checked
    if (useSameCredentialsForImap && payload.smtp_username && payload.smtp_password && payload.imap_host) {
      payload.imap_username = payload.smtp_username;
      payload.imap_password = payload.smtp_password;
    }

    // Clean up empty or incomplete IMAP values before sending
    if (
      !payload.imap_host ||
      !payload.imap_username?.trim() ||
      (!isEditing && !payload.imap_password)
    ) {
      delete payload.imap_host;
      delete payload.imap_port;
      delete payload.imap_encryption;
      delete payload.imap_username;
      delete payload.imap_password;
    } else {
      if (payload.imap_username) payload.imap_username = payload.imap_username.trim();
      if (payload.imap_password) payload.imap_password = payload.imap_password.replace(/\s+/g, '');
    }

    // Don't send empty passwords on edit
    if (isEditing && !payload.smtp_password) delete payload.smtp_password;
    if (isEditing && !payload.imap_password) delete payload.imap_password;

    await onSubmit(payload as CreateEmailConnectionDto);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? 'Edit Email Account' : 'Connect Email Account'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Google App Password banner */}
        {isGoogle && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-xs text-amber-900 flex items-start gap-2">
            <span className="text-base">💡</span>
            <div>
              <strong className="font-semibold">Using Gmail / Google Workspace?</strong> You must use a{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="underline font-bold text-amber-950 hover:text-amber-700"
              >
                16-character Google App Password
              </a>{' '}
              (requires 2-Step Verification enabled). Normal Google account passwords are not accepted by SMTP.
            </div>
          </div>
        )}

        <div className="flex border-b border-gray-200 px-6 pt-2 gap-6 bg-gray-50">
          <button onClick={() => setActiveTab('basic')} className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'basic' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Basic Info</button>
          <button onClick={() => setActiveTab('smtp')} className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'smtp' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>SMTP Settings</button>
          <button onClick={() => setActiveTab('imap')} className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'imap' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>IMAP Settings</button>
        </div>

        <form id="account-form" onSubmit={handleSubmit(handleFormSubmit, onError)} className="p-6 overflow-y-auto">
          
          <div className={activeTab === 'basic' ? 'space-y-4' : 'hidden'}>
            <Input label="Account Name / Label *" placeholder="e.g. Sales Gmail" {...register('label')} error={errors.label?.message} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="From Name *" placeholder="John Doe" {...register('from_name')} error={errors.from_name?.message} />
              <Input label="From Email *" type="email" placeholder="john@example.com" {...register('from_email')} error={errors.from_email?.message} />
            </div>
            <Input label="Reply-To Email (Optional)" type="email" placeholder="john-replies@example.com" {...register('reply_to')} error={errors.reply_to?.message} />
          </div>

          <div className={activeTab === 'smtp' ? 'space-y-4' : 'hidden'}>
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
              <Input label="SMTP Host *" placeholder="smtp.gmail.com" {...register('smtp_host')} error={errors.smtp_host?.message} />
              <Input label="Port *" type="number" {...register('smtp_port')} error={errors.smtp_port?.message} />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Encryption *</label>
                <select {...register('smtp_encryption')} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="tls">TLS (Port 587)</option>
                  <option value="ssl">SSL (Port 465)</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="SMTP Username *" placeholder="yourname@gmail.com" {...register('smtp_username')} error={errors.smtp_username?.message} />
              <Input label={isEditing ? "SMTP Password (leave blank to keep)" : "Google App Password / SMTP Password *"} type="password" placeholder="16-character app password" {...register('smtp_password')} error={errors.smtp_password?.message} />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input
                id="same-creds"
                type="checkbox"
                checked={useSameCredentialsForImap}
                onChange={(e) => setUseSameCredentialsForImap(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="same-creds" className="text-xs text-gray-600">
                Use same credentials for IMAP (for auto-detecting prospect replies)
              </label>
            </div>
          </div>

          <div className={activeTab === 'imap' ? 'space-y-4' : 'hidden'}>
            <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm mb-4">
              IMAP is optional. If configured, the system automatically checks for replies and stops subsequent sequence emails.
            </div>
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
              <Input label="IMAP Host" placeholder="imap.gmail.com" {...register('imap_host')} error={errors.imap_host?.message} />
              <Input label="Port" type="number" {...register('imap_port')} error={errors.imap_port?.message} />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Encryption</label>
                <select {...register('imap_encryption')} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="ssl">SSL (Port 993)</option>
                  <option value="tls">TLS</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="IMAP Username" placeholder="yourname@gmail.com" {...register('imap_username')} error={errors.imap_username?.message} />
              <Input label={isEditing ? "IMAP Password (leave blank to keep)" : "IMAP Password"} type="password" placeholder="Leave empty to use SMTP credentials" {...register('imap_password')} error={errors.imap_password?.message} />
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Advanced Sending Limits
              {isAdvancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {isAdvancedOpen && (
              <div className="p-4 bg-white grid grid-cols-3 gap-4 border-t border-gray-200">
                <Input label="Daily Limit" type="number" {...register('daily_limit')} error={errors.daily_limit?.message} />
                <Input label="Hourly Limit" type="number" {...register('hourly_limit')} error={errors.hourly_limit?.message} />
                <Input label="Interval (sec)" type="number" {...register('min_interval_seconds')} error={errors.min_interval_seconds?.message} />
              </div>
            )}
          </div>
        </form>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="account-form" isLoading={isSubmitting}>
            {isEditing ? 'Save Changes' : 'Connect Account'}
          </Button>
        </div>
      </div>
    </div>
  );
};
