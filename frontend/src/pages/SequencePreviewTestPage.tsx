import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Send, ShieldCheck, Edit2, Users, Calendar, Mail,
  Clock, BarChart2, AlertCircle, Rocket, ChevronLeft,
  ChevronRight, Info, CheckSquare
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import { enrollmentService } from '../services/enrollment.service';
import { templateService } from '../services/template.service';
import { emailAccountService } from '../services/emailAccount.service';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { WizardHeader } from './SequenceBuilderWizard';
import type { Sequence, SequenceStep, Template, EmailConnection, SequenceContact, SequenceIntegrity } from '../types';

// ─── Launch Summary Sidebar ───────────────────────────────────────────────────

function SummaryRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-indigo-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
        {children}
      </div>
    </div>
  );
}

function LaunchSummary({
  sequence, contacts, steps, connections, totalSelected, integrity, onFixIssues
}: {
  sequence: Sequence;
  contacts: SequenceContact[];
  steps: SequenceStep[];
  connections: EmailConnection[];
  totalSelected: number;
  integrity: SequenceIntegrity | null;
  onFixIssues: () => void;
}) {
  const win = sequence.sending_window as any;
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const activeDays: number[] = win?.custom_days ?? win?.days ?? [];
  const fmtTime = (h: number, m: number) => {
    const ampm = h < 12 ? 'AM' : 'PM';
    const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <BarChart2 className="w-5 h-5 text-indigo-600" />
        <h3 className="text-base font-bold text-gray-900">Launch Summary</h3>
      </div>

      <div className="p-5 space-y-5">
        <SummaryRow icon={<Rocket className="w-4 h-4" />} label="Campaign">
          <p className="text-sm font-semibold text-gray-900 truncate">{sequence.name}</p>
        </SummaryRow>

        <SummaryRow icon={<Users className="w-4 h-4" />} label="Recipients">
          <p className="text-sm text-gray-900">{contacts.length} total recipients</p>
          {totalSelected > 0 && (
            <p className="text-xs text-indigo-600 font-medium">{totalSelected} currently selected</p>
          )}
        </SummaryRow>

        {activeDays.length > 0 && (
          <SummaryRow icon={<Calendar className="w-4 h-4" />} label="Schedule">
            <div className="flex flex-wrap gap-1 mb-1">
              {activeDays.map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded">
                  {days[d]}
                </span>
              ))}
            </div>
            {win?.start_hour !== undefined && (
              <p className="text-xs text-gray-600">
                {fmtTime(win.start_hour, win.start_minute ?? 0)} – {fmtTime(win.end_hour, win.end_minute ?? 0)}
              </p>
            )}
            {win?.timezone && <p className="text-xs text-gray-500 mt-0.5">Timezone: {win.timezone}</p>}
          </SummaryRow>
        )}

        <SummaryRow icon={<Mail className="w-4 h-4" />} label="Connected Email Accounts">
          <p className="text-sm text-gray-900">{connections.length} email account{connections.length !== 1 ? 's' : ''} connected</p>
        </SummaryRow>

        <SummaryRow icon={<Clock className="w-4 h-4" />} label="Email Steps">
          <p className="text-sm text-gray-900">{steps.filter(s => s.type === 'email').length} email(s) in this sequence</p>
        </SummaryRow>

        <SummaryRow icon={<ShieldCheck className="w-4 h-4" />} label="Spam Score">
          <span className="text-sm font-semibold text-emerald-600">Good</span>
        </SummaryRow>

        <SummaryRow icon={<BarChart2 className="w-4 h-4" />} label="Inbox Placement">
          <span className="text-sm text-gray-500">Not tested yet</span>
        </SummaryRow>

        {integrity && !integrity.is_valid ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex gap-3">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-900 mb-2">Cannot Launch — Integrity Issues Found</p>
              <ul className="list-disc list-inside text-xs text-red-800 space-y-1">
                {integrity.issues.map((iss, idx) => (
                  <li key={idx}>
                    <strong>{iss.step_id === 'global' ? 'Global' : `Step ${iss.step_index + 1}`}:</strong>{' '}
                    {iss.issues.map(i => i.replace(/_/g, ' ')).join(', ')}
                  </li>
                ))}
              </ul>
              <button
                onClick={onFixIssues}
                className="mt-3 text-red-700 text-xs font-bold underline hover:text-red-900"
              >
                Fix Issues →
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 flex gap-3">
            <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-indigo-900 mb-1">You're almost ready!</p>
              <p className="text-xs text-indigo-700 leading-relaxed">
                Review your email preview, send a test email, and run inbox placement checks before launching your campaign.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Preview Card ─────────────────────────────────────────────────────────────

function getInitials(first: string, last?: string) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';
}

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-sky-100 text-sky-700',
];

