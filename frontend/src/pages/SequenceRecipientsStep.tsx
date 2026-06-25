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
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'map' | 'review' | 'done'>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

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
      setImportStage('map');
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

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col p-6">
      <Toaster position="top-right" />

      {/* Header Container */}
      <div className="max-w-[1600px] w-full mx-auto">
        <WizardHeader
          sequence={sequence}
          onBack={() => navigate('/sequences')}
          currentStepId="import-recipients"
          onToggleStatus={handleToggleStatus}
        />
      </div>

      {/* Body Layout */}
      <div className="flex flex-1 max-w-[1600px] w-full mx-auto gap-6 pb-16">

        {/* Main Content (Left) */}
        <div style={{ flex: '0 0 80%' }} className="flex flex-col gap-8 min-w-0">

          {/* ── 3-Circle Progress Flow (matches reference screenshot exactly) ── */}
          <div className="flex items-start justify-center pt-10">
            <div className="flex items-start gap-0">

              {/* Step 1: Add Recipients (active — filled purple) */}
              <div className="flex flex-col items-center" style={{ width: 120 }}>
                <div className="w-16 h-16 rounded-full border-2 border-[#5B4CFF] bg-white flex items-center justify-center shadow-sm">
                  <UserPlus className="w-7 h-7 text-[#5B4CFF]" strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-bold text-[#5B4CFF] mt-3 text-center leading-snug">Add Recipients</p>
              </div>

              {/* Dashed connector */}
              <div className="flex-1 flex items-center" style={{ marginTop: 30, minWidth: 80 }}>
                <div className="w-full border-t-2 border-dashed border-gray-300" />
              </div>

              {/* Step 2: Email Steps (inactive) */}
              <div className="flex flex-col items-center" style={{ width: 120 }}>
                <div className="w-16 h-16 rounded-full border-2 border-gray-200 bg-white flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <p className="text-[13px] font-semibold text-gray-400 mt-3 text-center leading-snug">Email Steps</p>
              </div>

              {/* Dashed connector */}
              <div className="flex-1 flex items-center" style={{ marginTop: 30, minWidth: 80 }}>
                <div className="w-full border-t-2 border-dashed border-gray-300" />
              </div>

              {/* Step 3: Launch Sequence (inactive) */}
              <div className="flex flex-col items-center" style={{ width: 120 }}>
                <div className="w-16 h-16 rounded-full border-2 border-gray-200 bg-white flex items-center justify-center shadow-sm">
                  <svg className="w-7 h-7 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                  </svg>
                </div>
                <p className="text-[13px] font-semibold text-gray-400 mt-3 text-center leading-snug">Launch Sequence</p>
              </div>

            </div>
          </div>

          {/* ── 3-Card Info Row ── */}
          <div className="flex items-center justify-center">
            <div className="flex items-stretch gap-4">

              {/* Card 1 */}
              <div className="w-[220px] flex items-start gap-3 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-[#F4F2FA] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[#5B4CFF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="4" rx="1" /><rect x="3" y="10" width="7" height="11" rx="1" />
                    <rect x="13" y="3" width="8" height="11" rx="1" /><rect x="13" y="17" width="8" height="4" rx="1" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-[13px] font-bold text-gray-900">Import Contacts</h4>
                  <p className="text-[11.5px] text-gray-500 mt-0.5 leading-snug">Upload a CSV file with your prospect list.</p>
                </div>
              </div>

              <ArrowRight className="w-5 h-5 text-[#5B4CFF] self-center shrink-0" />

              {/* Card 2 */}
              <div className="w-[220px] flex items-start gap-3 p-4 rounded-2xl border-2 border-[#5B4CFF]/20 bg-[#F7F6FF] shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-white border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm">
                  <Search className="w-5 h-5 text-[#5B4CFF]" />
                </div>
                <div>
                  <h4 className="text-[13px] font-bold text-[#5B4CFF]">Choose Recipients</h4>
                  <p className="text-[11.5px] text-indigo-500/70 mt-0.5 leading-snug">Select contacts from your saved searches.</p>
                </div>
              </div>

              <ArrowRight className="w-5 h-5 text-[#5B4CFF] self-center shrink-0" />

              {/* Card 3 */}
              <div className="w-[220px] flex items-start gap-3 p-4 rounded-2xl border border-emerald-200 bg-[#F0FDF4] shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-white border border-emerald-100 flex items-center justify-center shrink-0 shadow-sm">
                  <Users className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-[13px] font-bold text-emerald-800">Ready to Launch</h4>
                  <p className="text-[11.5px] text-emerald-700/70 mt-0.5 leading-snug">Proceed to set up your email steps and launch sequence.</p>
                </div>
              </div>

            </div>
          </div>

          {/* Center Call to Action Area */}
          {importStage === 'idle' && (
            <div className="flex flex-col items-center mt-12 mb-8">
              <h2 className="text-[24px] font-bold text-gray-900 mb-6">Let's add recipients to your sequence</h2>

              <div className="w-full max-w-[480px] relative group">
                <button
                  className="w-full h-12 flex items-center justify-between px-6 rounded-xl text-white font-bold text-[15px] shadow-md transition-all z-20 relative hover:shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #5B4CFF, #6C63FF)' }}
                >
                  <div className="flex items-center gap-2">
                    <span>+ Add Recipients</span>
                  </div>
                  <ChevronDown className="w-5 h-5" />
                </button>

                {/* Dropdown Card */}
                <div className="absolute top-14 left-0 w-full bg-white rounded-2xl border border-gray-200 shadow-xl p-2 z-10">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-start gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#F4F2FA] shrink-0">
                      <UserPlus className="w-5 h-5 text-[#5B4CFF]" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-gray-900 mb-0.5">Import from CSV</h4>
                      <p className="text-[12px] text-gray-500">Upload a CSV file to add recipients.</p>
                    </div>
                  </button>

                  <div className="h-px bg-gray-100 mx-4 my-1" />

                  <button
                    className="w-full flex items-start gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 shrink-0">
                      <Search className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-gray-900 mb-0.5 flex items-center gap-2">
                        Add from Saved Searches
                        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Coming soon</span>
                      </h4>
                      <p className="text-[12px] text-gray-500">Choose from your saved prospect searches.</p>
                    </div>
                  </button>
                </div>
              </div>

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

          {/* Map Stage */}
          {importStage === 'map' && preview && file && (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Map Columns</h2>
              <MapStage
                file={file}
                preview={preview}
                mappings={mappings}
                onMappingsChange={setMappings}
                onNext={() => setImportStage('review')}
                onBack={() => { setImportStage('idle'); setFile(null); setPreview(null); }}
              />
            </div>
          )}

          {/* Review Stage */}
          {importStage === 'review' && preview && file && (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Review & Import</h2>
              <ReviewStage
                file={file}
                preview={preview}
                mappings={mappings}
                allRows={allRows}
                autoEnrollSequenceId={sequence._id}
                onBack={() => setImportStage('map')}
                onImported={() => {
                  setImportStage('done');
                  fetchData(); // Refresh sequence to show updated contacts
                }}
              />
            </div>
          )}

          {/* Done State */}
          {importStage === 'done' && (
            <div className="flex flex-col items-center justify-center mt-12 mb-8 bg-white p-12 rounded-2xl shadow-sm border border-gray-200">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Import Complete!</h2>
              <p className="text-gray-500 mb-6 text-center max-w-md">Your contacts have been successfully imported and enrolled into the sequence.</p>
              <button
                onClick={() => setImportStage('idle')}
                className="px-6 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
              >
                Import More Contacts
              </button>
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
