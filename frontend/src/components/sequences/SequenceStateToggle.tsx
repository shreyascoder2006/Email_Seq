import React from 'react';

interface SequenceStateToggleProps {
  isActive: boolean;
  onToggle: (isActive: boolean) => void;
  disabled?: boolean;
}

export const SequenceStateToggle: React.FC<SequenceStateToggleProps> = ({
  isActive,
  onToggle,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!isActive);
      }}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2
        ${isActive ? 'bg-indigo-600' : 'bg-gray-200'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span className="sr-only">Toggle sequence state</span>
      <span
        aria-hidden="true"
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
          ${isActive ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
};
