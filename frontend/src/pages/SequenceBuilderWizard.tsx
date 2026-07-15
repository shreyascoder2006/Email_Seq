import React, { useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mail, Clock, ChevronDown,
  Calendar, Users, Zap, Eye, FileText,
  Wand2, ShieldCheck, User, Info, BarChart2, AlertCircle, Sparkles, Lightbulb, X, Send
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import { templateService } from '../services/template.service';
import { emailAccountService } from '../services/emailAccount.service';
import { aiWriterService } from '../services/aiWriter.service';
import { RichTextEditor } from '../components/editor/RichTextEditor';
import { PersonalizationDropdown } from '../components/personalization/PersonalizationDropdown';
import type { MergeTag } from '../components/personalization/PersonalizationSidebar';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { SequenceStateToggle } from '../components/sequences/SequenceStateToggle';
import type { Sequence, SequenceStep, Template, EmailConnection, SequenceIntegrity, StepIntegrityIssue } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type EditorTab = 'emailSetup' | 'aiWriter' | 'emailTemplates' | 'spamChecker';

interface PhaseCardData {
  id: string;
  stepNumber: number;
  name: string;
  delayLabel: string;
  isDefault?: boolean;
  step?: SequenceStep;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDelayLabel(step: SequenceStep): string {
  if (step.delay_days === 0 && step.delay_hours === 0) return 'Send Immediately';
  const parts: string[] = [];
  if (step.delay_days > 0) parts.push(`Wait ${step.delay_days} Day${step.delay_days !== 1 ? 's' : ''}`);
  if (step.delay_hours > 0) parts.push(`${step.delay_hours} Hour${step.delay_hours !== 1 ? 's' : ''}`);
  return parts.join(' + ');
}

function getPhaseNameForIndex(index: number): string {
  const names = ['Cold Email', 'Follow Up 1', 'Follow Up 2', 'Final Follow Up'];
  return names[index] ?? `Step ${index + 1}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

import { SequenceWorkflowStepper, type WorkflowStepId } from '../components/sequences/SequenceWorkflowStepper';

export interface WizardHeaderProps {
  sequence: Sequence;
  onBack: () => void;
  onNext?: () => void;
  currentStepId?: WorkflowStepId;
  onToggleStatus?: (isActive: boolean) => void;
}

export function WizardHeader({ sequence, onBack, onNext, currentStepId = 'sequence', onToggleStatus }: WizardHeaderProps) {
  const isActive = sequence.status === 'active';



  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm sticky top-0 z-50">
      {/* Left: Icon, Back, Title, Toggle */}
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center">
          <Send className="w-4 h-4 text-white" />
        </div>
        <button onClick={onBack} className="p-1 -ml-2 hover:bg-gray-100 rounded text-gray-500 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-[15px] font-bold text-gray-900 tracking-tight">{sequence.name}</h1>

        <div className="ml-2 flex items-center gap-2 border-l border-gray-200 pl-4 h-6">
          <SequenceStateToggle
            isActive={isActive}
            onToggle={onToggleStatus || (() => { })}
            disabled={!onToggleStatus}
          />
          <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">{isActive ? 'Active' : 'Paused'}</span>
        </div>
      </div>

      {/* Middle: Stepper */}
      <SequenceWorkflowStepper
        currentStepId={currentStepId}
        sequenceId={sequence._id}
      />

      {/* Right: Next button */}
      <div className="flex items-center gap-3">
        <button onClick={onNext} className="flex items-center gap-1.5 px-6 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-colors shadow-sm">
          Next &rarr;
        </button>
      </div>
    </div>
  );
}


interface PhaseEditorProps {
  phase: PhaseCardData | null;
  templates: Template[];
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  connections: EmailConnection[];
  integrityIssue?: StepIntegrityIssue;
  onNext: (stepData: any) => void;
}

function PhaseEditor({ phase, templates, selectedTemplateId, connections, integrityIssue, onNext }: PhaseEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('emailSetup');
  const selectedTemplate = templates.find(t => t._id === selectedTemplateId);
  const contentTabRef = useRef<ContentTabRef>(null);

  const tabs: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
    { id: 'emailSetup', label: 'Email Setup', icon: <Mail className="w-4 h-4" /> },
    { id: 'aiWriter', label: 'Smart AI Writer', icon: <Wand2 className="w-4 h-4" /> },
    { id: 'emailTemplates', label: 'Email Templates', icon: <FileText className="w-4 h-4" /> },
    { id: 'spamChecker', label: 'Spam Checker', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {integrityIssue && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">⚠️ Action Required: Missing Information</p>
            <p className="text-sm text-amber-800 mt-1">
              This step is missing required fields ({integrityIssue.issues.join(', ')}).
              Defaults have been pre-filled. Click <strong>Next →</strong> below to repair and save.
            </p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-200 gap-8 px-6 pt-4 shrink-0 bg-white">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
          >
            {React.cloneElement(tab.icon as React.ReactElement<{ className?: string }>, { className: 'w-4 h-4' })}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto bg-white">
        {(activeTab === 'emailSetup' || activeTab === 'aiWriter') && (
          <ContentTab
            ref={contentTabRef}
            phase={phase}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            selectedTemplate={selectedTemplate}
            connections={connections}
            isAiMode={activeTab === 'aiWriter'}
          />
        )}
        {(activeTab === 'emailTemplates' || activeTab === 'spamChecker') && (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center">
              {tabs.find(t => t.id === activeTab)?.icon && (
                <div className="flex justify-center mb-3 opacity-40">
                  {React.cloneElement(tabs.find(t => t.id === activeTab)!.icon as React.ReactElement<{ className?: string }>, { className: 'w-10 h-10' })}
                </div>
              )}
              <p className="text-sm font-medium">{tabs.find(t => t.id === activeTab)?.label} coming soon</p>
            </div>
          </div>
        )}
      </div>

      {/* Editor Page Actions Bar */}
      <div className="border-t border-gray-100 bg-white px-6 py-4 flex justify-between items-center shrink-0">
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">
          <FileText className="w-4 h-4" />
          Save as Template
        </button>

        <button id="save-next-btn" onClick={() => {
          const data = contentTabRef.current?.getStepData() || {};
          onNext(data);
        }} className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm">
          Next &rarr;
        </button>
      </div>
    </div>
  );
}

interface ContentTabProps {
  phase: PhaseCardData | null;
  templates: Template[];
  selectedTemplateId: string;
  selectedTemplate?: Template;
  connections: EmailConnection[];
  isAiMode?: boolean;
}

export interface ContentTabRef {
  getStepData: () => {
    email_connection_id?: string;
    subject_override?: string;
    body_html_override?: string;
    cc?: string[];
    bcc?: string[];
  };
}

const ContentTab = forwardRef<ContentTabRef, ContentTabProps>(({ phase, selectedTemplate, connections, isAiMode }, ref) => {
  const [dropdownPos, setDropdownPos] = useState<DOMRect | null>(null);
  const editorRef = useRef<any>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  const [lastFocusedTarget, setLastFocusedTarget] = useState<'subject' | 'body'>('body');

  // Tags state
  const [tags, setTags] = useState<{
    contact: MergeTag[];
    custom: MergeTag[];
    sender: MergeTag[];
    sequence: MergeTag[];
  }>({
    contact: [], custom: [], sender: [], sequence: []
  });

  // CC / BCC state
  const [showCc, setShowCc] = useState(!!phase?.step?.cc?.length);
  const [showBcc, setShowBcc] = useState(!!phase?.step?.bcc?.length);
  const [ccInput, setCcInput] = useState(phase?.step?.cc?.join(', ') || '');
  const [bccInput, setBccInput] = useState(phase?.step?.bcc?.join(', ') || '');
  const [ccError, setCcError] = useState('');
  const [bccError, setBccError] = useState('');

  // Sender selection state — default to connection already on the step, then first active, then first available
  const defaultConnectionId = (() => {
    if (phase?.step?.email_connection_id) return phase.step.email_connection_id;
    const active = connections.find(c => c.status === 'active');
    return active?._id ?? connections[0]?._id ?? '';
  })();
  const [selectedConnectionId, setSelectedConnectionId] = useState(defaultConnectionId);

  // AI Generator state
  const [aiObjective, setAiObjective] = useState('First Touch');
  const [aiLength, setAiLength] = useState('Medium (125 - 200 words)');
  const [aiOffering, setAiOffering] = useState('');
  const [aiAudience, setAiAudience] = useState('');
  const [aiPainPoint, setAiPainPoint] = useState('');
  const [aiCta, setAiCta] = useState('');
  const [aiGuidance, setAiGuidance] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiBanner, setShowAiBanner] = useState(true);

  // Diagnostic: log accounts every time connections changes
  useEffect(() => {
    console.log('Loaded sender accounts:', connections);
  }, [connections]);

  // Subject / body state
  const [subject, setSubject] = useState(selectedTemplate?.subject || phase?.step?.subject_override || '');
  const [bodyHtml, setBodyHtml] = useState(selectedTemplate?.body_html || phase?.step?.body_html_override || '');

  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<{ html: string; subject: string } | null>(null);

  useImperativeHandle(ref, () => ({
    getStepData: () => {
      const currentHtml = editorRef.current?.getHTML() || bodyHtml;
      return {
        email_connection_id: selectedConnectionId,
        subject_override: subject,
        body_html_override: currentHtml,
        cc: ccInput ? ccInput.split(/[,;]+/).map(e => e.trim()).filter(Boolean) : undefined,
        bcc: bccInput ? bccInput.split(/[,;]+/).map(e => e.trim()).filter(Boolean) : undefined,
      };
    }
  }));

  useEffect(() => {
    templateService.getMergeTags()
      .then(res => setTags(res))
      .catch(() => { });
  }, []);

  const validateEmails = (input: string) => {
    if (!input.trim()) return '';
    const emails = input.split(/[,;]+/).map(e => e.trim()).filter(Boolean);
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of emails) {
      if (!regex.test(email)) return `Invalid email address: ${email}`;
    }
    return '';
  };

  const handleCcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCcInput(e.target.value);
    setCcError(validateEmails(e.target.value));
  };

  const handleBccChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBccInput(e.target.value);
    setBccError(validateEmails(e.target.value));
  };

  const insertVariable = (tag: string) => {
    if (lastFocusedTarget === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + tag + el.value.slice(end);
      setSubject(newVal);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + tag.length;
        el.focus();
      });
    } else if (editorRef.current) {
      editorRef.current.chain().focus().insertContent(tag).run();
      setBodyHtml(editorRef.current.getHTML());
    }
    setDropdownPos(null);
  };

  const openDropdownManual = (e: React.MouseEvent, target: 'subject' | 'body') => {
    e.preventDefault();
    e.stopPropagation();
    setLastFocusedTarget(target);
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownPos(rect);
  };

  const handlePreview = async () => {
    try {
      const htmlToPreview = editorRef.current?.getHTML() || bodyHtml;
      const res = await templateService.previewRaw({ html: htmlToPreview, subject });
      setPreviewData(res);
      setShowPreviewModal(true);
    } catch (err) {
      toast.error('Failed to preview template');
    }
  };

  const handleGenerateEmail = async () => {
    if (!aiObjective || !aiLength || !aiAudience || !aiOffering) {
      toast.error("Please fill out the required AI fields.");
      return;
    }

    const currentHtml = editorRef.current?.getHTML() || bodyHtml;
    // Simple empty check: tip tap empty is typically '<p></p>'
    const isEmpty = !currentHtml || currentHtml === '<p></p>' || currentHtml.trim() === '';

    if (!isEmpty) {
      if (!window.confirm("This will replace your existing email content. Are you sure you want to continue?")) {
        return;
      }
    }

    setIsGenerating(true);
    try {
      const generated = await aiWriterService.generateEmail({
        objective: aiObjective,
        length: aiLength,
        offering: aiOffering,
        audience: aiAudience,
        painPoint: aiPainPoint,
        cta: aiCta,
        guidance: aiGuidance
      });

      setSubject(generated.subject);
      setBodyHtml(generated.bodyHtml);
      if (editorRef.current) {
        editorRef.current.commands.setContent(generated.bodyHtml);
      }
      toast.success("Email generated successfully");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "AI Writer service is not configured.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleResetAi = () => {
    setAiObjective('First Touch');
    setAiLength('Medium (125 - 200 words)');
    setAiOffering('');
    setAiAudience('');
    setAiPainPoint('');
    setAiCta('');
    setAiGuidance('');
  };

  const wordCount = editorRef.current ? editorRef.current.getText().trim().split(/\s+/).filter((word: string) => word.length > 0).length : 0;

  return (
    <div className={`p-6 space-y-6 ${isAiMode ? 'grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 space-y-0 items-start' : ''}`}>

      {/* AI Sidebar */}
      {isAiMode && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col sticky top-0" style={{ maxHeight: 'calc(100vh - 180px)' }}>
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              AI Email Generator
              <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full ml-auto">Recommended</span>
            </h3>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              Provide details below and our AI will generate a high-quality email template for you.
            </p>
          </div>

          <div className="p-4 overflow-y-auto flex-1 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Email Objective <span className="text-red-500">*</span></label>
              <select value={aiObjective} onChange={e => setAiObjective(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option>First Touch</option>
                <option>Follow Up</option>
                <option>Meeting Request</option>
                <option>Product Introduction</option>
                <option>Re-engagement</option>
                <option>Event Invitation</option>
                <option>Partnership Outreach</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Email Length <span className="text-red-500">*</span></label>
              <select value={aiLength} onChange={e => setAiLength(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option>Short (50-100 words)</option>
                <option>Medium (125-200 words)</option>
                <option>Long (250-400 words)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">What Are You Offering? <span className="text-red-500">*</span></label>
              <input type="text" placeholder="Enter your main product or service" value={aiOffering} onChange={e => setAiOffering(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Target Audience <span className="text-red-500">*</span></label>
              <input type="text" placeholder="e.g. SaaS Founders, HR Managers" value={aiAudience} onChange={e => setAiAudience(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Pain Point Focus</label>
              <select value={aiPainPoint} onChange={e => setAiPainPoint(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option value="">Select the primary pain point</option>
                <option>Lead Generation</option>
                <option>Low Response Rate</option>
                <option>Poor Deliverability</option>
                <option>Manual Outreach</option>
                <option>Revenue Growth</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Your Preferred Call To Action</label>
              <input type="text" placeholder="e.g. Book a Demo" value={aiCta} onChange={e => setAiCta(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Additional Guidance for AI</label>
              <textarea placeholder="Share any specific instructions..." value={aiGuidance} onChange={e => setAiGuidance(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none h-24" maxLength={300} />
              <div className="text-right text-[10px] text-gray-400 font-medium mt-1">{aiGuidance.length} / 300 characters</div>
            </div>
          </div>

          <div className="p-4 border-t border-gray-100 flex gap-3 shrink-0">
            <button onClick={handleResetAi} className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-50 flex-1 transition-colors">Reset</button>
            <button onClick={handleGenerateEmail} disabled={isGenerating} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 flex-[2] flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {isGenerating ? <LoadingSpinner size={16} /> : <Sparkles className="w-4 h-4" />}
              Generate Email
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`space-y-6 ${isAiMode ? 'min-w-0' : ''}`}>

        {isAiMode && showAiBanner && (
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex gap-3 relative">
            <Lightbulb className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-indigo-900 mb-1">Prefer writing your own email?</p>
              <p className="text-xs text-indigo-800/80 leading-relaxed pr-6">
                You can skip the AI Email Generator and directly create your template using the editor below. Simply add your subject, content, and save.
              </p>
            </div>
            <button onClick={() => setShowAiBanner(false)} className="absolute top-4 right-4 text-indigo-400 hover:text-indigo-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isAiMode && (
          <div className="space-y-1.5 relative">
            <label className="block text-sm font-bold text-gray-700">Template Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all bg-white"
              placeholder="Enter template name"
              defaultValue={selectedTemplate?.name || 'Generated Template'}
            />
          </div>
        )}

        {/* Top section: Sender Dropdown + Preview Button */}
        <div className="space-y-1.5">
          <label className="block text-sm font-bold text-gray-700">From (Sender)</label>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              {connections.length === 0 ? (
                <div className="w-full px-4 py-2.5 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-700 font-medium">
                  No email accounts connected.{' '}
                  <a href="/email-accounts" className="underline font-bold hover:text-amber-900">Add one →</a>
                </div>
              ) : (
                <select
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                  className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-[13px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                >
                  {connections.map(conn => (
                    <option key={conn._id} value={conn._id}>
                      {conn.label ? `${conn.label} <${conn.from_email}>` : `${conn.from_name} <${conn.from_email}>`}
                    </option>
                  ))}
                </select>
              )}
              {connections.length > 0 && (
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              )}
            </div>
            <button onClick={handlePreview} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[13px] font-bold text-gray-700 shadow-sm transition-colors shrink-0">
              <Eye className="w-4 h-4" /> Preview
            </button>
          </div>

          <div className="flex gap-4 pt-1 pl-1">
            <button onClick={() => setShowCc(!showCc)} className="text-[11px] font-bold uppercase tracking-wide text-indigo-600 hover:text-indigo-700">CC</button>
            <button onClick={() => setShowBcc(!showBcc)} className="text-[11px] font-bold uppercase tracking-wide text-indigo-600 hover:text-indigo-700">BCC</button>
          </div>

          {showCc && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="CC (comma separated)..."
                value={ccInput}
                onChange={handleCcChange}
                className={`w-full px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors ${ccError ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-200 focus:ring-indigo-500 bg-white'}`}
              />
              {ccError && <p className="text-xs text-red-500 font-medium">{ccError}</p>}
            </div>
          )}

          {showBcc && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="BCC (comma separated)..."
                value={bccInput}
                onChange={handleBccChange}
                className={`w-full px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors ${bccError ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-200 focus:ring-indigo-500 bg-white'}`}
              />
              {bccError && <p className="text-xs text-red-500 font-medium">{bccError}</p>}
            </div>
          )}
        </div>

        {/* Subject */}
        <div className="space-y-1.5 relative">
          <label className="block text-sm font-bold text-gray-700">Email Subject</label>
          <div className="flex items-center border border-gray-200 rounded-lg bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all">
            <input
              ref={subjectRef}
              type="text"
              className="flex-1 px-4 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
              placeholder="Write your subject here.."
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                const cursor = e.target.selectionStart || 0;
                if (cursor >= 2 && e.target.value.substring(cursor - 2, cursor) === '{{') {
                  const rect = e.target.getBoundingClientRect();
                  setLastFocusedTarget('subject');
                  setDropdownPos(rect);
                }
              }}
              onFocus={() => setLastFocusedTarget('subject')}
            />
            <button onMouseDown={(e) => openDropdownManual(e, 'subject')} className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors shrink-0 rounded-r-lg border-l border-gray-200">
              {'{ }'} Insert variables <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Email Content with TipTap */}
        <div className="space-y-1.5 relative">
          <label className="block text-sm font-bold text-gray-700">Email Content</label>

          <div className="relative">
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              editorRef={editorRef}
              onFocus={() => setLastFocusedTarget('body')}
              onTriggerVariable={(rect) => {
                setLastFocusedTarget('body');
                setDropdownPos(rect);
              }}
            />

            {dropdownPos && (
              <PersonalizationDropdown
                tags={tags}
                onInsert={insertVariable}
                onClose={() => setDropdownPos(null)}
                autoFocusSearch
                style={{
                  position: 'fixed',
                  top: `${dropdownPos.bottom + 5}px`,
                  left: `${dropdownPos.left}px`,
                  zIndex: 9999
                }}
              />
            )}
          </div>

          {/* Bottom Left Insert Personalization */}
          <div className="pt-2 flex justify-start">
            <button onMouseDown={(e) => openDropdownManual(e, 'body')} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 text-sm font-semibold text-gray-600 transition-colors">
              <User className="w-4 h-4" />
              Insert Personalization <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>

          {isAiMode && (
            <div className="pt-6 mt-6 border-t border-gray-100 flex items-start gap-12">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs font-bold text-gray-900">Spam Score</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border-4 border-emerald-500 flex items-center justify-center text-sm font-bold text-emerald-600">
                    8.6
                  </div>
                  <p className="text-xs font-bold text-emerald-700 max-w-[150px] leading-snug">
                    Great! Your email is highly likely to land in the inbox.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs font-bold text-gray-900">Word Count</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </div>
                <p className="text-sm font-bold text-blue-600">{wordCount} words</p>
              </div>
            </div>
          )}
        </div>

        {showPreviewModal && previewData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Email Preview</h3>
                <button onClick={() => setShowPreviewModal(false)} className="text-gray-400 hover:text-gray-600">
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-y-auto bg-gray-50 flex-1">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                  <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 rounded-t-lg">
                    <div className="text-sm">
                      <span className="font-semibold text-gray-700">Subject:</span>{' '}
                      <span className="text-gray-900">{previewData.subject}</span>
                    </div>
                  </div>
                  <div
                    className="px-6 py-8 prose prose-sm max-w-none text-gray-800"
                    dangerouslySetInnerHTML={{ __html: previewData.html }}
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-end">
                <button onClick={() => setShowPreviewModal(false)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50 transition-colors">
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
});

