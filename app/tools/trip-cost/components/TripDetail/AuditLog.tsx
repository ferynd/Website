"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import Button from '@/components/Button';
import type { AuditEntry } from '../../pageTypes';

export default function AuditLog({
  entries,
  show,
  onToggle,
}: {
  entries: AuditEntry[];
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="bg-surface-1 rounded shadow p-4">
      <header className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <Button
          onClick={onToggle}
          variant="ghost"
          size="sm"
          className="text-accent p-0 h-auto"
        >
          {show ? 'Hide' : 'Show'}
        </Button>
      </header>
      {show ? (
        <ul className="max-h-40 overflow-y-auto text-text text-sm">
          {entries.length ? (
            entries.map((e) => (
              <li key={e.id} className="border-b border-border py-1 last:border-b-0">
                {e.type} - {e.actorEmail}{' '}
                <span className="text-text-3">
                  {e.ts ? new Date(e.ts.toDate()).toLocaleString() : ''}
                </span>
              </li>
            ))
          ) : (
            <li>No audit entries yet.</li>
          )}
        </ul>
      ) : null}
    </section>
  );
}

