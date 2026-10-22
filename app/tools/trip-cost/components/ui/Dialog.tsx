"use client";

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const openDialogs: symbol[] = [];
let previousBodyOverflow = '';
let firstOpener: HTMLElement | null = null;

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
  dismissible?: boolean;
}

/** Responsive Trip Cost dialog with focus management and an optional sticky footer. */
export default function Dialog({ open, title, onClose, children, footer, dismissible = true }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = dismissible ? onClose : () => {};

  useEffect(() => {
    if (!open) return;
    if (openDialogs.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      firstOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const token = registerModalLayer();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      if (!panel.current.contains(document.activeElement)) {
        event.preventDefault();
        const outsideItems = Array.from(panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ));
        (event.shiftKey ? outsideItems[outsideItems.length - 1] : outsideItems[0] ?? panel.current).focus();
        return;
      }
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
      const wasTop = isTopModalLayer(token);
      unregisterModalLayer(token);
      if (openDialogs.length === 0) {
        document.body.style.overflow = previousBodyOverflow;
        const target = opener.current?.isConnected ? opener.current : firstOpener;
        target?.focus();
        firstOpener = null;
      } else if (wasTop && opener.current?.isConnected) {
        opener.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center"
      onMouseDown={(event) => {
        // On phones the sheet leaves a backdrop strip above it; ignore taps there so
        // an accidental tap (e.g. to dismiss the keyboard) can't discard a form.
        const desktop = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(min-width: 640px)').matches;
        if (dismissible && desktop && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-auto min-h-0 max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface-1 shadow-xl sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 id={titleId} className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-lg font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close dialog"
            className="shrink-0 rounded px-2 py-1 text-text-2 hover:bg-surface-2 disabled:opacity-50"
          >
            <X aria-hidden="true" size={18} />
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
