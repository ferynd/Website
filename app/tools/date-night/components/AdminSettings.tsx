'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useDateNight } from '../DateNightContext';

/* ------------------------------------------------------------ */
/* CONFIGURATION: admin participant editor defaults             */
/* ------------------------------------------------------------ */

export default function AdminSettings() {
  const { isAdmin, participantRows, saveParticipant } = useDateNight();
  const [uid, setUid] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});

  if (!isAdmin) return null;

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <h2 className="text-xl font-semibold">Admin Participant Settings</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <Input label="Participant UID" value={uid} onChange={(e) => setUid(e.target.value)} />
        <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <Button onClick={() => void saveParticipant(uid.trim(), displayName.trim())}>Add or update participant</Button>

      <ul className="space-y-2">
        {participantRows.map((row) => (
          <li key={row.uid} className="rounded-lg border border-border/60 bg-surface-2/70 p-3 space-y-2">
            <p className="text-xs text-text-3">{row.uid}</p>
            <Input
              label="Display Name"
              value={editing[row.uid] ?? row.displayName}
              onChange={(event) => setEditing((prev) => ({ ...prev, [row.uid]: event.target.value }))}
            />
            <Button size="sm" variant="secondary" onClick={() => void saveParticipant(row.uid, (editing[row.uid] ?? row.displayName).trim())}>
              Save name
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
