import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Users, Trash2, ChevronDown, Tag, FileText, Copy, Settings } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { importService } from '../services/import.service';
import { sequenceService } from '../services/sequence.service';
import type { FieldMapping, ImportList, ParsePreviewResult, Sequence } from '../types';

// ─── System field options ───────────────────────────────────────────
const SYSTEM_FIELD_OPTIONS = [
  { value: 'email',      label: 'Email *',     is_system: true },
  { value: 'first_name', label: 'First Name',  is_system: true },
  { value: 'last_name',  label: 'Last Name',   is_system: true },
  { value: 'company',    label: 'Company',     is_system: true },
  { value: '__custom__', label: '— Custom Field —', is_system: false },
];

type Stage = 'upload' | 'map' | 'review';

// ─── Stage 1: Upload ───────────────────────────────────────────────
function UploadStage({ onParsed }: { onParsed: (file: File, result: ParsePreviewResult) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    const valid = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!valid) { toast.error('Only CSV and XLSX files are supported'); return; }
    setIsParsing(true);
    try {
      const result = await importService.parsePreview(file);
      onParsed(file, result);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to parse file');
    } finally { setIsParsing(false); }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => !isParsing && inputRef.current?.click()}
        className={`relative w-full max-w-2xl border-2 border-dashed rounded-2xl p-16 flex flex-col items-center gap-4 cursor-pointer transition-all duration-200 ${
          isDragging ? 'border-indigo-500 bg-indigo-50 scale-[1.01]' : 'border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50'
        }`}
      >
        {isParsing ? (
          <><LoadingSpinner size={40} /><p className="text-gray-600 font-medium">Parsing file…</p></>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center">
              <Upload className="w-8 h-8 text-indigo-600" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">Drop your file here</p>
              <p className="text-sm text-gray-500 mt-1">or click to browse · CSV and XLSX supported · Max 20 MB</p>
            </div>
            <div className="flex gap-2 mt-2">
              {['CSV', 'XLSX'].map(f => (
                <span key={f} className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600">{f}</span>
              ))}
            </div>
          </>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      </div>
    </div>
  );
}

