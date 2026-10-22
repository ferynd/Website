"use client";

import React, { useId } from 'react';
import Input from '@/components/Input';
import type { OverageSplit, TripParticipant } from '../../pageTypes';
import { formatNormalizedShare, type OveragePreview } from '../../utils/tripSettings';

interface OverageSectionProps {
  participants: TripParticipant[];
  type: OverageSplit['type'];
  shares: Record<string, string>;
  preview: OveragePreview | null;
  fallbackUsed: boolean;
  readOnly: boolean;
  messageIds: string;
  onType: (type: OverageSplit['type']) => void;
  onShare: (id: string, value: string) => void;
}

/** Even or custom overage, plus who absorbs cost under the current caps. */
export default function OverageSection({
  participants,
  type,
  shares,
  preview,
  fallbackUsed,
  readOnly,
  messageIds,
  onType,
  onShare,
}: OverageSectionProps) {
  const titleId = useId();
  const helpId = useId();
  const groupName = useId();
  const describedBy = [helpId, messageIds].filter(Boolean).join(' ');
  const nameOf = (id: string) => participants.find((person) => person.id === id)?.name ?? 'Unknown traveler';
  const list = (ids: string[]) => (ids.length ? ids.map(nameOf).join(', ') : 'Nobody');
  const showFallback = Boolean(preview?.fallback || fallbackUsed);

  return (
    <section className="min-w-0 space-y-3 rounded-lg bg-surface-1 p-4 shadow" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-text">Overage redistribution</h2>
      <fieldset className="min-w-0 space-y-2" aria-describedby={describedBy}>
        <legend className="text-sm text-text-2">How over-cap costs are shared</legend>
        {([
          ['even', 'Evenly among everyone not at their cap'],
          ['manual', 'Custom shares'],
        ] as const).map(([value, label]) => (
          <label key={value} className="block min-w-0">
            <Input
              type="radio"
              name={groupName}
              value={value}
              checked={type === value}
              disabled={readOnly}
              aria-describedby={describedBy}
              className="peer sr-only"
              onChange={() => onType(value)}
            />
            <span className="block min-w-0 break-words rounded-md border border-border px-3 py-2 text-sm text-text-2 peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-disabled:opacity-70 [overflow-wrap:anywhere]">
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      <p id={helpId} className="text-sm text-text-2">
        Travelers with no expense share, including later additions, can absorb over-cap costs.
      </p>
      {type === 'manual' && (
        <div className="space-y-2">
          <p className="text-sm text-text-3">
            Shares are normalized among eligible travelers. A blank share receives no overage unless nobody eligible has a positive share; then the ledger uses an even split.
          </p>
          {participants.map((person) => (
            <label key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-text-2">
              <span className="min-w-0 flex-1 basis-40 break-words [overflow-wrap:anywhere]">
                {person.name} overage share (%)
              </span>
              <Input
                type="text"
                inputMode="decimal"
                value={shares[person.id] ?? ''}
                readOnly={readOnly}
                aria-describedby={describedBy}
                className="w-24 min-w-0 shrink-0 px-3 py-2"
                onChange={(event) => onShare(person.id, event.target.value)}
              />
            </label>
          ))}
        </div>
      )}
      <div aria-live="polite" className="min-w-0 space-y-2 break-words text-sm text-text [overflow-wrap:anywhere]">
        {preview ? (
          <>
            <p>Currently absorbs: {list(preview.absorbing)}.</p>
            <p>Eligible for further overage: {list(preview.eligible)}.</p>
            {preview.eligible.length > 0 && (
              <ul className="space-y-1 text-text-2">
                {preview.eligible.map((id) => (
                  <li key={id} className="break-words [overflow-wrap:anywhere]">
                    {nameOf(id)}: {formatNormalizedShare(preview.normalized[id] ?? 0)} of further overage
                  </li>
                ))}
              </ul>
            )}
            {showFallback && (
              <p className="text-warning">Custom shares cover nobody eligible; even redistribution is used.</p>
            )}
          </>
        ) : (
          <p className="text-text-3">Enter valid settings to preview eligibility.</p>
        )}
      </div>
    </section>
  );
}
