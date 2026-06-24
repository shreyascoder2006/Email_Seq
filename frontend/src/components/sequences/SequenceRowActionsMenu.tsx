import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Eye, Edit2, Play, Pause, Copy, Trash2 } from 'lucide-react';
import type { Sequence } from '../../types';

interface SequenceRowActionsMenuProps {
  sequence: Sequence;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdateStatus: (id: string, status: Sequence['status']) => void;
  onClone: (sequence: Sequence) => void;
  onDelete: (id: string) => void;
}

export const SequenceRowActionsMenu: React.FC<SequenceRowActionsMenuProps> = ({
  sequence,
  onView,
  onEdit,
  onUpdateStatus,
  onClone,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    setIsOpen(false);
    action();
  };

  const isPaused = sequence.status === 'paused';
  const isActive = sequence.status === 'active';

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 w-48 origin-top-right rounded-xl bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden">
          <div className="py-1">
            <button
              onClick={(e) => handleAction(e, () => onView(sequence._id))}
              className="group flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <Eye className="mr-3 h-4 w-4 text-gray-400 group-hover:text-gray-500" />
              View
            </button>
            <button
              onClick={(e) => handleAction(e, () => onEdit(sequence._id))}
              className="group flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <Edit2 className="mr-3 h-4 w-4 text-gray-400 group-hover:text-gray-500" />
              Edit
            </button>
            
            {(isActive || isPaused) && (
              <button
                onClick={(e) => handleAction(e, () => onUpdateStatus(sequence._id, isActive ? 'paused' : 'active'))}
                className="group flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                {isActive ? (
                  <>
                    <Pause className="mr-3 h-4 w-4 text-yellow-500 group-hover:text-yellow-600" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="mr-3 h-4 w-4 text-green-500 group-hover:text-green-600" />
                    Resume
                  </>
                )}
              </button>
            )}

            <button
              onClick={(e) => handleAction(e, () => onClone(sequence))}
              className="group flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <Copy className="mr-3 h-4 w-4 text-gray-400 group-hover:text-gray-500" />
              Clone
            </button>
            
            <div className="h-px bg-gray-100 my-1 mx-2" />
            
            <button
              onClick={(e) => handleAction(e, () => onDelete(sequence._id))}
              className="group flex w-full items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              <Trash2 className="mr-3 h-4 w-4 text-red-500 group-hover:text-red-600" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
