"use client";

import React from 'react';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { expensePayerRemainder } from '../../utils/expenseDraft';
import { formatMoney } from '../../utils/money';
import type { ExpenseDraft, Person } from '../../pageTypes';

interface PayerPickerProps {
  draft: ExpenseDraft;
  travelers: Person[];
  multiple: boolean;
  onMultiple: (multiple: boolean) => void;
  onChange: (draft: ExpenseDraft) => void;
  errorId: string;
  errors: string[];
}

/** The common path has one payer; multiple purchase payments are opt-in. */
export default function PayerPicker({ draft, travelers, multiple, onMultiple, onChange, errorId, errors }: PayerPickerProps) {
  const payerId = Object.keys(draft.paidBy)[0] ?? '';
  const remainder = expensePayerRemainder(draft);

  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={errorId}>
      <legend className="mb-2 font-semibold text-text">Paid by</legend>
      {!multiple && (
        <Select
          aria-label="Who paid"
          aria-describedby={errorId}
          aria-invalid={errors.length > 0}
          className="w-full min-w-0"
          value={payerId}
          onChange={(event) => onChange({
            ...draft,
            paidBy: event.target.value ? { [event.target.value]: draft.totalAmount } : {},
          })}
        >
          <option value="">Pick who paid</option>
          {travelers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </Select>
      )}
      <label className="flex min-w-0 items-start gap-2 text-sm text-text-2">
        <Input
          type="checkbox"
          checked={multiple}
          className="mt-1 h-4 w-4 shrink-0 !p-0"
          onChange={(event) => onMultiple(event.target.checked)}
        />
        <span>Split payment between several people</span>
      </label>
      {multiple && (
        <div className="space-y-2">
          {travelers.map((person) => (
            <label key={person.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-text-2">
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{person.name}</span>
              <Input
                aria-label={`Amount paid by ${person.name}`}
                aria-describedby={errorId}
                aria-invalid={errors.length > 0}
                type="text"
                inputMode="decimal"
                className="w-28 min-w-0 shrink-0 !px-2 !py-2"
                value={draft.paidBy[person.id] ?? ''}
                onChange={(event) => onChange({ ...draft, paidBy: { ...draft.paidBy, [person.id]: event.target.value } })}
              />
            </label>
          ))}
          <p className="text-sm tabular-nums text-text-2" aria-live="polite">
            {remainder === null ? 'Enter valid amounts to see the remainder.' : remainder < 0
              ? `Over by ${formatMoney(-remainder)}`
              : `Remaining: ${formatMoney(remainder)}`}
          </p>
        </div>
      )}
      <div id={errorId} className="space-y-1 text-sm text-error" aria-live="polite">
        {errors.map((error) => <p key={error}>{error}</p>)}
      </div>
    </fieldset>
  );
}
