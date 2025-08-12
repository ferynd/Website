"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useEffect, useRef } from 'react';
import Button from '@/components/Button';

export default function ConfirmDeleteModal({
  itemType,
  onConfirm,
  onCancel,
}: {
  itemType: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      tabIndex={-1}
    >
      <div className="bg-surface-1 p-4 rounded shadow space-y-4">
        <p id="confirm-title">Are you sure you want to delete this {itemType}?</p>
        <div className="flex gap-2 justify-end">
          <Button
            ref={btnRef}
            onClick={onConfirm}
            variant="danger"
            size="sm"
            className="px-3 py-1"
          >
            Delete
          </Button>
          <Button
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
