"use client";

import React, { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import Dialog from '../ui/Dialog';
import { useTrip } from '../../TripContext';
import { expenseToDraft } from '../../utils/expenseDraft';
import { describeProblem, makeNameOf } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';
import { expensePayerAmounts, splitMethodLabel } from '../../utils/ledgerView';
import type { ExpenseDraft, UserProfile } from '../../pageTypes';

interface ExpenseDetailSheetProps {
  expenseId: string | null;
  userProfile: UserProfile | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

/** Inspect an expense and expose the existing limited description/amount editor. */
export default function ExpenseDetailSheet({ expenseId, userProfile, onClose, onDelete }: ExpenseDetailSheetProps) {
  const { expenses, participants, ledger, updateExpense } = useTrip();
  const expense = expenses.find((item) => item.id === expenseId);
  const allocation = ledger.expenses.find((item) => item.expenseId === expenseId);
  const currentExpense = useRef(expense);
  currentExpense.current = expense;
  const saveRequest = useRef(0);
  const canModify = Boolean(expense && (userProfile?.isAdmin || expense.createdBy === userProfile?.uid));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    saveRequest.current += 1;
    // Firestore snapshots replace expense objects; only a different record should discard edits.
    const nextExpense = currentExpense.current;
    setEditing(false);
    setDraft(nextExpense ? expenseToDraft(nextExpense) : null);
    setError('');
  }, [expenseId]);

  if (!expense || !allocation) return null;

  const participantName = (id: string) => participants.find((person) => person.id === id)?.name ?? 'Unknown';
  const creator = expense.createdBy === userProfile?.uid
    ? 'You'
    : participants.find((person) => person.userId === expense.createdBy)?.name ?? 'Another member';

  const save = async () => {
    if (!draft) return;
    const request = ++saveRequest.current;
    const requestExpenseId = expense.id;
    setSaving(true);
    setError('');
    try {
      await updateExpense(expense.id, draft);
      if (saveRequest.current !== request || currentExpense.current?.id !== requestExpenseId) return;
      setEditing(false);
    } catch (saveError) {
      if (saveRequest.current !== request || currentExpense.current?.id !== requestExpenseId) return;
      setError(saveError instanceof Error ? saveError.message : 'Could not update expense.');
    } finally {
      if (saveRequest.current === request) setSaving(false);
    }
  };

  const footer = editing ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
      <Button variant="success" loading={saving} onClick={() => void save()}>Save</Button>
    </div>
  ) : canModify ? (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        onClick={() => {
          setDraft(expenseToDraft(expense));
          setEditing(true);
        }}
      >
        Edit
      </Button>
      <Button variant="danger" onClick={() => onDelete(expense.id)}>Delete</Button>
    </div>
  ) : (
    <p className="text-sm text-text-3">Only the creator or an admin can edit.</p>
  );

  return (
    <Dialog open title={editing ? `Edit ${expense.description}` : expense.description} onClose={onClose} dismissible={!saving} footer={footer}>
      {editing && draft ? (
        <div className="space-y-3">
          <label className="block text-sm">
            Description
            <input
              className="mt-1 w-full min-w-0 rounded border border-border bg-surface-2 p-2 text-text"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="block text-sm">
            Amount
            <input
              className="mt-1 w-full min-w-0 rounded border border-border bg-surface-2 p-2 text-text"
              type="number"
              step="0.01"
              value={draft.totalAmount}
              onChange={(event) => setDraft({ ...draft, totalAmount: event.target.value })}
            />
          </label>
          {error && <p role="alert" className="text-error">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4 text-sm text-text-2">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-text-3">Category</dt>
              <dd>{expense.category}</dd>
            </div>
            <div>
              <dt className="text-text-3">Total</dt>
              <dd className="font-semibold text-text">{formatMoney(allocation.totalCents)}</dd>
            </div>
            <div>
              <dt className="text-text-3">Date</dt>
              <dd>{expense.createdAt?.toDate().toLocaleDateString() ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="text-text-3">Created by</dt>
              <dd>{creator}</dd>
            </div>
          </dl>
          <section>
            <h3 className="font-semibold text-text">Paid by</h3>
            <ul>
              {Object.entries(expensePayerAmounts(allocation.payers, expense.paidBy ?? {})).map(([id, cents]) => (
                <li key={id}>{participantName(id) === 'Unknown' ? 'Unknown traveler' : participantName(id)} · {formatMoney(cents)}</li>
              ))}
            </ul>
          </section>
          <p>
            Split method: {splitMethodLabel(expense)}
          </p>
          <section>
            <h3 className="font-semibold text-text">Traveler shares</h3>
            <ul className="divide-y divide-border">
              {participants.map((person) => {
                const included = Object.hasOwn(allocation.shares, person.id);
                const share = allocation.shares[person.id];
                return (
                  <li key={person.id} className="flex justify-between py-2">
                    <span>{person.name}</span>
                    <span>{included ? share === 0 ? '$0.00 (explicit)' : formatMoney(share) : 'Not included'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          {allocation.problems.length > 0 && (
            <section className="rounded border border-error/30 bg-error/10 p-3 text-error">
              <h3 className="font-semibold">Row problems</h3>
              <ul className="list-disc pl-5">
                {allocation.problems.map((problem, index) => (
                  <li key={`${problem.kind}-${index}`}>
                    {describeProblem(problem, ledger, makeNameOf(participants))}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
