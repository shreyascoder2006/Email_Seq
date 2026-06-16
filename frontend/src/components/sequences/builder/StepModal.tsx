import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import type { CreateStepDto, StepType, Template, EmailConnection } from '../../../types';

interface StepModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateStepDto) => Promise<void>;
  templates: Template[];
  emailConnections: EmailConnection[];
  initialData?: CreateStepDto;
  stepType: StepType;
}

const emailStepSchema = z.object({
  template_id: z.string().min(1, 'Template is required'),
  email_connection_id: z.string().min(1, 'Email account is required'),
  subject_override: z.string().optional(),
  delay_days: z.coerce.number().int().min(0).default(0),
  delay_hours: z.coerce.number().int().min(0).max(23).default(0),
});

const waitStepSchema = z.object({
  delay_days: z.coerce.number().int().min(0).default(0),
  delay_hours: z.coerce.number().int().min(0).max(23).default(0),
}).refine(data => data.delay_days > 0 || data.delay_hours > 0, {
  message: "Delay must be greater than 0",
  path: ["delay_hours"]
});

export const StepModal: React.FC<StepModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  templates,
  emailConnections,
  initialData,
  stepType,
}) => {
  const schema = stepType === 'email' ? emailStepSchema : waitStepSchema;
  
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({
    // @ts-ignore - union schema typing mismatch
    resolver: zodResolver(schema),
    defaultValues: initialData || (stepType === 'email' ? { delay_days: 0, delay_hours: 0 } : { delay_days: 1, delay_hours: 0 }),
  });

  useEffect(() => {
    if (isOpen) {
      reset(initialData || (stepType === 'email' ? { delay_days: 0, delay_hours: 0 } : { delay_days: 1, delay_hours: 0 }));
    }
  }, [isOpen, initialData, stepType, reset]);

  const handleFormSubmit = async (data: any) => {
    try {
      await onSubmit({ ...data, type: stepType });
      onClose();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `Edit ${stepType === 'email' ? 'Email' : 'Wait'} Step` : `Add ${stepType === 'email' ? 'Email' : 'Wait'} Step`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit(handleFormSubmit)} isLoading={isSubmitting}>
            {initialData ? 'Save Changes' : 'Add Step'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        {stepType === 'email' && (
          <>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Template</label>
              <select
                {...register('template_id')}
                className="block w-full rounded-md border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-primary-600 sm:text-sm sm:leading-6"
              >
                <option value="">Select a template...</option>
                {templates.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
              {/* @ts-ignore */}
              {errors.template_id && <p className="text-sm text-red-500">{String(errors.template_id.message)}</p>}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Email Account</label>
              <select
                {...register('email_connection_id')}
                className="block w-full rounded-md border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-primary-600 sm:text-sm sm:leading-6"
              >
                <option value="">Select an email account...</option>
                {emailConnections.map(c => <option key={c._id} value={c._id}>{c.label} ({c.from_email})</option>)}
              </select>
              {/* @ts-ignore */}
              {errors.email_connection_id && <p className="text-sm text-red-500">{String(errors.email_connection_id.message)}</p>}
            </div>

            <Input
              label="Subject Override (Optional)"
              placeholder="Custom subject line..."
              {...register('subject_override')}
            />
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Delay (Days)"
            type="number"
            min={0}
            {...register('delay_days')}
            error={errors.delay_days?.message as string}
          />
          <Input
            label="Delay (Hours)"
            type="number"
            min={0}
            max={23}
            {...register('delay_hours')}
            error={errors.delay_hours?.message as string}
          />
        </div>
      </form>
    </Modal>
  );
};
