"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useEffect, useRef } from 'react';
import Button from '@/components/Button';
import { isTopModalLayer, registerModalLayer, unregisterModalLayer } from '../ui/Dialog';

interface ConfirmDeleteModalProps {
  itemType: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Shown when the confirmed deletion was rejected; the modal stays open. */
  error?: string | null;
  busy?: boolean;
}

/** Confirmation modal shown above open Trip Cost detail sheets. */
export default function ConfirmDeleteModal({
  itemType,
  onConfirm,
  onCancel,
  error = null,
  busy = false,
}: ConfirmDeleteModalProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const layer = useRef<symbol | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = registerModalLayer();
    layer.current = token;
    btnRef.current?.focus();
    return () => {
      unregisterModalLayer(token);
      layer.current = null;
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (!layer.current || !isTopModalLayer(layer.current)) return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
          return;
        }
        if (e.key === 'Tab' && layer.current && isTopModalLayer(layer.current)) {
          const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ) ?? []).filter((control) => !control.hidden && control.getAttribute('aria-hidden') !== 'true');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first) {
            e.preventDefault();
            return;
          }
          if (e.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
      tabIndex={-1}
    >
      <div ref={modalRef} className="mx-4 w-full min-w-0 max-w-lg space-y-4 break-words rounded bg-surface-1 p-4 shadow [overflow-wrap:anywhere]">
        <p id="confirm-title">Are you sure you want to delete this {itemType}?</p>
        {error && (
          <p role="alert" className="break-words text-sm text-error [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={btnRef}
            onClick={onConfirm}
            disabled={busy}
            variant="danger"
            size="sm"
            className="px-3 py-1"
          >
            Delete
          </Button>
          <Button
            ref={cancelRef}
            onClick={onCancel}
            variant="ghost"
            size="sm"
            className="px-3 py-1 border border-border"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
