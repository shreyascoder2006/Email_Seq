import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { enrollmentService } from '../../../services/enrollment.service';
import { toast } from 'react-hot-toast';

interface EnrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  onSuccess: () => void;
}

const singleContactSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().min(1, 'First name is required'),
  company: z.string().optional(),
});

export const EnrollModal: React.FC<EnrollModalProps> = ({ isOpen, onClose, sequenceId, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('bulk');
  const [bulkText, setBulkText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof singleContactSchema>>({
    resolver: zodResolver(singleContactSchema),
  });

  const handleSingleSubmit = async (data: any) => {
    try {
      setIsSubmitting(true);
      await enrollmentService.enroll(sequenceId, {
        contacts: [data],
        skip_existing: true,
      });
      toast.success('Contact enrolled successfully');
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to enroll contact');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!bulkText.trim()) {
      toast.error('Please enter contacts');
      return;
    }

    try {
      setIsSubmitting(true);
      const lines = bulkText.split('\n');
      const contacts = lines
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          // Format: email,firstName,lastName,company
          const parts = line.split(',');
          return {
            email: parts[0]?.trim() || '',
            first_name: parts[1]?.trim() || '',
            last_name: parts[2]?.trim() || '',
            company: parts[3]?.trim() || '',
          };
        })
        .filter(c => c.email); // Must have at least an email

      if (contacts.length === 0) {
        toast.error('No valid contacts parsed');
        return;
      }

      const result = await enrollmentService.enroll(sequenceId, {
        contacts,
        skip_existing: true,
      });
      
      toast.success(`Enrolled ${result.data.enrolled} contacts. Failed: ${result.data.failed}`);
      setBulkText('');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Bulk enrollment failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Enroll Contacts"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          {activeTab === 'single' ? (
            <Button onClick={handleSubmit(handleSingleSubmit)} isLoading={isSubmitting}>Add Contact</Button>
          ) : (
            <Button onClick={handleBulkSubmit} isLoading={isSubmitting}>Enroll Contacts</Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex border-b border-gray-200">
        <button
          className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'bulk' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('bulk')}
        >
          Bulk Enroll
        </button>
        <button
          className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'single' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('single')}
        >
          Single Contact
        </button>
      </div>

      <div className="mt-4">
        {activeTab === 'single' ? (
          <form className="space-y-4">
            <Input label="Email Address *" placeholder="john@example.com" {...register('email')} error={errors.email?.message} />
            <Input label="First Name *" placeholder="John" {...register('first_name')} error={errors.first_name?.message} />
            <Input label="Company (Optional)" placeholder="Acme Corp" {...register('company')} error={errors.company?.message} />
          </form>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Paste Contacts (CSV Format)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Format: <code>email,firstName,lastName,company</code> (one per line)
              <br/>
              Example: <code>john@gmail.com,John</code>
            </p>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder="john@gmail.com,John&#10;sarah@gmail.com,Sarah"
              className="w-full min-h-[200px] rounded-md border border-gray-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
            />
          </div>
        )}
      </div>
    </Modal>
  );
};
