"use client";

import React, { useEffect, useId, useState } from 'react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { formatMoney } from '../../utils/money';
import {
  overagePreview,
  parseSettingsDraft,
  previewSettings,
  savedSettingsMatch,
  settingsAreStale,
  settingsDraft,
  tripRevision,
  type TripSettingsDraft,
  type TripSettingsFields,
} from '../../utils/tripSettings';
import AuditLog from './AuditLog';
import BudgetCapsSection from './BudgetCapsSection';
import DefaultSplitSection from './DefaultSplitSection';
import OverageSection from './OverageSection';
import ParticipantsSection from './ParticipantsSection';

interface ParticipantsSettingsTabProps {
  userProfile: UserProfile | null;
  onDeleteParticipant: (id: string) => void;
}

const emptyDraft = (): TripSettingsDraft => ({
  caps: {},
  overageType: 'even',
  overageShares: {},
  defaultShares: {},
});

/**
 * Participants, caps, overage, default split, and the audit log.
 * Caps, overage, and the default split share one validated write.
 */
export default function ParticipantsSettingsTab({
  userProfile,
  onDeleteParticipant,
}: ParticipantsSettingsTabProps) {
  const {
    trip,
    participants,
    ledger,
    auditEntries,
    updateTripSettings,
  } = useTrip();
  const admin = Boolean(userProfile?.isAdmin);
  const formId = useId();
  const errorId = `${formId}-errors`;
  const warningId = `${formId}-warning`;
  const staleId = `${formId}-stale`;
  const messageIds = [errorId, warningId, staleId].join(' ');

  const [draft, setDraft] = useState<TripSettingsDraft>(() => (trip ? settingsDraft(trip) : emptyDraft()));
  const [baseline, setBaseline] = useState(() => (trip ? tripRevision(trip) : ''));
  const [dirty, setDirty] = useState(false);
  const [overwriteRevision, setOverwriteRevision] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [pending, setPending] = useState<{
    settings: TripSettingsFields;
    succeeded: boolean;
  } | null>(null);
  const revision = trip ? tripRevision(trip) : '';
  const overwrite = overwriteRevision !== undefined && overwriteRevision === revision;

  useEffect(() => {
    if (overwriteRevision !== undefined && overwriteRevision !== revision) {
      setOverwriteRevision(undefined);
    }
  }, [overwriteRevision, revision]);

  useEffect(() => {
    if (!trip) return;
    if (pending) {
      // A matching local snapshot is optimistic until the server accepts it.
      // Keep the typed draft and dirty flag through a rejection and rollback.
      if (pending.succeeded && savedSettingsMatch(trip, pending.settings)) {
        setPending(null);
        setDirty(false);
        setOverwriteRevision(undefined);
        setBaseline(tripRevision(trip));
        setDraft(settingsDraft(trip));
      }
      return;
    }
    if (dirty) return;
    setBaseline(tripRevision(trip));
    setDraft(settingsDraft(trip));
  }, [trip, dirty, pending]);

  const ids = participants.map((person) => person.id);
  const parsed = parseSettingsDraft(draft, ids);
  const preview = parsed.errors.length === 0 ? previewSettings(ledger, parsed.settings) : null;
  const eligibility = preview ? overagePreview(preview, parsed.settings.overageSplit, ledger.travelerIds) : null;
  const ownWrite = Boolean(trip && pending && savedSettingsMatch(trip, pending.settings));
  // A clean form refreshes from the snapshot. A dirty form must confirm before
  // it can overwrite settings that changed after the form diverged.
  const revisionMismatch = Boolean(trip && !ownWrite && settingsAreStale(baseline, trip));
  const stale = revisionMismatch && dirty;
  const uncoveredCents = preview && preview.unallocatedCents > 0 ? preview.unallocatedCents : 0;
  const readOnly = !admin || saving;

  const edit = (update: (current: TripSettingsDraft) => TripSettingsDraft) => {
    if (readOnly) return;
    setPending(null);
    setDirty(true);
    setSaveError('');
    setDraft(update);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trip || !admin || saving || parsed.errors.length > 0) return;
    const isStale = settingsAreStale(baseline, trip);
    if (isStale && (!dirty || !overwrite)) return;
    setSaving(true);
    setSaveError('');
    setPending({ settings: parsed.settings, succeeded: false });
    try {
      await updateTripSettings(parsed.settings, baseline, isStale ? overwriteRevision : undefined);
      // The matching snapshot can arrive on either side of this promise.
      setPending({ settings: parsed.settings, succeeded: true });
    } catch (failure) {
      setPending(null);
      setDirty(true);
      setSaveError(failure instanceof Error ? failure.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ParticipantsSection userProfile={userProfile} onDeleteParticipant={onDeleteParticipant} />
      <form className="min-w-0 space-y-4" onSubmit={(event) => void save(event)}>
        {!admin && (
          <p className="text-sm text-text-3">Only an admin can change budget caps, overage, and the default split.</p>
        )}
        <BudgetCapsSection
          participants={participants}
          ledger={ledger}
          caps={draft.caps}
          readOnly={readOnly}
          messageIds={messageIds}
          onChange={(id, value) => edit((current) => ({ ...current, caps: { ...current.caps, [id]: value } }))}
        />
        <OverageSection
          participants={participants}
          type={draft.overageType}
          shares={draft.overageShares}
          preview={eligibility}
          fallbackUsed={Boolean(preview?.fallbackUsed)}
          readOnly={readOnly}
          messageIds={messageIds}
          onType={(overageType) => edit((current) => ({ ...current, overageType }))}
          onShare={(id, value) => edit((current) => ({
            ...current,
            overageShares: { ...current.overageShares, [id]: value },
          }))}
        />
        <DefaultSplitSection
          participants={participants}
          shares={draft.defaultShares}
          readOnly={readOnly}
          messageIds={messageIds}
          onChange={(id, value) => edit((current) => ({
            ...current,
            defaultShares: { ...current.defaultShares, [id]: value },
          }))}
        />
        <div className="min-w-0 space-y-3">
          <p id={warningId} aria-live="polite" className="break-words text-sm text-warning [overflow-wrap:anywhere]">
            {uncoveredCents > 0
              ? `These caps leave ${formatMoney(uncoveredCents)} not covered by anyone. You can still save. The ledger will show that amount and pause settlement suggestions until a cap is raised or someone without a cap can absorb it.`
              : ''}
          </p>
          <p id={staleId} aria-live="polite" className="break-words text-sm text-warning [overflow-wrap:anywhere]">
            {stale
              ? 'The trip changed while you were editing. Review the latest trip before saving anyway.'
              : ''}
          </p>
          {stale && admin && (
            <label className="flex min-w-0 items-start gap-2 text-sm text-text-2">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={overwrite}
                onChange={(event) => setOverwriteRevision(event.target.checked ? revision : undefined)}
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                Save anyway — overwrite budget caps, overage, and the default split
              </span>
            </label>
          )}
          <ul id={errorId} aria-live="polite" className="list-disc space-y-1 pl-5 text-sm text-error">
            {parsed.errors.map((message) => (
              <li key={message} className="break-words [overflow-wrap:anywhere]">{message}</li>
            ))}
          </ul>
          {saveError && (
            <p role="alert" className="break-words text-sm text-error [overflow-wrap:anywhere]">{saveError}</p>
          )}
          {admin && (
            <Button
              type="submit"
              variant="success"
              className="w-full max-w-full"
              loading={saving}
              disabled={saving || parsed.errors.length > 0 || (revisionMismatch && (!dirty || !overwrite))}
              aria-describedby={messageIds}
            >
              {saving ? 'Saving…' : stale ? 'Save anyway' : 'Save settings'}
            </Button>
          )}
        </div>
      </form>
      {admin && (
        <AuditLog
          entries={auditEntries}
          show={showAuditLog}
          onToggle={() => setShowAuditLog((shown) => !shown)}
        />
      )}
    </>
  );
}
