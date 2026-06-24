import React, { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Tag } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { Template, CreateTemplateDto } from '../../types';

import { templateService } from '../../services/template.service';
import { PersonalizationDropdown } from '../personalization/PersonalizationDropdown';
import { PersonalizationSidebar, type MergeTag } from '../personalization/PersonalizationSidebar';
import { RichTextEditor } from '../editor/RichTextEditor';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTemplateDto) => Promise<void>;
  initialData?: Template | null;
}

const templateSchema = z.object({
  name:      z.string().min(2, 'Name is required'),
  subject:   z.string().min(1, 'Subject is required'),
  body_html: z.string().min(1, 'HTML Content is required'),
  category:  z.string().optional(),
});
type FormData = z.infer<typeof templateSchema>;

// ─── Modal ────────────────────────────────────────────────────────────
export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen, onClose, onSubmit, initialData,
}) => {
  const isEditing = !!initialData;
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const editorRef  = useRef<any>(null);
  // Which field was last focused (subject or body)
  const [lastFocus, setLastFocus] = useState<'subject' | 'body'>('body');
  
  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [dropdownAutoFocus, setDropdownAutoFocus] = useState(false);

  
  const [tags, setTags] = useState<{
    contact: MergeTag[];
    custom: MergeTag[];
    sender: MergeTag[];
    sequence: MergeTag[];
  }>({
    contact: [], custom: [], sender: [], sequence: []
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: '', subject: '', body_html: '', category: 'custom' },
  });

  const fetchTags = () => {
    templateService.getMergeTags()
      .then(res => setTags(res))
      .catch(() => {
        setTags({
          contact: [
            { tag: '{{email}}', label: 'Email', desc: "Contact's email address" },
            { tag: '{{first_name}}', label: 'First Name', desc: "Contact's first name" },
            { tag: '{{last_name}}', label: 'Last Name', desc: "Contact's last name" },
            { tag: '{{company}}', label: 'Company', desc: "Contact's company name" },
          ],
          custom: [],
          sender: [],
          sequence: []
        });
      });
  };

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        reset({
          name:      initialData.name,
          subject:   initialData.subject,
          body_html: initialData.body_html,
          category:  initialData.category || 'custom',
        });
      } else {
        reset({ name: '', subject: '', body_html: '', category: 'custom' });
      }
      fetchTags();
    }
  }, [isOpen, initialData, reset]);

  // Insert tag at cursor position of the focused field
  const handleInsert = (tag: string) => {
    if (lastFocus === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const newVal = el.value.slice(0, start) + tag + el.value.slice(end);
      setValue('subject', newVal, { shouldDirty: true });
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + tag.length;
        el.focus();
      });
    } else if (editorRef.current) {
      editorRef.current.chain().focus().insertContent(tag).run();
      setValue('body_html', editorRef.current.getHTML(), { shouldDirty: true });
    }
  };


  // Check for '{{' trigger
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, 
    _field: 'subject' | 'body',
    rhfOnChange: (e: any) => void
  ) => {
    rhfOnChange(e);
    
    // Auto-open dropdown if user types '{{'
    const value = e.target.value;
    const cursor = e.target.selectionStart || 0;
    
    if (cursor >= 2 && value.substring(cursor - 2, cursor) === '{{') {
      const rect = e.target.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + window.scrollY + 5,
        left: rect.left + window.scrollX,
      });
      setDropdownAutoFocus(false); // Do not steal focus when typing
      setDropdownOpen(true);
    }
  };

  const openDropdownManual = (e: React.MouseEvent, field: 'subject' | 'body') => {
    e.preventDefault();
    e.stopPropagation();
    setLastFocus(field);
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownStyle({
      top: rect.bottom + window.scrollY + 5,
      left: rect.left + window.scrollX,
    });
    setDropdownAutoFocus(true); // Auto-focus the search bar when clicking the button
    setDropdownOpen(true);
  };

  // Wire up refs alongside react-hook-form register
  const { ref: subjectRHFRef, onChange: subjectOnChange, ...subjectRest } = register('subject');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? 'Edit Template' : 'Create Template'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Form */}
          <form
            id="template-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex-1 p-6 overflow-y-auto space-y-4"
          >
            <Input
              label="Template Name *"
              placeholder="e.g. Q1 Outbound v2"
              {...register('name')}
              error={errors.name?.message}
            />

            {/* Subject with cursor-aware insert */}
            <div className="space-y-1.5 relative">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Email Subject *</label>
                <button
                  type="button"
                  onMouseDown={(e) => openDropdownManual(e, 'subject')}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                >
                  <Tag className="w-3 h-3" />
                  {`{ }`} Variables
                </button>
              </div>
              <input
                {...subjectRest}
                onChange={(e) => handleInputChange(e, 'subject', subjectOnChange)}
                ref={(el) => { subjectRHFRef(el); subjectRef.current = el; }}
                onFocus={() => setLastFocus('subject')}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="{{first_name}}, quick question about {{company}}"
              />
              {errors.subject?.message && <p className="text-sm text-red-500">{errors.subject.message}</p>}
            </div>

            {/* Body */}
            <div className="space-y-1.5 flex flex-col relative">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Email Content *</label>
                <button
                  type="button"
                  onMouseDown={(e) => openDropdownManual(e, 'body')}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                >
                  <Tag className="w-3 h-3" />
                  {`{ }`} Variables
                </button>
              </div>
              
              <Controller
                control={control}
                name="body_html"
                render={({ field }) => (
                  <RichTextEditor
                    editorRef={editorRef}
                    value={field.value}
                    onChange={(val) => {
                      field.onChange(val);
                    }}
                    onFocus={() => setLastFocus('body')}
                    onTriggerVariable={(rect) => {
                      setLastFocus('body');
                      setDropdownStyle({
                        top: rect.bottom + window.scrollY + 5,
                        left: rect.left + window.scrollX,
                      });
                      setDropdownAutoFocus(false);
                      setDropdownOpen(true);
                    }}
                    error={errors.body_html?.message}
                  />
                )}
              />
              
              {errors.body_html?.message && <p className="text-sm text-red-500">{errors.body_html.message}</p>}
            </div>
          </form>

          {/* Variable Picker Sidebar */}
          <PersonalizationSidebar onInsert={handleInsert} tags={tags} onCustomFieldCreated={fetchTags} />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="template-form" isLoading={isSubmitting}>
            {isEditing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
        
        {dropdownOpen && (
          <PersonalizationDropdown
            tags={tags}
            style={dropdownStyle}
            autoFocusSearch={dropdownAutoFocus}
            onInsert={handleInsert}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>
    </div>
  );
};