// ─── Stage 2: Map Fields ───────────────────────────────────────────
export function MapStage({
  file, preview, mappings, onMappingsChange, onNext, onBack,
}: {
  file: File;
  preview: ParsePreviewResult;
  mappings: FieldMapping[];
  onMappingsChange: (m: FieldMapping[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const hasEmail = mappings.some(m => m.system_field === 'email');

  const updateMapping = (idx: number, systemField: string) => {
    const updated = mappings.map((m, i) => {
      if (i !== idx) return m;
      const sysOpt = SYSTEM_FIELD_OPTIONS.find(o => o.value === systemField);
      const key = systemField === '__custom__' ? m.system_field : systemField;
      return {
        ...m,
        system_field: key,
        merge_tag: `{{${key}}}`,
        is_system: sysOpt?.is_system ?? false,
      };
    });
    onMappingsChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* File info */}
      <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl">
        <FileText className="w-5 h-5 text-indigo-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-indigo-900 truncate">{file.name}</p>
          <p className="text-xs text-indigo-600">{preview.total_rows} rows · {preview.headers.length} columns</p>
        </div>
        {!hasEmail && (
          <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium">
            <AlertCircle className="w-4 h-4" /><span>Map an email column</span>
          </div>
        )}
      </div>

      {/* Mapping table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div className="col-span-3">CSV Column</div>
          <div className="col-span-3">Sample Values</div>
          <div className="col-span-3">→ System Field</div>
          <div className="col-span-3">Merge Tag</div>
        </div>
        <div className="divide-y divide-gray-100">
          {mappings.map((m, idx) => {
            const samples = preview.preview_rows.slice(0, 3).map(r => r[m.csv_column]).filter(Boolean);
            const currentOpt = SYSTEM_FIELD_OPTIONS.find(o => o.value === m.system_field) ? m.system_field : (m.is_system ? m.system_field : '__custom__');
            return (
              <div key={idx} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="col-span-3">
                  <span className="font-mono text-sm font-medium text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{m.csv_column}</span>
                </div>
                <div className="col-span-3 space-y-0.5">
                  {samples.length ? samples.map((s, i) => (
                    <p key={i} className="text-xs text-gray-500 truncate">{s}</p>
                  )) : <span className="text-xs text-gray-400 italic">—</span>}
                </div>
                <div className="col-span-3">
                  <select
                    value={currentOpt}
                    onChange={(e) => updateMapping(idx, e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {SYSTEM_FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <code className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{m.merge_tag}</code>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview table */}
      {preview.preview_rows.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Data Preview (first 5 rows)</h4>
          <div className="border border-gray-200 rounded-xl overflow-x-auto">
            <table className="min-w-full text-xs divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>{preview.headers.map(h => <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.preview_rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {preview.headers.map(h => <td key={h} className="px-3 py-2 text-gray-700 truncate max-w-[150px]">{row[h] || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} icon={<ArrowLeft className="w-4 h-4" />}>Back</Button>
        <Button onClick={onNext} disabled={!hasEmail} icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
          Review & Import
        </Button>
      </div>
    </div>
  );
}

// ─── Stage 3: Review & Import ──────────────────────────────────────
export function ReviewStage({
  file, preview, mappings, allRows, onBack, onImported, autoEnrollSequenceId
}: {
  file: File;
  preview: ParsePreviewResult;
  mappings: FieldMapping[];
  allRows: Record<string, string>[];
  onBack: () => void;
  onImported: () => void;
  autoEnrollSequenceId?: string;
}) {
  const [listName, setListName]           = useState(file.name.replace(/\.(csv|xlsx|xls)$/i, ''));
  const [isSaving, setIsSaving]           = useState(false);
  const [sequences, setSequences]         = useState<Sequence[]>([]);
  const [selectedSeq, setSelectedSeq]     = useState('');
  const [isEnrolling, setIsEnrolling]     = useState(false);
  const [savedListId, setSavedListId]     = useState<string | null>(null);
  const [enrollResult, setEnrollResult]   = useState<any>(null);

  // Compute stats from preview
  const emailMapping = mappings.find(m => m.system_field === 'email');
  const emailCol = emailMapping?.csv_column;
  const emails = emailCol ? preview.preview_rows.map(r => r[emailCol]?.toLowerCase()).filter(Boolean) : [];
  const dupSet = new Set(emails.filter((e, i, arr) => arr.indexOf(e) !== i));

  useEffect(() => {
    sequenceService.list({ limit: 100 }).then(data => {
      const active = (data.data || []).filter((s: Sequence) => s.status === 'active');
      setSequences(active);
    }).catch(() => {});
  }, []);

  const handleImport = async () => {
    setIsSaving(true);
    try {
      const result = await importService.create({
        name: listName.trim() || file.name,
        filename: file.name,
        original_headers: preview.headers,
        field_mappings: mappings,
        rows: allRows,
      });
      setSavedListId(result.import_list._id);

      if (autoEnrollSequenceId) {
        setIsEnrolling(true);
        try {
          const enrollRes = await importService.enroll(result.import_list._id, autoEnrollSequenceId);
          setEnrollResult(enrollRes);
          toast.success(`Imported and enrolled ${enrollRes.enrolled} contacts successfully`);
        } catch (err: any) {
          toast.error(err.response?.data?.error?.message || 'Imported successfully, but enrollment failed');
        } finally {
          setIsEnrolling(false);
        }
      } else {
        toast.success(`Imported ${result.valid} contacts successfully`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Import failed');
    } finally { setIsSaving(false); }
  };

  const handleEnroll = async () => {
    if (!savedListId || !selectedSeq) return;
    setIsEnrolling(true);
    try {
      const result = await importService.enroll(savedListId, selectedSeq);
      setEnrollResult(result);
      toast.success(`Enrolled ${result.enrolled} contacts into sequence`);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Enrollment failed');
    } finally { setIsEnrolling(false); }
  };

  return (
    <div className="space-y-6">
      {/* List name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Import List Name</label>
        <input
          value={listName}
          onChange={e => setListName(e.target.value)}
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="My Contact List"
          disabled={!!savedListId}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Rows', value: preview.total_rows, color: 'blue' },
          { label: 'Columns', value: preview.headers.length, color: 'purple' },
          { label: 'Duplicates (preview)', value: dupSet.size, color: 'yellow' },
          { label: 'Mapped Fields', value: mappings.length, color: 'green' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Merge tags summary */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Tag className="w-4 h-4 text-indigo-600" />Auto-Generated Merge Tags
        </h4>
        <div className="flex flex-wrap gap-2">
          {mappings.map(m => (
            <code key={m.csv_column} className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded">
              {m.merge_tag}
            </code>
          ))}
        </div>
      </div>

      {/* Actions */}
      {!savedListId ? (
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack} icon={<ArrowLeft className="w-4 h-4" />}>Back</Button>
          <Button onClick={handleImport} isLoading={isSaving}>Import List</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-sm font-medium text-green-800">Import saved successfully!</p>
          </div>

          {!enrollResult ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <h4 className="text-sm font-semibold text-gray-800">Enroll in a Sequence (optional)</h4>
              <select
                value={selectedSeq}
                onChange={e => setSelectedSeq(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select an active sequence —</option>
                {sequences.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              <div className="flex gap-3">
                <Button variant="outline" onClick={onImported} className="flex-1">Done</Button>
                <Button onClick={handleEnroll} isLoading={isEnrolling} disabled={!selectedSeq} className="flex-1">
                  Enroll Contacts
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Enrolled', value: enrollResult.enrolled, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
                { label: 'Skipped', value: enrollResult.skipped, color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
                { label: 'Failed', value: enrollResult.failed, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
              ].map(s => (
                <div key={s.label} className={`border rounded-xl p-4 text-center ${s.bg}`}>
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-600 mt-1">{s.label}</p>
                </div>
              ))}
              <div className="col-span-3"><Button onClick={onImported} className="w-full">Done</Button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Clone List Modal ────────────────────────────────────────────────
function CloneListModal({ list, onClose, onCloneSuccess }: { list: ImportList; onClose: () => void; onCloneSuccess: () => void }) {
  const [isCloning, setIsCloning] = useState(false);

  const handleClone = async () => {
    setIsCloning(true);
    try {
      const res = await importService.clone(list._id);
      toast.success(`List cloned successfully. Copied ${res.copied_count} contacts.`);
      onCloneSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to clone list');
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Clone List</h3>
          
          <div className="space-y-2 mb-4 text-sm">
            <p className="text-gray-700">
              <span className="font-medium text-gray-500">List:</span> <span className="font-semibold text-gray-900">{list.name}</span>
            </p>
            <p className="text-gray-700">
              <span className="font-medium text-gray-500">Contacts:</span> <span className="font-semibold text-gray-900">{list.row_count.toLocaleString()}</span>
            </p>
          </div>

          <p className="text-sm text-gray-600 mb-6">
            This will create a duplicate list with all contacts and field mappings.
          </p>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={isCloning}>Cancel</Button>
            <Button onClick={handleClone} isLoading={isCloning} icon={<Copy className="w-4 h-4" />}>Clone</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── List Settings Modal ──────────────────────────────────────────────
function ListSettingsModal({ list, onClose, onSaveSuccess }: { list: ImportList; onClose: () => void; onSaveSuccess: () => void }) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setIsSaving(true);
    try {
      await importService.updateSettings(list._id, { name: name.trim(), description: description.trim() });
      toast.success('List settings updated successfully');
      onSaveSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">List Settings</h3>
            <button onClick={onClose} disabled={isSaving} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="My Contact List"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[80px]"
                placeholder="Optional description for this list..."
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSave} isLoading={isSaving}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import List Item ──────────────────────────────────────────────
function ImportListItem({ list, onDelete, onCloneRequest, onSettingsRequest }: { list: ImportList; onDelete: (id: string) => void; onCloneRequest: (list: ImportList) => void; onSettingsRequest: (list: ImportList) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-indigo-200 transition-colors">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Users className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{list.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{list.filename} · {new Date(list.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-6 text-center">
          <div><p className="text-lg font-bold text-gray-900">{list.row_count}</p><p className="text-xs text-gray-500">Total</p></div>
          <div><p className="text-lg font-bold text-green-600">{list.valid_count}</p><p className="text-xs text-gray-500">Valid</p></div>
          <div><p className="text-lg font-bold text-yellow-600">{list.duplicate_count}</p><p className="text-xs text-gray-500">Dupes</p></div>
          <div><p className="text-lg font-bold text-red-500">{list.error_count}</p><p className="text-xs text-gray-500">Errors</p></div>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <button onClick={() => onSettingsRequest(list)} title="List Settings" className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={() => onCloneRequest(list)} title="Clone List" className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={() => setExpanded(v => !v)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button onClick={() => onDelete(list._id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-4">
          {list.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</p>
              <p className="text-sm text-gray-700">{list.description}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Merge Tags from this list</p>
            <div className="flex flex-wrap gap-2">
              {list.field_mappings.map(m => (
                <code key={m.csv_column} className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded">
                  {m.merge_tag}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────
export const ImportLists: React.FC = () => {
  const [stage, setStage]           = useState<Stage>('upload');
  const [file, setFile]             = useState<File | null>(null);
  const [preview, setPreview]       = useState<ParsePreviewResult | null>(null);
  const [allRows, setAllRows]       = useState<Record<string, string>[]>([]);
  const [mappings, setMappings]     = useState<FieldMapping[]>([]);
  const [lists, setLists]           = useState<ImportList[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [listToClone, setListToClone] = useState<ImportList | null>(null);
  const [listToEdit, setListToEdit] = useState<ImportList | null>(null);

  const fetchLists = async () => {
    try {
      setIsLoading(true);
      const data = await importService.list();
      setLists(data);
    } catch { toast.error('Failed to load import lists'); }
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    fetchLists();
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === 'true') {
      setShowWizard(true);
      setStage('upload');
      // Clean up URL
      window.history.replaceState({}, '', '/import-lists');
    }
  }, []);

  const handleParsed = (f: File, result: ParsePreviewResult) => {
    setFile(f);
    setPreview(result);
    setAllRows(result.all_rows ?? []);
    setMappings(result.field_mappings);
    setStage('map');
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this import list and all its contacts?')) return;
    try {
      await importService.delete(id);
      toast.success('Import list deleted');
      fetchLists();
    } catch { toast.error('Failed to delete'); }
  };

  const resetWizard = () => {
    setStage('upload'); setFile(null); setPreview(null); setMappings([]); setAllRows([]);
    setShowWizard(false); fetchLists();
  };

  const STAGE_LABELS: Record<Stage, string> = { upload: 'Upload File', map: 'Map Fields', review: 'Review & Import' };
  const STAGES: Stage[] = ['upload', 'map', 'review'];

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Import Lists</h2>
          <p className="text-gray-500">Import contacts from CSV or XLSX files and enroll them into sequences.</p>
        </div>
        <Button onClick={() => { setShowWizard(true); setStage('upload'); }} icon={<Upload className="w-4 h-4" />}>
          Import Contacts
        </Button>
      </div>

      {/* Wizard */}
      {showWizard && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Stage indicator */}
          <div className="flex border-b border-gray-200">
            {STAGES.map((s, i) => {
              const stageIdx = STAGES.indexOf(stage);
              const done = i < stageIdx;
              const active = s === stage;
              return (
                <div key={s} className={`flex-1 flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${active ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : done ? 'text-green-700' : 'text-gray-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-indigo-600 text-white' : done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  {STAGE_LABELS[s]}
                </div>
              );
            })}
            <button onClick={resetWizard} className="px-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-8">
            {stage === 'upload' && <UploadStage onParsed={handleParsed} />}
            {stage === 'map' && preview && file && (
              <MapStage
                file={file} preview={preview} mappings={mappings}
                onMappingsChange={setMappings}
                onNext={() => setStage('review')}
                onBack={() => setStage('upload')}
              />
            )}
            {stage === 'review' && preview && file && (
              <ReviewStage
                file={file} preview={preview} mappings={mappings} allRows={allRows}
                onBack={() => setStage('map')}
                onImported={resetWizard}
              />
            )}
          </div>
        </div>
      )}

      {/* List of imports */}
      {isLoading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size={32} /></div>
      ) : lists.length === 0 && !showWizard ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-semibold text-gray-700">No import lists yet</p>
          <p className="text-sm text-gray-500 mt-1 mb-6">Upload a CSV or XLSX file to get started</p>
          <Button variant="outline" onClick={() => setShowWizard(true)}>Import your first list</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map(list => (
            <ImportListItem key={list._id} list={list} onDelete={handleDelete} onCloneRequest={setListToClone} onSettingsRequest={setListToEdit} />
          ))}
        </div>
      )}

      {/* Modals */}
      {listToClone && (
        <CloneListModal
          list={listToClone}
          onClose={() => setListToClone(null)}
          onCloneSuccess={() => {
            setListToClone(null);
            fetchLists();
          }}
        />
      )}

      {listToEdit && (
        <ListSettingsModal
          list={listToEdit}
          onClose={() => setListToEdit(null)}
          onSaveSuccess={() => {
            setListToEdit(null);
            fetchLists();
          }}
        />
      )}
    </div>
  );
};
