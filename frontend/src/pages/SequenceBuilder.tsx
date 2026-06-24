import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Pause, Save, ArrowLeft, Plus } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { SortableStepList } from '../components/sequences/builder/SortableStepList';
import { StepModal } from '../components/sequences/builder/StepModal';
import { ContactsTab } from '../components/sequences/contacts/ContactsTab';
import { ActivationModal } from '../components/sequences/activation/ActivationModal';
import { sequenceService } from '../services/sequence.service';
import type { PreActivationCheckResponse } from '../services/sequence.service';
import { templateService } from '../services/template.service';
import { emailAccountService } from '../services/emailAccount.service';
import type { Sequence, SequenceStep, Template, EmailConnection, CreateStepDto, UpdateStepDto, StepType } from '../types';

export const SequenceBuilder: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStepType, setModalStepType] = useState<StepType>('email');
  const [editingStep, setEditingStep] = useState<SequenceStep | null>(null);

  // Activation Modal State
  const [isActivationModalOpen, setIsActivationModalOpen] = useState(false);
  const [activationCheckResult, setActivationCheckResult] = useState<PreActivationCheckResponse | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const [seqData, tplData, connData] = await Promise.all([
        sequenceService.getWithSteps(id),
        templateService.list(),
        emailAccountService.list(),
      ]);
      setSequence(seqData.sequence);
      setSteps(seqData.steps);
      setTemplates(tplData);
      setConnections(connData);
    } catch (err) {
      toast.error('Failed to load sequence data');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Actions ---

  const handleUpdateStatus = async (status: Sequence['status']) => {
    if (!id) return;
    try {
      await sequenceService.updateStatus(id, status);
      setSequence(prev => prev ? { ...prev, status } : null);
      toast.success(`Sequence ${status}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update status');
    }
  };

  const initiateActivation = async () => {
    if (!id) return;
    try {
      setIsActivating(true);
      const result = await sequenceService.preActivationCheck(id);
      setActivationCheckResult(result);
      setIsActivationModalOpen(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to run pre-activation check');
    } finally {
      setIsActivating(false);
    }
  };

  const confirmActivation = async () => {
    setIsActivationModalOpen(false);
    await handleUpdateStatus('active');
  };

  const handleReorder = async (newSteps: SequenceStep[]) => {
    if (!id) return;
    // Optimistic update
    setSteps(newSteps);
    try {
      await sequenceService.reorderSteps(id, { step_ids: newSteps.map(s => s._id) });
      toast.success('Steps reordered');
    } catch (err) {
      toast.error('Failed to save step order');
      fetchData(); // revert
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!id) return;
    if (!window.confirm('Delete this step?')) return;
    try {
      await sequenceService.deleteStep(id, stepId);
      setSteps(prev => prev.filter(s => s._id !== stepId));
      toast.success('Step deleted');
    } catch (err) {
      toast.error('Failed to delete step');
    }
  };

  const handleModalSubmit = async (data: CreateStepDto | UpdateStepDto) => {
    if (!id) return;
    try {
      if (editingStep) {
        const updated = await sequenceService.updateStep(id, editingStep._id, data as UpdateStepDto);
        setSteps(prev => prev.map(s => s._id === updated._id ? updated : s));
        toast.success('Step updated');
      } else {
        const added = await sequenceService.addStep(id, data as CreateStepDto);
        setSteps(prev => [...prev, added]);
        toast.success('Step added');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to save step';
      toast.error(msg);
      throw err; // re-throw so modal doesn't close on error
    }
  };

  const openModal = (type: StepType, step?: SequenceStep) => {
    setModalStepType(type);
    setEditingStep(step || null);
    setIsModalOpen(true);
  };

  const [activeTab, setActiveTab] = useState<'builder' | 'contacts' | 'analytics' | 'settings'>('builder');

  if (isLoading) {
    return <div className="flex h-96 items-center justify-center"><LoadingSpinner size={32} /></div>;
  }

  if (!sequence) {
    return <div className="p-8 text-center text-gray-500">Sequence not found.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <Toaster position="top-right" />
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" className="h-10 w-10 p-0 rounded-full" onClick={() => navigate('/sequences')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{sequence.name}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize 
                ${sequence.status === 'active' ? 'bg-green-100 text-green-800' : 
                  sequence.status === 'paused' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                {sequence.status}
              </span>
            </div>
            {sequence.description && <p className="text-sm text-gray-500 mt-1">{sequence.description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sequence.status === 'draft' && (
            <Button variant="outline" onClick={() => toast('Draft automatically saved!', { icon: '📝' })}>
              <Save className="mr-2 h-4 w-4" /> Save Draft
            </Button>
          )}
          {sequence.status === 'active' ? (
            <Button variant="outline" onClick={() => handleUpdateStatus('paused')}>
              <Pause className="mr-2 h-4 w-4" /> Pause Sequence
            </Button>
          ) : (
            <Button onClick={initiateActivation} disabled={steps.filter(s => s.type === 'email').length === 0 || isActivating}>
              {isActivating ? <LoadingSpinner size={16} className="mr-2" /> : <Play className="mr-2 h-4 w-4" />} Activate Sequence
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {['builder', 'contacts', 'analytics', 'settings'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize
                ${activeTab === tab
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
              `}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'contacts' && <ContactsTab sequenceId={sequence._id} />}
      
      {activeTab === 'analytics' && (
        <div className="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">
          Analytics dashboard coming soon.
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">
          Sequence settings coming soon.
        </div>
      )}

      {activeTab === 'builder' && (
        <div className="bg-gray-50/50 p-6 rounded-xl border border-dashed border-gray-300">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Sequence Steps</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => openModal('email')}>
                <Plus className="mr-2 h-4 w-4" /> Add Email
              </Button>
              <Button variant="outline" size="sm" onClick={() => openModal('wait')}>
                <Plus className="mr-2 h-4 w-4" /> Add Delay
              </Button>
            </div>
          </div>

          {steps.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <h3 className="text-sm font-medium text-gray-900">No steps yet</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by adding an email or delay step.</p>
              <div className="mt-6 flex justify-center gap-4">
                <Button onClick={() => openModal('email')}><Plus className="mr-2 h-4 w-4" /> Add Email Step</Button>
              </div>
            </div>
          ) : (
            <SortableStepList
              steps={steps}
              templates={templates}
              connections={connections}
              onReorder={handleReorder}
              onEdit={(step) => openModal(step.type, step)}
              onDelete={handleDeleteStep}
            />
          )}
        </div>
      )}

      <StepModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleModalSubmit}
        stepType={modalStepType}
        templates={templates}
        emailConnections={connections}
        initialData={editingStep ? {
          type: editingStep.type,
          delay_days: editingStep.delay_days,
          delay_hours: editingStep.delay_hours,
          template_id: editingStep.template_id,
          email_connection_id: editingStep.email_connection_id,
          subject_override: editingStep.subject_override,
        } : undefined}
      />

      {sequence && (
        <ActivationModal
          isOpen={isActivationModalOpen}
          onClose={() => setIsActivationModalOpen(false)}
          onConfirm={confirmActivation}
          sequence={sequence}
          checkResult={activationCheckResult}
        />
      )}
    </div>
  );
};
