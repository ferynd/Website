"use client";

import React, { useId } from 'react';
import Input from '@/components/Input';
import type { TripParticipant } from '../../pageTypes';
import type { Ledger } from '../../utils/ledger';
import { formatMoney } from '../../utils/money';
import { capProgress, parseCapInput } from '../../utils/tripSettings';

interface BudgetCapsSectionProps {
  participants: TripParticipant[];
  ledger: Ledger;
  caps: Record<string, string>;
  readOnly: boolean;
  messageIds: string;
  onChange: (id: string, value: string) => void;
}

/** Per-traveler cap inputs and progress against saved final responsibility. */
export default function BudgetCapsSection({
  participants,
  ledger,
  caps,
  readOnly,
  messageIds,
  onChange,
}: BudgetCapsSectionProps) {
  const titleId = useId();
  const helpId = useId();
  const describedBy = [helpId, messageIds].filter(Boolean).join(' ');

  return (
    <section className="min-w-0 space-y-3 rounded-lg bg-surface-1 p-4 shadow" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-text">Budget caps</h2>
      <p id={helpId} className="text-sm text-text-2">
        Maximum final responsibility per traveler. Leave blank for no cap. Progress uses current final responsibility, after saved cap adjustments.
      </p>
      <div className="space-y-4">
        {participants.map((person) => {
          const value = caps[person.id] ?? '';
          const capCents = parseCapInput(value);
          const invalid = value.trim() !== '' && capCents === null;
          const final = ledger.final[person.id] ?? 0;
          const progress = capCents !== null ? capProgress(final, capCents) : null;
          const invalidId = `${helpId}-${person.id}-invalid`;
          const marker = progress?.overCap
            ? 'Over cap'
            : progress?.atCap
              ? 'At cap'
              : progress?.nearCap
                ? 'Near cap'
                : '';
          return (
            <div key={person.id} className="min-w-0 space-y-2">
              <label className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-text-2">
                <span className="min-w-0 flex-1 basis-40 break-words [overflow-wrap:anywhere]">
                  {person.name} cap ($)
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  readOnly={readOnly}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${describedBy} ${invalidId}` : describedBy}
                  className="w-28 min-w-0 shrink-0 px-3 py-2"
                  onChange={(event) => onChange(person.id, event.target.value)}
                />
              </label>
              {progress && capCents !== null ? (
                <div className="min-w-0 space-y-1 text-sm text-text">
                  <p className="break-words [overflow-wrap:anywhere]">
                    {formatMoney(final)} of {formatMoney(capCents)}
                    {marker ? <span className="ml-2 text-warning">{marker}</span> : null}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={`${person.name} budget cap used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.percent}
                    aria-valuetext={`${formatMoney(final)} of ${formatMoney(capCents)}${marker ? `, ${marker}` : ''}`}
                    className="h-2 overflow-hidden rounded bg-surface-3"
                  >
                    <div
                      className={`h-full ${progress.overCap || progress.atCap || progress.nearCap ? 'bg-warning' : 'bg-accent'}`}
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-3">
                  {formatMoney(final)} final responsibility
                  {value.trim() === '' ? ' · No cap' : ''}
                </p>
              )}
              <p id={invalidId} className="text-sm text-error">
                {invalid ? 'Enter a non-negative amount in dollars and cents.' : ''}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
