"use client";

import { useState } from 'react';
import Button from '@/components/Button';
import type { Conflict, SharedSectionPatch, Tracker } from '../lib/types';

interface Props {
  conflict: Conflict;
  tracker: Tracker;
  authorUid: string;
  isAdmin: boolean;
  onSave: (patch: SharedSectionPatch) => Promise<void>;
}

const TA = ({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled: boolean;
}) => (
  <div className="space-y-1">
    <label className="block text-xs font-semibold uppercase tracking-wide text-text-3">{label}</label>
    <textarea
      rows={3}
      disabled={disabled}
      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y disabled:opacity-50"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default function SharedSection({ conflict, tracker, authorUid, isAdmin, onSave }: Props) {
  // Phase gate: section is locked until both reflections are submitted
  const bothSubmitted = conflict.hasReflectionA && conflict.hasReflectionB;

  // Permission: creator (= personA) or admin can edit; Person B can view
  const isCreator = tracker.createdBy === authorUid;
  const isPersonA = tracker.personAUid === authorUid;
  const canEdit = isCreator || isPersonA || isAdmin;

  const [aRealMeaning, setAMeaning] = useState(conflict.personARealMeaning ?? '');
  const [bRealMeaning, setBMeaning] = useState(conflict.personBRealMeaning ?? '');
  const [clarification, setClarification] = useState(conflict.sharedClarification ?? '');
  const [ownershipNotes, setOwnershipNotes] = useState(conflict.sharedOwnershipNotes ?? '');
  const [nextSteps, setNextSteps] = useState(conflict.sharedNextSteps ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        personARealMeaning: aRealMeaning.trim() || undefined,
        personBRealMeaning: bRealMeaning.trim() || undefined,
        sharedClarification: clarification.trim() || undefined,
        sharedOwnershipNotes: ownershipNotes.trim() || undefined,
        sharedNextSteps: nextSteps.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
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
          meant, and note any commitments or next steps.
        </p>
        {!canEdit && (
          <p className="text-xs text-text-3 mt-1">
            {aName} or an admin can edit this section. You can view it.
          </p>
        )}
        {conflict.sharedUpdatedBy && (
          <p className="text-xs text-text-3 mt-1">
            Last updated by {conflict.sharedUpdatedBy === authorUid ? 'you' : 'your partner'}.
          </p>
        )}
      </div>

      <TA
        label={`What ${aName} actually meant`}
        value={aRealMeaning}
        onChange={setAMeaning}
        placeholder={`What ${aName} was actually trying to express…`}
        disabled={!canEdit}
      />

      <TA
        label={`What ${bName} actually meant`}
        value={bRealMeaning}
        onChange={setBMeaning}
        placeholder={`What ${bName} was actually trying to express…`}
        disabled={!canEdit}
      />

      <TA
        label="Shared clarification / mutual understanding"
        value={clarification}
        onChange={setClarification}
        placeholder="What you both agree on, or what became clearer…"
        disabled={!canEdit}
      />

      <TA
        label="Shared ownership notes"
        value={ownershipNotes}
        onChange={setOwnershipNotes}
        placeholder="What each person is taking responsibility for…"
        disabled={!canEdit}
      />

      <TA
        label="Next steps"
        value={nextSteps}
        onChange={setNextSteps}
        placeholder="Concrete things you're both committing to…"
        disabled={!canEdit}
      />

      {error && (
        <p className="text-sm text-error">{error}</p>
      )}

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
