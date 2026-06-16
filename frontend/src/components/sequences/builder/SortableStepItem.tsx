import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Mail, Clock, Trash2, Edit2 } from 'lucide-react';
import type { SequenceStep, Template, EmailConnection } from '../../../types';
import { Button } from '../../ui/Button';

interface SortableStepItemProps {
  step: SequenceStep;
  template?: Template;
  connection?: EmailConnection;
  onEdit: (step: SequenceStep) => void;
  onDelete: (id: string) => void;
}

export const SortableStepItem: React.FC<SortableStepItemProps> = ({
  step,
  template,
  connection,
  onEdit,
  onDelete,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  const isEmail = step.type === 'email';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
        isDragging ? 'opacity-50 ring-2 ring-primary-500' : 'border-gray-200'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex cursor-grab items-center justify-center rounded p-1 hover:bg-gray-100 active:cursor-grabbing text-gray-400"
      >
        <GripVertical className="h-5 w-5" />
      </div>

      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isEmail ? 'bg-blue-100' : 'bg-orange-100'}`}>
        {isEmail ? <Mail className="h-5 w-5 text-blue-600" /> : <Clock className="h-5 w-5 text-orange-600" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">
            {isEmail ? 'Email Step' : 'Wait Step'}
          </h3>
          {!step.is_active && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Disabled
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-col gap-1 text-sm text-gray-500">
          {isEmail ? (
            <>
              <p className="truncate">
                <span className="font-medium text-gray-700">Template:</span> {template?.name || <span className="text-red-500 italic">Missing Template</span>}
              </p>
              <p className="truncate">
                <span className="font-medium text-gray-700">From:</span> {connection?.label || <span className="text-red-500 italic">Missing Account</span>}
              </p>
              {step.subject_override && (
                <p className="truncate">
                  <span className="font-medium text-gray-700">Subject:</span> {step.subject_override}
                </p>
              )}
            </>
          ) : (
            <p>
              Wait for <span className="font-medium text-gray-900">{step.delay_days}</span> days and <span className="font-medium text-gray-900">{step.delay_hours}</span> hours
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 md:opacity-100">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onEdit(step)}>
          <Edit2 className="h-4 w-4 text-gray-500 hover:text-gray-900" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-red-50" onClick={() => onDelete(step._id)}>
          <Trash2 className="h-4 w-4 text-red-500 hover:text-red-600" />
        </Button>
      </div>
    </div>
  );
};
