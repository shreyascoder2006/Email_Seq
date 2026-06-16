import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

interface LoadingSpinnerProps {
  className?: string;
  size?: number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ className, size = 24 }) => {
  return (
    <div className={cn('flex items-center justify-center p-4', className)}>
      <Loader2 className="animate-spin text-primary-600" size={size} />
    </div>
  );
};
