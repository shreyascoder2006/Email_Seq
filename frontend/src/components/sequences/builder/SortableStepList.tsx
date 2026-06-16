import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableStepItem } from './SortableStepItem';
import type { SequenceStep, Template, EmailConnection } from '../../../types';

interface SortableStepListProps {
  steps: SequenceStep[];
  templates: Template[];
  connections: EmailConnection[];
  onReorder: (newSteps: SequenceStep[]) => void;
  onEdit: (step: SequenceStep) => void;
  onDelete: (id: string) => void;
}

export const SortableStepList: React.FC<SortableStepListProps> = ({
  steps,
  templates,
  connections,
  onReorder,
  onEdit,
  onDelete,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Start dragging only after moving 5px
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = steps.findIndex((step) => step._id === active.id);
      const newIndex = steps.findIndex((step) => step._id === over.id);

      onReorder(arrayMove(steps, oldIndex, newIndex));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={steps.map(s => s._id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-4">
          {steps.map((step, index) => (
            <React.Fragment key={step._id}>
              {index > 0 && (
                <div className="flex justify-center -my-2 opacity-50">
                  <div className="h-6 w-px bg-gray-300" />
                </div>
              )}
              <SortableStepItem
                step={step}
                template={templates.find(t => t._id === step.template_id)}
                connection={connections.find(c => c._id === step.email_connection_id)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </React.Fragment>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};
