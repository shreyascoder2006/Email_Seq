import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { toast } from 'react-hot-toast';

export type WorkflowStepId = 'schedule' | 'sequence' | 'recipients' | 'preview-test';

export interface SequenceWorkflowStepperProps {
  currentStepId: WorkflowStepId;
  sequenceId?: string;
  isRecipientsUnlocked?: boolean;
  isPreviewUnlocked?: boolean;
}

export const SequenceWorkflowStepper: React.FC<SequenceWorkflowStepperProps> = ({
  currentStepId,
  sequenceId,
  isRecipientsUnlocked = true, // Simplified: assume unlocked if sequence exists
  isPreviewUnlocked = true, // Simplified: assume unlocked if sequence exists
}) => {
  const navigate = useNavigate();

  const steps: { id: WorkflowStepId; label: string }[] = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'sequence', label: 'Sequence' },
    { id: 'recipients', label: 'Recipients' },
    { id: 'preview-test', label: 'Preview/Test' },
  ];

  const currentIdx = steps.findIndex((s) => s.id === currentStepId);

  const canNavigateTo = (targetId: WorkflowStepId) => {
    // If we're creating a new sequence (no ID yet), we can only be on Schedule
    if (!sequenceId) return targetId === 'schedule';

    const targetIdx = steps.findIndex((s) => s.id === targetId);
    
    // Can always go backward
    if (targetIdx <= currentIdx) return true;

    // Forward checks
    if (targetId === 'recipients') return isRecipientsUnlocked;
    if (targetId === 'preview-test') return isPreviewUnlocked;

    return true;
  };

  const handleStepClick = (targetId: WorkflowStepId) => {
    if (targetId === currentStepId) return;

    if (!canNavigateTo(targetId)) {
      toast('Complete the current step first', { icon: '⚠️' });
      return;
    }

    if (targetId === 'schedule') {
      // Safest canonical behavior: take them back to the Sequences dashboard since it hosts the modal
      // Ideally, there should be an edit schedule route, but sequences page handles sequence settings
      navigate('/sequences');
      toast.success('Navigated to sequences. Use settings to edit schedule.');
    } else if (targetId === 'sequence') {
      navigate(`/sequences/${sequenceId}/builder-v2`);
    } else if (targetId === 'recipients') {
      navigate(`/sequences/${sequenceId}/recipients/manage`);
    } else if (targetId === 'preview-test') {
      navigate(`/sequences/${sequenceId}/preview-test`);
    }
  };

  return (
    <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
      {steps.map((step, idx) => {
        const isCurrent = idx === currentIdx;
        const isUnlocked = canNavigateTo(step.id);
        const showCompleted = idx < currentIdx; // Visually completed if it is before current step

        return (
          <React.Fragment key={step.id}>
            <button 
              onClick={() => handleStepClick(step.id)}
              className={`flex items-center gap-2 group transition-all ${
                isCurrent ? 'bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full' : 'px-1 py-1.5'
              } ${!isUnlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-80'}`}
              type="button"
            >
              <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold border transition-colors ${
                isCurrent ? 'bg-white border-indigo-600 text-indigo-600 shadow-sm' :
                showCompleted ? 'bg-white border-emerald-500 text-emerald-500' :
                'bg-white border-gray-300 text-gray-500 group-hover:border-gray-400'
              }`}>
                {showCompleted ? <Check className="w-3 h-3 text-emerald-500" /> : idx + 1}
              </div>
              <span className={`text-[12px] font-bold transition-colors ${
                isCurrent ? 'text-indigo-700' : 
                showCompleted ? 'text-gray-900' : 'text-gray-500 group-hover:text-gray-700'
              }`}>
                {step.label}
              </span>
            </button>
            {idx < steps.length - 1 && (
              <div className={`w-8 h-[1px] mx-1 transition-colors ${showCompleted ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