function PersonalizedPreviewCard({
  contacts, template, sequenceId
}: {
  contacts: SequenceContact[];
  template: Template | null;
  sequenceId: string;
}) {
  const navigate = useNavigate();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = contacts[selectedIdx];

  const fetchPreview = useCallback(async () => {
    if (!template || !selected) return;
    setLoading(true);
    try {
      const res = await templateService.previewRaw({
        html: template.body_html || '',
        subject: template.subject || '',
      });
      // Client-side replace contact-specific tags
      const vars: Record<string, string> = {
        first_name: selected.contact_first_name || '',
        last_name: selected.contact_last_name || '',
        email: selected.contact_email || '',
        company: selected.contact_company || '',
        company_name: selected.contact_company || '',
      };
      // merge custom_variables if available
      if (selected.custom_variables) {
        const cv = selected.custom_variables as any;
        if (typeof cv === 'object') {
          Object.entries(cv).forEach(([k, v]) => { vars[k] = String(v); });
        }
      }
      const replace = (s: string) =>
        s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, p) => vars[p.toLowerCase()] ?? `[${p}]`);

      setPreviewHtml(replace(res.html));
      setPreviewSubject(replace(res.subject));
    } catch {
      setPreviewHtml(template.body_html || '');
      setPreviewSubject(template.subject || '');
    } finally {
      setLoading(false);
    }
  }, [template, selected]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-base font-bold text-gray-900">Personalized Email Preview</h2>
          <p className="text-xs text-gray-500 mt-0.5">This is how your email will look for the selected recipient.</p>
        </div>
        <button
          onClick={() => navigate(`/sequences/${sequenceId}/builder-v2`)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
        >
          <Edit2 className="w-4 h-4" />
          Edit & Personalize
        </button>
      </div>

      {/* Two-column body */}
      <div className="flex min-h-[480px]">
        {/* Left: Recipient Selector */}
        <div className="w-64 shrink-0 border-r border-gray-100 flex flex-col">
          <p className="text-xs font-semibold text-gray-500 px-4 pt-4 pb-2 uppercase tracking-wide">
            Preview personalization for:
          </p>
          <div className="overflow-y-auto flex-1">
            {contacts.slice(0, 10).map((c, idx) => {
              const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={c._id}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-indigo-50 border-r-2 border-indigo-600' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${colorClass}`}>
                    {getInitials(c.contact_first_name, c.contact_last_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {c.contact_first_name} {c.contact_last_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.contact_email}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Email Preview */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size={24} />
            </div>
          ) : !template ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <AlertCircle className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm font-medium">No template assigned to this sequence.</p>
              <button
                onClick={() => navigate(`/sequences/${sequenceId}/builder-v2`)}
                className="mt-3 text-indigo-600 text-sm font-semibold hover:underline"
              >
                Add an email template →
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4 pb-4 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject:</span>
                <p className="text-sm font-semibold text-gray-900 mt-1">{previewSubject || '(No subject)'}</p>
              </div>
              <div
                className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Launch Confirmation Modal ────────────────────────────────────────────────

function LaunchModal({
  sequence, steps, contacts, onClose, onLaunch, launching
}: {
  sequence: Sequence;
  steps: SequenceStep[];
  contacts: SequenceContact[];
  onClose: () => void;
  onLaunch: () => void;
  launching: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Launch Campaign</h3>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            You are about to launch this sequence. Please confirm before proceeding.
          </p>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 border border-gray-200">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-medium">Recipients</span>
              <span className="font-bold text-gray-900">{contacts.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-medium">Email Steps</span>
              <span className="font-bold text-gray-900">{steps.filter(s => s.type === 'email').length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 font-medium">Daily Cap</span>
              <span className="font-bold text-gray-900">{sequence.daily_sending_limit} emails/day</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Once launched, emails will begin sending during your configured sending window.
          </p>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
          <button
            onClick={onClose}
            disabled={launching}
            className="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onLaunch}
            disabled={launching}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            {launching ? (
              <><LoadingSpinner size={14} /> Launching...</>
            ) : (
              <><Rocket className="w-4 h-4" /> Launch Campaign</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function SequencePreviewTestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [contacts, setContacts] = useState<SequenceContact[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [integrity, setIntegrity] = useState<SequenceIntegrity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [selectedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [seqData, contactsData, accData, templates, integrityData] = await Promise.all([
        sequenceService.getWithSteps(id),
        enrollmentService.listContacts(id, { limit: 100 }),
        emailAccountService.list(),
        templateService.list(),
        sequenceService.getIntegrity(id),
      ]);
      setSequence(seqData.sequence);
      setSteps(seqData.steps);
      setContacts(contactsData.data);
      setConnections(accData);
      setIntegrity(integrityData);

      // Find template from first email step
      const firstEmailStep = seqData.steps.find(s => s.type === 'email');
      if (firstEmailStep?.template_id) {
        const tpl = templates.find(t => t._id === firstEmailStep.template_id);
        setTemplate(tpl || null);
      } else if (templates.length > 0) {
        setTemplate(templates[0]);
      }
    } catch {
      toast.error('Failed to load preview data');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleLaunch = async () => {
    if (!sequence) return;
    setLaunching(true);
    try {
      await sequenceService.activate(sequence._id);
      toast.success('Campaign launched successfully!');
      setShowLaunchModal(false);
      navigate('/sequences');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to launch campaign');
    } finally {
      setLaunching(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-3">
        <p className="text-gray-500 text-sm">Sequence not found.</p>
        <button onClick={() => navigate('/sequences')} className="text-indigo-600 text-sm font-medium hover:underline">
          ← Back to Sequences
        </button>
      </div>
    );
  }

  const senderEmail = (() => {
    const active = connections.find(c => c.status === 'active');
    return active?.from_email ?? connections[0]?.from_email ?? '';
  })();

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col pb-20">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="max-w-[1600px] w-full mx-auto px-6 pt-6">
        <WizardHeader
          sequence={sequence}
          stepCount={steps.length}
          senderEmail={senderEmail}
          onBack={() => navigate('/sequences')}
          activeStepIdx={3}
        />
      </div>

      {/* Top: Total Recipients + Action Buttons */}
      <div className="max-w-[1600px] w-full mx-auto px-6 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Total Recipients: <span className="text-indigo-600">{contacts.length}</span>
              <button className="ml-1 text-gray-400 hover:text-gray-600 inline-flex">
                <Info className="w-4 h-4" />
              </button>
            </h2>
            {selectedIds.size > 0 && (
              <p className="text-sm text-gray-500 mt-0.5">{selectedIds.size} currently selected</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => toast('Coming Soon', { icon: '🚧' })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
              Send Test Email
            </button>
            <button
              onClick={() => toast('Coming Soon', { icon: '🚧' })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              <ShieldCheck className="w-4 h-4" />
              Inbox Placement Test
            </button>
          </div>
        </div>
      </div>

      {/* Body: Two-column grid */}
      <div className="max-w-[1600px] w-full mx-auto px-6 flex gap-6 items-start">
        {/* Left (main) */}
        <div className="flex-1 min-w-0">
          <PersonalizedPreviewCard
            contacts={contacts}
            template={template}
            sequenceId={sequence._id}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-[340px] shrink-0">
          <LaunchSummary
            sequence={sequence}
            contacts={contacts}
            steps={steps}
            connections={connections}
            totalSelected={selectedIds.size}
            integrity={integrity}
            onFixIssues={() => navigate(`/sequences/${sequence._id}/builder-v2`)}
          />
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30 shadow-lg">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          {/* Left: Stats */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-700">
              Total Recipients: <strong className="text-gray-900">{contacts.length}</strong>
            </span>
            {selectedIds.size > 0 && (
              <>
                <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg">
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-700">{selectedIds.size} Selected</span>
                </div>
                <span className="text-xs text-gray-400 hidden sm:block">
                  Showing 1–{selectedIds.size} of {selectedIds.size} selected recipients
                </span>
              </>
            )}
          </div>

          {/* Center: Pagination */}
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 disabled:opacity-40" disabled>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="min-w-[32px] h-8 flex items-center justify-center rounded-lg bg-indigo-600 text-white text-sm font-bold shadow-sm">
              1
            </span>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 disabled:opacity-40" disabled>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/sequences/${sequence._id}/recipients/manage`)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Save as Draft
            </button>
            <button
              onClick={() => setShowLaunchModal(true)}
              disabled={integrity !== null && !integrity.is_valid}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Rocket className="w-4 h-4" />
              {integrity && !integrity.is_valid ? 'Cannot Launch — Fix Issues' : 'Launch Campaign'}
            </button>
          </div>
        </div>
      </div>

      {/* Launch Modal */}
      {showLaunchModal && (
        <LaunchModal
          sequence={sequence}
          steps={steps}
          contacts={contacts}
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunch}
          launching={launching}
        />
      )}
    </div>
  );
}
