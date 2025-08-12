"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
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
    <section className="bg-white rounded shadow p-4">
      <header className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <button onClick={onToggle} className="text-blue-600">
          {show ? 'Hide' : 'Show'}
        </button>
      </header>
      {show ? (
        <ul className="max-h-40 overflow-y-auto text-gray-800 text-sm">
          {entries.length ? (
            entries.map((e) => (
              <li key={e.id} className="border-b py-1 last:border-b-0">
                {e.type} - {e.actorEmail}{' '}
                <span className="text-gray-600">
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

