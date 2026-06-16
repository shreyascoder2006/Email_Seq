import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Edit2, Trash2, Eye } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { TemplateModal } from '../components/template/TemplateModal';
import { PreviewModal } from '../components/template/PreviewModal';
import { templateService } from '../services/template.service';
import type { Template, CreateTemplateDto, UpdateTemplateDto } from '../types';

export const Templates: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await templateService.list();
      setTemplates(data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (template: Template) => {
    setEditingTemplate(template);
    setIsModalOpen(true);
  };

  const handleOpenPreview = (id: string) => {
    setPreviewId(id);
    setIsPreviewOpen(true);
  };

  const handleSubmit = async (data: CreateTemplateDto | UpdateTemplateDto) => {
    try {
      if (editingTemplate) {
        await templateService.update(editingTemplate._id, data);
        toast.success('Template updated successfully');
      } else {
        await templateService.create(data as CreateTemplateDto);
        toast.success('Template created successfully');
      }
      setIsModalOpen(false);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save template');
      throw err; // throw to keep modal open
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }
    try {
      await templateService.delete(id);
      toast.success('Template deleted');
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete template');
    }
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Email Templates</h2>
          <p className="text-gray-500">Manage your reusable email templates.</p>
        </div>
        <Button onClick={handleOpenCreate}>Create Template</Button>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchTemplates}>Try Again</Button>
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200">
          <LoadingSpinner size={32} />
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
          <EmptyState
            icon={FileText}
            title="No templates found"
            description="Create templates to quickly reuse content across your sequences."
            action={<Button variant="outline" onClick={handleOpenCreate}>Create your first template</Button>}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Template Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {templates.map((template) => (
                  <tr key={template._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{template.name}</div>
                          {template.category && <div className="text-xs text-gray-500 mt-0.5 uppercase tracking-wide">{template.category.replace('_', ' ')}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs truncate">{template.subject}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(template.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(template.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleOpenPreview(template._id)} className="p-2 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors" title="Preview Template">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleOpenEdit(template)} className="p-2 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors" title="Edit Template">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(template._id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors" title="Delete Template">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TemplateModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        initialData={editingTemplate}
      />

      <PreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        templateId={previewId}
      />
    </div>
  );
};
