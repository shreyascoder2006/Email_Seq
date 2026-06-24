import React from 'react';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <div className="group relative inline-flex items-center justify-center">
      {children}
    </div>
  );
}

export function TooltipTrigger({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) {
    // If asChild is true, we assume the child is a single element and we just pass through.
    // The group class on Tooltip handles the hover state.
    return <>{children}</>;
  }
  return <div className="inline-flex items-center justify-center cursor-pointer">{children}</div>;
}

export function TooltipContent({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={`absolute bottom-full mb-2 hidden group-hover:block z-[9999] whitespace-nowrap bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-md shadow-lg animate-in fade-in zoom-in-95 duration-150 ${className}`}>
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
    </div>
  );
}