export interface SequenceSummaryProps {
  sequence: Sequence;
  stepCount?: number;
}

export function SequenceSummary({ sequence }: SequenceSummaryProps) {
  const window = sequence.sending_window as any;
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const activeDays: number[] = window?.custom_days ?? window?.days ?? [];

  const formatTime = (hour: number, minute: number) => {
    const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const ampm = hour < 12 ? 'AM' : 'PM';
    return `${h}:${String(minute).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-6">

      <div className="flex items-center gap-2 border-b border-gray-100 pb-4 mb-2">
        <BarChart2 className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-bold text-gray-900">Sequence Summary</h3>
      </div>

      <SummaryRow icon={<Zap className="w-4 h-4 text-indigo-600" />} label="Launch Mode">
        <span className="text-xs font-bold text-emerald-500">Send immediately</span>
      </SummaryRow>

      {activeDays.length > 0 && (
        <SummaryRow icon={<Calendar className="w-4 h-4 text-indigo-600" />} label="Active Days">
          <div className="flex flex-wrap gap-1 mt-1">
            {activeDays.map(d => (
              <span key={d} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded uppercase">
                {days[d]}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">{activeDays.length} day(s) selected</p>
        </SummaryRow>
      )}

      {window?.timezone && (
        <SummaryRow icon={<Clock className="w-4 h-4 text-indigo-600" />} label="Timezone">
          <span className="text-xs text-gray-600">{window.timezone}</span>
        </SummaryRow>
      )}

      {window?.start_hour !== undefined && (
        <SummaryRow icon={<Clock className="w-4 h-4 text-indigo-600" />} label="Sending Window (IST)">
          <div className="text-xs text-gray-900 font-bold">
            {formatTime(window.start_hour, window.start_minute ?? 0)} – {formatTime(window.end_hour, window.end_minute ?? 0)}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Total window: 30 mins</div>
        </SummaryRow>
      )}

      <SummaryRow icon={<Calendar className="w-4 h-4 text-indigo-600" />} label="Daily Execution Cap">
        <span className="text-xs text-gray-600">{sequence.daily_sending_limit} emails per day</span>
      </SummaryRow>

      <SummaryRow icon={<Users className="w-4 h-4 text-indigo-600" />} label="Phase 1 Reservation Limit">
        <div className="text-xs text-gray-900 font-bold">30%</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Global daily cap: {sequence.daily_sending_limit}</div>
      </SummaryRow>

      {/* Info card */}
      <div className="rounded-xl bg-[#F4F2FA] border border-indigo-100 p-4 flex gap-3">
        <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-indigo-900 mb-1">How sending works</p>
          <p className="text-xs text-indigo-800/80 leading-relaxed">
            Emails will be sent within your selected window on active days. The system will automatically use the next available slot.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SummaryRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-[12px] font-bold text-gray-900">{label}</p>
        {children}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const SequenceBuilderWizard: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [integrity, setIntegrity] = useState<SequenceIntegrity | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedPhaseIdx] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const [seqData, tplData, connData, integrityData] = await Promise.all([
        sequenceService.getWithSteps(id),
        templateService.list(),
        emailAccountService.list(),
        sequenceService.getIntegrity(id),
      ]);
      setSequence(seqData.sequence);
      setSteps(seqData.steps);
      setTemplates(tplData);
      setConnections(connData);
      setIntegrity(integrityData);
      // Pre-select template from first step if available
      const firstEmailStep = seqData.steps.find(s => s.type === 'email');
      if (firstEmailStep?.template_id) {
        setSelectedTemplateId(firstEmailStep.template_id);
      } else if (tplData.length > 0) {
        setSelectedTemplateId(tplData[0]._id);
      }
    } catch {
      toast.error('Failed to load sequence data');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build phase card list from real steps, or default Phase 1
  const phases: PhaseCardData[] = steps.length > 0
    ? steps
      .filter(s => s.type === 'email')
      .map((step, idx) => ({
        id: step._id,
        stepNumber: idx + 1,
        name: getPhaseNameForIndex(idx),
        delayLabel: getDelayLabel(step),
        step,
      }))
    : [{
      id: 'default-phase-1',
      stepNumber: 1,
      name: 'Cold Email',
      delayLabel: 'Send Immediately',
      isDefault: true,
    }];


  const handleNext = async (stepData: any) => {
    if (!sequence) return;

    setIsLoading(true);
    try {
      if (steps.length === 0) {
        // Create initial step
        await sequenceService.addStep(sequence._id, {
          type: 'email',
          delay_days: 0,
          delay_hours: 0,
          template_id: selectedTemplateId || undefined,
          ...stepData
        });
      } else {
        // Update existing step
        const currentStep = phases[selectedPhaseIdx]?.step;
        if (currentStep) {
          await sequenceService.updateStep(sequence._id, currentStep._id, {
            type: 'email',
            template_id: selectedTemplateId || undefined,
            ...stepData
          });
        }
      }
      navigate(`/sequences/${sequence._id}/recipients/manage`);
    } catch (err) {
      toast.error('Failed to save sequence step');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

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

  return (
    <div className="min-h-screen bg-[#FAF9FB] flex flex-col">
      <Toaster position="top-right" />

      {/* Header Container */}
      <WizardHeader
        sequence={sequence}
        onBack={() => navigate('/sequences')}
        currentStepId="sequence"
        onToggleStatus={handleToggleStatus}
      />

      {/* Body: 2-column layout (75% - 25%) */}
      <div className="flex flex-1 max-w-[1600px] w-full mx-auto gap-6 mt-6 pb-16 items-start px-6">

        {/* Main Content: Phase editor (approx 75%) */}
        <div className="flex-1 min-w-0">
          {integrity && !integrity.is_valid && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 shadow-sm text-sm text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong>Sequence Integrity Issues:</strong> Please review flagged steps.
              </div>
            </div>
          )}
          <PhaseEditor
            phase={phases[selectedPhaseIdx] ?? null}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onTemplateChange={setSelectedTemplateId}
            connections={connections}
            integrityIssue={integrity?.issues?.find(iss => iss.step_id === phases[selectedPhaseIdx]?.step?._id) || integrity?.issues?.find(iss => iss.step_id === 'global')}
            onNext={handleNext}
          />
        </div>

        {/* Right panel: Sequence summary (approx 25%) */}
        <div className="w-[300px] shrink-0 sticky top-6">
          <SequenceSummary sequence={sequence} />
        </div>
      </div>
    </div>
  );
};
