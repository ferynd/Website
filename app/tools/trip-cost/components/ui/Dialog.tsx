"use client";

import React, { useEffect, useId, useRef } from 'react';

const openDialogs: symbol[] = [];

/** Register a modal layer and return its identity for topmost checks. */
export function registerModalLayer(): symbol {
  const token = Symbol('trip-cost-modal');
  openDialogs.push(token);
  return token;
}

/** Remove a modal layer from the shared stack when it closes. */
export function unregisterModalLayer(token: symbol): void {
  const index = openDialogs.lastIndexOf(token);
  if (index >= 0) openDialogs.splice(index, 1);
}

/** Check whether a registered modal is currently the top layer. */
export function isTopModalLayer(token: symbol): boolean {
  return openDialogs[openDialogs.length - 1] === token;
}

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Responsive Trip Cost dialog with focus management and an optional sticky footer. */
export default function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = registerModalLayer();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();

    const key = (event: KeyboardEvent) => {
      // React may synchronously unregister a closing child dialog before this document listener runs.
      if (event.defaultPrevented) return;
      if (!isTopModalLayer(token)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
          'a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      unregisterModalLayer(token);
      document.body.style.overflow = oldOverflow;
      opener.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 sm:flex sm:items-center sm:justify-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-1 shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 id={titleId} className="text-lg font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded px-2 py-1 text-text-2 hover:bg-surface-2"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="sticky bottom-0 shrink-0 border-t border-border bg-surface-1 p-4">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
