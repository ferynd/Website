import React from 'react';

export default function LoadingStatus({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-12 text-text-3">
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded-full border-2 border-border border-t-text-3 motion-safe:animate-spin"
      />
      <span>{children}</span>
    </div>
  );
}
