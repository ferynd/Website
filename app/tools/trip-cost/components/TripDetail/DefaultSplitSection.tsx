"use client";

import React, { useId } from 'react';
import Input from '@/components/Input';
import type { TripParticipant } from '../../pageTypes';
import { defaultSplitTotalInvalid, enteredPercentTotal } from '../../utils/tripSettings';

interface DefaultSplitSectionProps {
  participants: TripParticipant[];
  shares: Record<string, string>;
  readOnly: boolean;
  messageIds: string;
  onChange: (id: string, value: string) => void;
}

/** Blank fields mean even. A partial default warns that missing travelers start at 0%. */
export default function DefaultSplitSection({
  participants,
  shares,
  readOnly,
  messageIds,
  onChange,
}: DefaultSplitSectionProps) {
  const titleId = useId();
  const helpId = useId();
  const warningId = useId();
  const totalId = useId();
  const describedBy = [helpId, warningId, totalId, messageIds].filter(Boolean).join(' ');
  const currentShares = Object.fromEntries(
    participants.map((person) => [person.id, shares[person.id] ?? '']),
  );
  const hasDefault = Object.values(currentShares).some((value) => value.trim() !== '');
  const missing = hasDefault ? participants.filter((person) => !currentShares[person.id].trim()) : [];
  const total = enteredPercentTotal(currentShares);
  const totalLabel = total === null
    ? 'Enter percentages as numbers.'
    : `Total: ${total.toFixed(2)}% / 100%`;

  return (
    <section className="min-w-0 space-y-3 rounded-lg bg-surface-1 p-4 shadow" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-text">Default split</h2>
      <p id={helpId} className="text-sm text-text-2">
        Pre-fills new expenses; never changes saved ones. Leave every field blank for equal splitting.
      </p>
      <div className="space-y-2">
        {participants.map((person) => (
          <label key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-text-2">
            <span className="min-w-0 flex-1 basis-40 break-words [overflow-wrap:anywhere]">
              {person.name} default (%)
            </span>
            <Input
              type="text"
              inputMode="decimal"
              value={shares[person.id] ?? ''}
              readOnly={readOnly}
              aria-describedby={describedBy}
              className="w-24 min-w-0 shrink-0 px-3 py-2"
              onChange={(event) => onChange(person.id, event.target.value)}
            />
          </label>
        ))}
      </div>
      <p
        id={warningId}
        aria-live="polite"
        className="break-words text-sm text-warning [overflow-wrap:anywhere]"
      >
        {missing.length > 0
          ? `Missing from the default: ${missing.map((person) => person.name).join(', ')}. They start at 0% on new expenses using this default.`
          : ''}
      </p>
      <p
        id={totalId}
        className={`text-sm ${total !== null && defaultSplitTotalInvalid(total) ? 'text-warning' : 'text-text-3'}`}
      >
        {total !== null || hasDefault
          ? totalLabel
          : ''}
      </p>
    </section>
  );
}
