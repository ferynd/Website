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
}: {
  entries: AuditEntry[];
  show: boolean;
}) {
  if (!show) return null;
  return (
    <section className="bg-white rounded shadow p-4 mt-2">
      <h2 className="text-lg font-semibold mb-2">Audit Log</h2>
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
    </section>
  );
}
