import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { templateService } from '../../services/template.service';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: string | null;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen,
  onClose,
  templateId,
}) => {
  const [html, setHtml] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && templateId) {
      const loadPreview = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const result = await templateService.preview(templateId);
          setHtml(result.html);
          setSubject(result.subject);
        } catch (err: any) {
          setError(err.response?.data?.message || 'Failed to load preview');
        } finally {
          setIsLoading(false);
        }
      };
      loadPreview();
    } else {
      setHtml('');
      setSubject('');
    }
  }, [isOpen, templateId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Preview Template
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner size={32} />
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">
              {error}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-500">Subject:</span>
                  <span className="text-sm font-semibold text-gray-900">{subject}</span>
                </div>
              </div>
              <div className="p-6 text-gray-800">
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};
