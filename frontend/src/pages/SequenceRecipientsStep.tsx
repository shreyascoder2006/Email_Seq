import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Users, UserPlus, Search, ChevronDown, Check
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import { emailAccountService } from '../services/emailAccount.service';
import type { Sequence, EmailConnection, ParsePreviewResult, FieldMapping } from '../types';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { WizardHeader, SequenceSummary } from './SequenceBuilderWizard';
import { MapStage, ReviewStage } from './ImportLists';
import { importService } from '../services/import.service';

export function SequenceRecipientsStep() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
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
      const [seqData, accData] = await Promise.all([
        sequenceService.getWithSteps(id),
        emailAccountService.list(),
      ]);
      setSequence(seqData.sequence);
      setConnections(accData);
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

  const senderEmail = (() => {
    const active = connections.find(c => c.status === 'active');
    return active?.from_email ?? connections[0]?.from_email ?? '';
  })();

  const handleNext = () => {
    navigate(`/sequences/${sequence._id}/recipients/manage`);
  };

  const handleBack = () => {
    navigate(`/sequences/${sequence._id}/builder-v2`);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col p-6">
      <Toaster position="top-right" />

      {/* Header Container */}
      <div className="max-w-[1600px] w-full mx-auto">
        <WizardHeader
          sequence={sequence}
          stepCount={sequence.step_count || 1}
          senderEmail={senderEmail}
          onBack={() => navigate('/sequences')}
          activeStepIdx={2} // 0: Schedule, 1: Sequence, 2: Recipients, 3: Preview
        />
      </div>

      {/* Body Layout */}
      <div className="flex flex-1 max-w-[1600px] w-full mx-auto gap-6 pb-16">

        {/* Main Content (Left) */}
        <div style={{ flex: '0 0 80%' }} className="flex flex-col gap-8 min-w-0">

          {/* Progress Journey */}
          <div className="flex items-center justify-center pt-8">
            <div className="flex items-center gap-4">

              {/* Card 1: Import Contacts */}
              <div className="w-[280px] p-5 rounded-2xl border border-[#D9D6FE] bg-white flex items-start gap-4 shadow-sm relative z-10">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#F4F2FA] shrink-0">
                  <UserPlus className="w-5 h-5 text-[#5B4CFF]" />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-gray-900 mb-1">Import Contacts</h3>
                  <p className="text-[12px] text-gray-500 leading-snug">Upload a CSV file with your prospect list.</p>
                </div>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-5 h-5 text-[#5B4CFF] -ml-2 -mr-2 relative z-0" />

              {/* Card 2: Choose Recipients */}
              <div className="w-[280px] p-5 rounded-2xl border border-blue-200 bg-[#F4F8FF] flex items-start gap-4 shadow-sm relative z-10">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white shrink-0 shadow-sm border border-blue-100">
                  <Search className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-blue-900 mb-1">Choose Recipients</h3>
                  <p className="text-[12px] text-blue-700/80 leading-snug">Select contacts from your saved searches.</p>
                </div>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-5 h-5 text-[#5B4CFF] -ml-2 -mr-2 relative z-0" />

              {/* Card 3: Ready To Launch */}
              <div className="w-[280px] p-5 rounded-2xl border border-emerald-200 bg-[#F2FCF5] flex items-start gap-4 shadow-sm relative z-10">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white shrink-0 shadow-sm border border-emerald-100">
                  <Users className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-emerald-900 mb-1">Ready to Launch</h3>
                  <p className="text-[12px] text-emerald-700/80 leading-snug">Proceed to set up your email steps and launch sequence.</p>
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
