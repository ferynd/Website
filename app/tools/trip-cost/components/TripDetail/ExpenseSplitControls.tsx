"use client";

import React, { useId } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { formatMoney, parseScaledInput } from '../../utils/money';
import { hasInvalidShare } from '../../utils/ledgerLabels';
import type { DraftPreview, ExpenseEditorMethod, ExpenseEditorState } from '../../utils/expenseDraft';
import type { Person } from '../../pageTypes';

interface SplitMethodControlProps {
  state: ExpenseEditorState;
  hasDefault: boolean;
  onChange: (method: ExpenseEditorMethod) => void;
}

/** Native radios provide arrow-key navigation and one tab stop for the group. */
export function SplitMethodControl({ state, hasDefault, onChange }: SplitMethodControlProps) {
  const name = useId();
  const total = parseScaledInput(state.draft.totalAmount, 100);
  const needsTotal = state.draft.splitType === 'manual' && state.draft.manualSplitMode === 'percent' &&
    (total.kind !== 'ok' || total.units <= 0);
  const methods: { value: ExpenseEditorMethod; label: string }[] = [
    { value: 'equal', label: 'Equal' },
    ...(hasDefault ? [{ value: 'trip-default' as const, label: 'Trip default' }] : []),
    { value: 'amount', label: 'Custom $' },
    { value: 'percent', label: 'Custom %' },
  ];
  return (
    <fieldset className="min-w-0" aria-describedby={`${name}-hint`}>
      <legend className="mb-2 font-semibold text-text">Method</legend>
      <div className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
        {methods.map((method) => (
          <label key={method.value} className="min-w-0 flex-auto">
            <Input
              type="radio"
              name={name}
              value={method.value}
              checked={state.method === method.value}
              disabled={needsTotal && method.value === 'amount'}
              aria-describedby={`${name}-hint`}
              className="peer sr-only"
              onChange={() => onChange(method.value)}
            />
            <span className="block cursor-pointer whitespace-nowrap rounded-md px-2 py-2 text-center text-sm text-text-2 peer-checked:bg-accent peer-checked:text-black peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-disabled:cursor-default peer-disabled:opacity-50">
              {method.label}
            </span>
          </label>
        ))}
      </div>
      <p id={`${name}-hint`} className="mt-2 text-sm text-text-3">
        {needsTotal ? 'Enter an amount before converting percentages to Custom $.' : 'Custom $ and Custom % convert your values when you switch.'}
      </p>
    </fieldset>
  );
}

interface TravelerChipsProps {
  travelers: Person[];
  selected: string[];
  onToggle: (id: string) => void;
  errorId: string;
}

export function TravelerChips({ travelers, selected, onToggle, errorId }: TravelerChipsProps) {
  return (
    <fieldset className="min-w-0" aria-describedby={errorId}>
      <legend className="mb-2 font-semibold text-text">Split between</legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {travelers.map((person) => (
          <Button
            key={person.id}
            type="button"
            size="sm"
            variant={selected.includes(person.id) ? 'primary' : 'secondary'}
            aria-pressed={selected.includes(person.id)}
            aria-describedby={errorId}
            className="h-auto min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere]"
            onClick={() => onToggle(person.id)}
          >
            {person.name}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

interface SplitPreviewProps {
  travelers: Person[];
  state: ExpenseEditorState;
  preview: DraftPreview | null;
  showInputs: boolean;
  errorId: string;
  onValue: (id: string, value: string) => void;
  onZero: (id: string, zero: boolean) => void;
}

/** All preview cents come directly from validateDraft / allocateExpense. */
export function SplitPreview({ travelers, state, preview, showInputs, errorId, onValue, onZero }: SplitPreviewProps) {
  const { draft } = state;
  const custom = state.method === 'amount' || state.method === 'percent';
  return (
    <section className="min-w-0" aria-label="Split preview">
      <h3 className="font-semibold text-text">Split preview</h3>
      <ul className="mt-2 divide-y divide-border">
        {travelers.map((person) => {
          const included = draft.splitParticipants.includes(person.id);
          const value = draft.manualSplit[person.id]?.value ?? '';
          const zero = draft.splitType === 'manual' && value.trim() !== '' && Number(value) === 0;
          const share = preview?.shares[person.id];
          return (
            <li key={person.id} className="min-w-0 space-y-2 py-3 text-sm">
              <div className="flex min-w-0 flex-wrap justify-between gap-2">
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-text-2">{person.name}</span>
                <span className="shrink-0 tabular-nums text-text">
                  {!included ? 'Not included' : preview && hasInvalidShare(preview.problems, person.id) ? 'Invalid share'
                    : share === undefined ? preview ? 'Unassigned' : 'Enter an amount'
                      : share === 0 ? '$0.00 (explicit)' : formatMoney(share)}
                </span>
              </div>
              {included && state.method === 'trip-default' && <p className="text-text-3">{value}% of this expense</p>}
              {included && showInputs && (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2 text-text-2">
                    <Input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 !p-0"
                      checked={zero}
                      onChange={(event) => onZero(person.id, event.target.checked)}
                    />
                    <span>Explicit zero for <span className="sr-only">{person.name}</span><span aria-hidden="true">this traveler</span></span>
                  </label>
                  {custom && (
                    <Input
                      aria-label={`${draft.manualSplitMode === 'percent' ? 'Percent' : 'Dollar'} share for ${person.name}`}
                      aria-describedby={errorId}
                      type="text"
                      inputMode="decimal"
                      className="w-28 min-w-0 !px-2 !py-2"
                      value={value}
                      onChange={(event) => onValue(person.id, event.target.value)}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
