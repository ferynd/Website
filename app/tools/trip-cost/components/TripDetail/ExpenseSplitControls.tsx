"use client";

import React, { useId } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { expenseExplicitZero, expenseMethodOptions, expensePreviewLabel, expenseSharesAwaitTotal, expenseZerosAwaitTotal, type DraftPreview, type ExpenseEditorMethod, type ExpenseEditorState } from '../../utils/expenseDraft';
import type { Person } from '../../pageTypes';

interface SplitMethodControlProps {
  state: ExpenseEditorState;
  hasDefault: boolean;
  onChange: (method: ExpenseEditorMethod) => void;
}

/** Native radios provide arrow-key navigation and one tab stop for the group. */
export function SplitMethodControl({ state, hasDefault, onChange }: SplitMethodControlProps) {
  const name = useId();
  const awaitingTotal = expenseSharesAwaitTotal(state);
  const methods = expenseMethodOptions(hasDefault);
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
              aria-describedby={`${name}-hint`}
              className="peer sr-only"
              onChange={() => onChange(method.value)}
            />
            <span className="block cursor-pointer whitespace-nowrap rounded-md px-2 py-2 text-center text-sm text-text-2 peer-checked:bg-accent peer-checked:text-black peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {method.label}
            </span>
          </label>
        ))}
      </div>
      <p id={`${name}-hint`} className="mt-2 text-sm text-text-3">
        {awaitingTotal ? 'Enter the amount first; shares are converted from the current split.' : 'Custom $ and Custom % convert your values when you switch.'}
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
  const hintId = useId();
  const awaitingTotal = expenseSharesAwaitTotal(state);
  const zerosAwaitTotal = expenseZerosAwaitTotal(state);
  const describedBy = zerosAwaitTotal ? `${errorId} ${hintId}` : errorId;
  const custom = state.method === 'amount' || state.method === 'percent';
  return (
    <section className="min-w-0" aria-label="Split preview">
      <h3 className="font-semibold text-text">Split preview</h3>
      {preview?.notFinal && <p className="mt-2 text-sm text-warning">Entered shares are not final. Fix the split totals above before saving.</p>}
      {zerosAwaitTotal && (
        <p id={hintId} className="mt-2 text-sm text-text-3">
          {awaitingTotal
            ? 'Enter the amount first; shares are converted from the current split. Share inputs and explicit zeros will then be available.'
            : 'Enter the amount first to use explicit zeros.'}
        </p>
      )}
      <ul className="mt-2 divide-y divide-border">
        {travelers.map((person) => {
          const included = draft.splitParticipants.includes(person.id);
          const value = draft.manualSplit[person.id]?.value ?? '';
          const zero = expenseExplicitZero(state, person.id);
          return (
            <li key={person.id} className="min-w-0 space-y-2 py-3 text-sm">
              <div className="flex min-w-0 flex-wrap justify-between gap-2">
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-text-2">{person.name}</span>
                <span className="shrink-0 tabular-nums text-text">
                  {expensePreviewLabel(state, preview, person.id)}
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
                      disabled={zerosAwaitTotal}
                      aria-describedby={describedBy}
                      onChange={(event) => onZero(person.id, event.target.checked)}
                    />
                    <span>Explicit zero for <span className="sr-only">{person.name}</span><span aria-hidden="true">this traveler</span></span>
                  </label>
                  {custom && (
                    <div className="flex min-w-0 items-center gap-1">
                      <Input
                        aria-label={`${draft.manualSplitMode === 'percent' ? 'Percent' : 'Dollar'} share for ${person.name}`}
                        aria-describedby={describedBy}
                        readOnly={awaitingTotal}
                        type="text"
                        inputMode="decimal"
                        className="w-28 min-w-0 !px-2 !py-2"
                        value={value}
                        onChange={(event) => onValue(person.id, event.target.value)}
                      />
                      {awaitingTotal && <span className="text-text-2" aria-hidden="true">%</span>}
                    </div>
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
