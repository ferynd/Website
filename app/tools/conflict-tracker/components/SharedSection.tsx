"use client";

import { useState } from 'react';
import Button from '@/components/Button';
import type { Conflict, Tracker } from '../lib/types';

interface Props {
  conflict: Conflict;
  tracker: Tracker;
  authorUid: string;
  isAdmin: boolean;
  onSave: (patch: Partial<Pick<Conflict, 'sharedClarification' | 'personARealMeaning' | 'personBRealMeaning'>>) => Promise<void>;
}

export default function SharedSection({ conflict, tracker, authorUid, isAdmin, onSave }: Props) {
  const bothSubmitted = conflict.hasReflectionA && conflict.hasReflectionB;
  const isPersonA = tracker.personAUid === authorUid;
  const canEdit = isPersonA || isAdmin;

  const [aRealMeaning, setAMeaning] = useState(conflict.personARealMeaning ?? '');
  const [bRealMeaning, setBMeaning] = useState(conflict.personBRealMeaning ?? '');
  const [clarification, setClarification] = useState(conflict.sharedClarification ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        personARealMeaning: aRealMeaning.trim() || undefined,
        personBRealMeaning: bRealMeaning.trim() || undefined,
        sharedClarification: clarification.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!bothSubmitted) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-6 text-center space-y-2">
        <p className="font-medium text-text">Shared section</p>
        <p className="text-sm text-text-2">
          This section opens once both of you have submitted your reflections.
        </p>
        <div className="flex justify-center gap-4 mt-3 text-xs">
          <span className={`rounded-full px-3 py-1 border ${
            conflict.hasReflectionA
              ? 'bg-green-900/30 text-green-300 border-green-700/40'
              : 'bg-surface-2 text-text-3 border-border'
          }`}>
            {aName} {conflict.hasReflectionA ? '✓ submitted' : '○ not yet'}
          </span>
          <span className={`rounded-full px-3 py-1 border ${
            conflict.hasReflectionB
              ? 'bg-green-900/30 text-green-300 border-green-700/40'
              : 'bg-surface-2 text-text-3 border-border'
          }`}>
            {bName} {conflict.hasReflectionB ? '✓ submitted' : '○ not yet'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 space-y-5">
      <div>
        <h3 className="font-semibold text-text">Shared understanding</h3>
        <p className="text-sm text-text-2 mt-1">
          Fill this in together. Compare what each person thought was meant vs. what they actually
          meant, and note any shared clarifications.
        </p>
        {!canEdit && (
          <p className="text-xs text-text-3 mt-1">Only {aName} or an admin can edit this section.</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-3">
          What {aName} actually meant
        </label>
        <textarea
          rows={3}
          disabled={!canEdit}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y disabled:opacity-50"
          placeholder={`What ${aName} was actually trying to express…`}
          value={aRealMeaning}
          onChange={(e) => setAMeaning(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-3">
          What {bName} actually meant
        </label>
        <textarea
          rows={3}
          disabled={!canEdit}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y disabled:opacity-50"
          placeholder={`What ${bName} was actually trying to express…`}
          value={bRealMeaning}
          onChange={(e) => setBMeaning(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-3">
          Shared clarification / mutual understanding
        </label>
        <textarea
          rows={3}
          disabled={!canEdit}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y disabled:opacity-50"
          placeholder="What you both agree on, or what became clearer…"
          value={clarification}
          onChange={(e) => setClarification(e.target.value)}
        />
      </div>

      {canEdit && (
        <div className="flex justify-end gap-3 items-center">
          {saved && <span className="text-sm text-green-400">Saved</span>}
          <Button variant="secondary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
