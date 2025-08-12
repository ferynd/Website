"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useEffect, useRef } from 'react';

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
      <div className="bg-white p-4 rounded shadow space-y-4">
        <p id="confirm-title">Are you sure you want to delete this {itemType}?</p>
        <div className="flex gap-2 justify-end">
          <button
            ref={btnRef}
            onClick={onConfirm}
            className="bg-red-600 text-white px-3 py-1 rounded"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 border rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
