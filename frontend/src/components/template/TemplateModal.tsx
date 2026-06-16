import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Template, CreateTemplateDto } from '../../types';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTemplateDto) => Promise<void>;
  initialData?: Template | null;
}

const templateSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  subject: z.string().min(1, 'Subject is required'),
  body_html: z.string().min(1, 'HTML Content is required'),
  category: z.string().optional(),
});

type FormData = z.infer<typeof templateSchema>;

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}) => {
  const isEditing = !!initialData;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      subject: '',
      body_html: '',
      category: 'custom',
    }
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        reset({
          name: initialData.name,
          subject: initialData.subject,
          body_html: initialData.body_html,
          category: initialData.category || 'custom',
        });
      } else {
        reset({
          name: '',
          subject: '',
          body_html: '',
          category: 'custom',
        });
      }
    }
  }, [isOpen, initialData, reset]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? 'Edit Template' : 'Create Template'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Main Form Area */}
          <form id="template-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 p-6 overflow-y-auto space-y-4">
            <Input 
              label="Template Name *" 
              placeholder="e.g. Q1 Outbound v2" 
              {...register('name')} 
              error={errors.name?.message} 
            />
            
            <Input 
              label="Email Subject *" 
              placeholder="Quick question for {{firstName}}" 
              {...register('subject')} 
              error={errors.subject?.message} 
            />
            
            <div className="space-y-1.5 flex-1 flex flex-col">
              <label className="block text-sm font-medium text-gray-700">
                HTML Content *
              </label>
              <textarea
                {...register('body_html')}
                className="flex-1 min-h-[300px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="<p>Hi {{firstName}},</p><p>We help companies like {{company}} scale...</p>"
              />
              {errors.body_html?.message && (
                <p className="text-sm text-red-500">{errors.body_html.message}</p>
              )}
            </div>
          </form>

          {/* Sidebar / Quick Reference */}
          <div className="w-64 bg-gray-50 border-l border-gray-200 p-6 hidden md:block overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary-600" />
              Merge Tags
            </h3>
            <p className="text-xs text-gray-600 mb-4">
              Use double curly braces to insert dynamic contact data. You can optionally provide a fallback value separated by a pipe.
            </p>
            
            <div className="space-y-3">
              <div className="bg-white border border-gray-200 rounded p-2 text-xs">
                <code className="text-primary-600 font-mono block mb-1">{'{{firstName}}'}</code>
                <span className="text-gray-500">Inserts contact's first name.</span>
              </div>
              <div className="bg-white border border-gray-200 rounded p-2 text-xs">
                <code className="text-primary-600 font-mono block mb-1">{'{{company}}'}</code>
                <span className="text-gray-500">Inserts contact's company.</span>
              </div>
              <div className="bg-white border border-gray-200 rounded p-2 text-xs">
                <code className="text-primary-600 font-mono block mb-1">{'{{firstName|there}}'}</code>
                <span className="text-gray-500">Falls back to "there" if name is empty (e.g. "Hi there").</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="template-form" isLoading={isSubmitting}>
            {isEditing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>
    </div>
  );
};
