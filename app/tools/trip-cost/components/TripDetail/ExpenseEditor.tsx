"use client";

import React, { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Dialog from '../ui/Dialog';
import PayerPicker from './PayerPicker';
import { SplitMethodControl, SplitPreview, TravelerChips } from './ExpenseSplitControls';
import { useTrip } from '../../TripContext';
import { EXPENSE_CATEGORIES } from '../../constants';
import {
  changeExpenseMethod,
  createExpenseEditor,
  draftToExpenseFields,
  expenseEditorError,
  hasTripDefault,
  setExpenseExplicitZero,
  toggleExpenseTraveler,
  travelersMissingFromDefault,
  validateDraft,
  type ExpenseFields,
} from '../../utils/expenseDraft';
import { expenseEditStatus, expenseRevision, isCurrentExpenseSave } from '../../utils/expenseSave';
import { uniqueLinkedParticipant } from '../../utils/payer';
import type { Expense, UserProfile } from '../../pageTypes';

interface ExpenseEditorProps {
  /** A snapshot captured when Edit was opened, not the live context object. */
  original?: Expense;
  userProfile: UserProfile | null;
  onClose: () => void;
  onSaved: (fields: ExpenseFields) => void;
}

/** Mount one editor session per opening. Dialog owns scrolling, focus, and dismissal. */
export default function ExpenseEditor({ original, userProfile, onClose, onSaved }: ExpenseEditorProps) {
  const { trip, expenses, participants, addExpense, updateExpense } = useTrip();
  const travelerIds = participants.map((person) => person.id);
  const [defaultSplit] = useState(trip?.defaultSplit);
  const [state, setState] = useState(() => createExpenseEditor(
    travelerIds,
    EXPENSE_CATEGORIES[0],
    defaultSplit,
    uniqueLinkedParticipant(participants, userProfile?.uid)?.id,
    original,
  ));
  const [multiple, setMultiple] = useState(Object.keys(state.draft.paidBy).length > 1);
  const [advanced, setAdvanced] = useState(state.draft.splitType === 'manual');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<string | null>(null);
  const busy = useRef(false);
  const request = useRef(0);
  const activeSession = useRef<string | null>(original?.id ?? 'add');
  const formId = useId();
  const reasonId = `${formId}-reason`;
  const payerErrorId = `${formId}-payers`;
  const splitErrorId = `${formId}-split`;
  const currentExpense = expenses.find((expense) => expense.id === original?.id);
  const status = original ? expenseEditStatus(original, currentExpense) : 'unchanged';
  const revision = currentExpense ? expenseRevision(currentExpense) : null;
  const latest = useRef({ status, revision });
  latest.current = { status, revision };

  useEffect(() => {
    activeSession.current = original?.id ?? 'add';
    return () => {
      activeSession.current = null;
      request.current += 1;
    };
  }, [original?.id]);

  const { draft } = state;
  const context = { travelerIds, original };
  const validation = validateDraft(draft, context);
  const errorsFor = (field: 'description' | 'total' | 'payers' | 'split') =>
    validation.errors.filter((error) => error.field === field).map(expenseEditorError);
  const reason = status === 'deleted' ? 'This expense was deleted. Saving is disabled.'
    : status === 'changed' && acknowledgedRevision !== revision ? 'Confirm Save anyway before overwriting the changed expense.'
      : saving ? 'Saving expense…' : validation.errors.map(expenseEditorError).join(' ');
  const unknownIds = new Set([
    ...Object.keys(draft.paidBy),
    ...draft.splitParticipants,
  ].filter((id) => !travelerIds.includes(id)));
  const travelers = [
    ...participants,
    ...Array.from(unknownIds).map((id) => ({ id, name: `Unknown traveler (${id})` })),
  ];
  const missing = state.method === 'trip-default'
    ? travelersMissingFromDefault(defaultSplit, draft.splitParticipants)
    : [];
  const custom = state.method === 'amount' || state.method === 'percent';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || latest.current.status === 'deleted') return;
    if (latest.current.status === 'changed' && acknowledgedRevision !== latest.current.revision) return;
    const result = draftToExpenseFields(draft, context);
    if (!result.fields) return;
    const requestId = ++request.current;
    const sessionId = original?.id ?? 'add';
    const isCurrent = () => isCurrentExpenseSave(requestId, request.current, sessionId, activeSession.current);
    busy.current = true;
    setSaving(true);
    setSaveError('');
    try {
      if (original) await updateExpense(original.id, draft);
      else await addExpense(draft);
      if (isCurrent()) onSaved(result.fields);
    } catch (error) {
      if (isCurrent()) setSaveError(error instanceof Error ? error.message : 'Could not save expense. Please try again.');
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setSaving(false);
      }
    }
  };

  const footer = (
    <div className="min-w-0 space-y-3">
      <p id={reasonId} aria-live="polite" className="break-words text-sm text-error [overflow-wrap:anywhere]">
        {reason || saveError}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form={formId} variant="success" loading={saving} disabled={Boolean(reason)} aria-describedby={reasonId}>
          {saving ? 'Saving…' : status === 'changed' ? 'Save anyway' : 'Save'}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open title={original ? 'Edit expense' : 'Add expense'} onClose={onClose} footer={footer} dismissible={!saving}>
      <form id={formId} onSubmit={(event) => void save(event)} className="min-w-0 space-y-5" noValidate>
        {status === 'deleted' && <p role="alert" className="text-sm text-error">This expense was deleted while you were editing. Close this editor to continue.</p>}
        {status === 'changed' && (
          <div className="space-y-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-text">
            <p role="status">This expense changed while you were editing. Review your values before overwriting the current expense.</p>
            <label className="flex items-start gap-2">
              <Input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 !p-0"
                checked={acknowledgedRevision === revision}
                onChange={(event) => setAcknowledgedRevision(event.target.checked ? revision : null)}
                aria-describedby={reasonId}
              />
              <span>Save anyway — overwrite these changes</span>
            </label>
          </div>
        )}
        <div className="space-y-3">
          <label className="block text-sm text-text-2">
            Description
            <Input
              className="mt-1 w-full min-w-0"
              value={draft.description}
              aria-invalid={errorsFor('description').length > 0}
              aria-describedby={`${formId}-description`}
              onChange={(event) => setState({ ...state, draft: { ...draft, description: event.target.value } })}
            />
          </label>
          <p id={`${formId}-description`} className="text-sm text-error">{errorsFor('description').join(' ')}</p>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm text-text-2">
              Amount ($)
              <Input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full min-w-0"
                value={draft.totalAmount}
                aria-invalid={errorsFor('total').length > 0}
                aria-describedby={`${formId}-total`}
                onChange={(event) => {
                  const payerId = Object.keys(draft.paidBy)[0];
                  setState({ ...state, draft: {
                    ...draft,
                    totalAmount: event.target.value,
                    paidBy: !multiple && payerId ? { [payerId]: event.target.value } : draft.paidBy,
                  } });
                }}
              />
            </label>
            <label className="block min-w-0 text-sm text-text-2">
              Category
              <Select
                className="mt-1 w-full min-w-0"
                value={draft.category}
                onChange={(event) => setState({ ...state, draft: { ...draft, category: event.target.value } })}
              >
                {!EXPENSE_CATEGORIES.includes(draft.category) && <option value={draft.category}>{draft.category}</option>}
                {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </Select>
            </label>
          </div>
          <p id={`${formId}-total`} className="text-sm text-error">{errorsFor('total').join(' ')}</p>
        </div>
        <PayerPicker
          draft={draft}
          travelers={travelers}
          multiple={multiple}
          onMultiple={(next) => {
            setMultiple(next);
            if (!next) {
              const payerId = Object.keys(draft.paidBy).find((id) => Number(draft.paidBy[id]) > 0);
              setState({ ...state, draft: { ...draft, paidBy: payerId ? { [payerId]: draft.totalAmount } : {} } });
            }
          }}
          onChange={(next) => setState({ ...state, draft: next })}
          errorId={payerErrorId}
          errors={errorsFor('payers')}
        />
        <TravelerChips
          travelers={travelers}
          selected={draft.splitParticipants}
          onToggle={(id) => setState(toggleExpenseTraveler(state, id, travelerIds, defaultSplit))}
          errorId={splitErrorId}
        />
        <SplitMethodControl
          state={state}
          hasDefault={hasTripDefault(defaultSplit)}
          onChange={(method) => setState(changeExpenseMethod(state, method, travelerIds, defaultSplit))}
        />
        {state.method === 'trip-default' && (
          <div className="space-y-1 text-sm text-text-3">
            <p>Saved as a percentage snapshot. Later changes to the trip default won’t change this expense. Percentages below are rescaled across included travelers to cover 100%.</p>
            {missing.map((id) => <p key={id} className="break-words [overflow-wrap:anywhere]">{travelers.find((person) => person.id === id)?.name}: missing from the trip default; included at an explicit 0%.</p>)}
          </div>
        )}
        <div id={splitErrorId} className="space-y-1 text-sm text-error" aria-live="polite">
          {errorsFor('split').map((error) => <p key={error}>{error}</p>)}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advanced || custom}
          aria-controls={`${formId}-preview`}
          onClick={() => setAdvanced(!advanced)}
          disabled={custom}
        >
          {advanced || custom ? 'Split inputs and explicit zeros' : 'Advanced: explicit zero shares'}
        </Button>
        <div id={`${formId}-preview`}>
          <SplitPreview
            travelers={travelers}
            state={state}
            preview={validation.preview}
            showInputs={advanced || custom}
            errorId={splitErrorId}
            onValue={(id, value) => setState({
              ...state,
              draft: {
                ...draft,
                manualSplit: {
                  ...draft.manualSplit,
                  [id]: { type: draft.manualSplitMode, value },
                },
              },
            })}
            onZero={(id, zero) => setState(setExpenseExplicitZero(state, id, zero, travelerIds))}
          />
        </div>
        {saveError && <p role="alert" className="break-words text-sm text-error [overflow-wrap:anywhere]">{saveError}</p>}
      </form>
    </Dialog>
  );
}
