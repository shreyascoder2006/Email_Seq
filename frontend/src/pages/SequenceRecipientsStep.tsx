import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Users, UserPlus, Search, ChevronDown, Check
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import type { Sequence, ParsePreviewResult, FieldMapping } from '../types';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { WizardHeader, SequenceSummary } from './SequenceBuilderWizard';
import { MapStage, ReviewStage } from './ImportLists';
import { importService } from '../services/import.service';

export function SequenceRecipientsStep() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Embedded Import State
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'configure' | 'done'>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [listName, setListName] = useState('');

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setImportStage('uploading');
    try {
      const result = await importService.parsePreview(selectedFile);
      setFile(selectedFile);
      setPreview(result);
      setAllRows(result.all_rows ?? []);
      setMappings(result.field_mappings);
      setListName(selectedFile.name.replace(/\.(csv|xlsx|xls)$/i, ''));
      setImportStage('configure');
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to parse file');
      setImportStage('idle');
    }
    // clear input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const seqData = await sequenceService.getWithSteps(id);
      setSequence(seqData.sequence);
    } catch {
      toast.error('Failed to load sequence data');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="flex h-96 items-center justify-center flex-col gap-3">
        <p className="text-gray-500 text-sm">Sequence not found.</p>
        <button
          onClick={() => navigate('/sequences')}
          className="text-indigo-600 text-sm font-medium hover:underline"
        >
          ← Back to Sequences
        </button>
      </div>
    );
  }



  const handleNext = () => {
    navigate(`/sequences/${sequence._id}/recipients/manage`);
  };

  const handleBack = () => {
    navigate(`/sequences/${sequence._id}/builder-v2`);
  };

  const handleToggleStatus = async (isActive: boolean) => {
    if (!sequence) return;
    // Guard: skip no-op transitions to avoid state machine errors
    if (isActive && sequence.status === 'active') return;
    if (!isActive && sequence.status === 'paused') return;
    try {
      if (isActive) {
        const updated = await sequenceService.activate(sequence._id);
        setSequence(updated);
        toast.success('Campaign activated');
      } else {
        const updated = await sequenceService.updateStatus(sequence._id, 'paused');
        setSequence(updated);
        toast.success('Campaign paused');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update campaign status');
    }
  };

  const handleImport = async () => {
    if (!sequence || !file || !preview) return;
    
    const emailMapping = mappings.find(m => m.system_field === 'email');
    if (!emailMapping) {
      toast.error('Email field must be mapped.');
      return;
    }

    setIsSaving(true);
    try {
      // 1. Create List
      const result = await importService.create({
        name: listName.trim() || file.name,
        filename: file.name,
        original_headers: preview.headers,
        field_mappings: mappings,
        rows: allRows,
      });

      // 2. Enroll Contacts
      const enrollRes = await importService.enroll(result.import_list._id, sequence._id);
      
      toast.success(`Imported and enrolled ${enrollRes.enrolled} contacts successfully!`);
      setImportStage('done');
      fetchData(); // Refresh sequence to show updated contacts
      
      // 3. Auto-continue to next step
      setTimeout(() => {
        handleNext();
      }, 1500);
      
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Import failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col">
      <Toaster position="top-right" />

      {/* Header Container */}
        <WizardHeader
          sequence={sequence}
          onBack={() => navigate('/sequences')}
          currentStepId="import-recipients"
          onToggleStatus={handleToggleStatus}
        />

      {/* Body Layout */}
      <div className="flex flex-1 max-w-[1600px] w-full mx-auto gap-6 pb-16 pt-6 px-6">

        {/* Main Content (Left) */}
        <div style={{ flex: '0 0 80%' }} className="flex flex-col gap-8 min-w-0">

          {/* Idle State - Clean Upload UI */}
          {importStage === 'idle' && (
            <div className="flex flex-col items-center justify-center mt-12 bg-white rounded-2xl border border-gray-200 p-12 shadow-sm">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-6">
                <Users className="w-8 h-8 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Import Contacts</h2>
              <p className="text-gray-500 mb-8 text-center max-w-md">
                Upload a CSV file to add recipients to <strong>{sequence.name}</strong>.
              </p>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-indigo-600 text-white font-bold text-[15px] rounded-xl hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2"
              >
                <UserPlus className="w-5 h-5" />
                Select CSV File
              </button>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileSelected}
              />
            </div>
          )}

          {/* Uploading State */}
          {importStage === 'uploading' && (
            <div className="flex flex-col items-center justify-center mt-12 mb-8 bg-white p-12 rounded-2xl shadow-sm border border-gray-200">
              <LoadingSpinner size={40} />
              <p className="text-gray-600 font-medium mt-4">Parsing file…</p>
            </div>
          )}

          {/* Configure Stage (Unified Mapping + Settings) */}
          {importStage === 'configure' && preview && file && (
            <div className="space-y-6">
              
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Map Columns</h2>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Replace File
                  </button>
                  {/* Hidden file input for replace */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                </div>
                
                <MapStage
                  file={file}
                  preview={preview}
                  mappings={mappings}
                  onMappingsChange={setMappings}
                  onNext={() => {}}
                  onBack={() => {}}
                  hideActions={true}
                />
              </div>

              {/* Import Settings & Summary */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col gap-6">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-4">Import Settings</h3>
                  <div className="max-w-md space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">List Name</label>
                      <input 
                        type="text" 
                        value={listName}
                        onChange={(e) => setListName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="e.g. Q3 Outreach List"
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        <Check className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Skip Duplicates</p>
                        <p className="text-xs text-gray-500">Automatically bypass contacts already in this sequence.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between border border-gray-100">
                  <div className="flex gap-6 text-sm">
                    <div>
                      <span className="text-gray-500 font-medium">Total Rows:</span>
                      <span className="ml-2 font-bold text-gray-900">{preview.total_rows}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 font-medium">Mapped Fields:</span>
                      <span className="ml-2 font-bold text-gray-900">{mappings.filter(m => m.system_field !== '__custom__').length}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => { setImportStage('idle'); setFile(null); setPreview(null); }}
                      className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={isSaving || !mappings.some(m => m.system_field === 'email')}
                      className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {isSaving ? <LoadingSpinner size={16} /> : null}
                      {isSaving ? 'Importing...' : `Import ${preview.total_rows} Contacts`}
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Done State */}
          {importStage === 'done' && (
            <div className="flex flex-col items-center justify-center mt-12 mb-8 bg-white p-12 rounded-2xl shadow-sm border border-gray-200">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Import Complete!</h2>
              <p className="text-gray-500 mb-6 text-center max-w-md">
                Contacts successfully imported and enrolled. Moving to the next step...
              </p>
              <LoadingSpinner size={24} />
            </div>
          )}
        </div>

        {/* Sequence Summary (Right - 20%) */}
        <div style={{ flex: '0 0 20%' }} className="shrink-0">
          <SequenceSummary sequence={sequence} />
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
        <div className="max-w-[1600px] mx-auto flex justify-between items-center px-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            Back
          </button>

          <button
            onClick={handleNext}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
