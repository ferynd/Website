"use client";

import React from 'react';
import Button from '@/components/Button';
import Dialog from '../ui/Dialog';
import { useTrip } from '../../TripContext';
import { describeProblem, hasInvalidShare, makeNameOf } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';
import { expensePayerAmounts, splitMethodLabel } from '../../utils/ledgerView';
import type { Expense, UserProfile } from '../../pageTypes';

interface ExpenseDetailSheetProps {
  expenseId: string | null;
  userProfile: UserProfile | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onEdit: (expense: Expense) => void;
}

/** Inspect an expense; editing uses the shared ExpenseEditor. */
export default function ExpenseDetailSheet({ expenseId, userProfile, onClose, onDelete, onEdit }: ExpenseDetailSheetProps) {
  const { expenses, participants, ledger } = useTrip();
  const expense = expenses.find((item) => item.id === expenseId);
  const allocation = ledger.expenses.find((item) => item.expenseId === expenseId);
  const canModify = Boolean(expense && (userProfile?.isAdmin || expense.createdBy === userProfile?.uid));

  if (!expense || !allocation) return null;

  const participantName = (id: string) => participants.find((person) => person.id === id)?.name ?? 'Unknown';
  const creator = expense.createdBy === userProfile?.uid
    ? 'You'
    : participants.find((person) => person.userId === expense.createdBy)?.name ?? 'Another member';

  const footer = canModify ? (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        onClick={() => onEdit(expense)}
      >
        Edit
      </Button>
      <Button variant="danger" onClick={() => onDelete(expense.id)}>Delete</Button>
    </div>
  ) : (
    <p className="text-sm text-text-3">Only the creator or an admin can edit.</p>
  );

  return (
    <Dialog open title={expense.description} onClose={onClose} footer={footer}>
      <div className="space-y-4 text-sm text-text-2">
        <dl className="grid min-w-0 grid-cols-2 gap-3 break-words [overflow-wrap:anywhere]">
          <div className="min-w-0">
            <dt className="text-text-3">Category</dt>
            <dd>{expense.category}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-3">Total</dt>
            <dd className="font-semibold text-text">{formatMoney(allocation.totalCents)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-3">Date</dt>
            <dd>{expense.createdAt?.toDate().toLocaleDateString() ?? 'Not recorded'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-3">Created by</dt>
            <dd>{creator}</dd>
          </div>
        </dl>
        <section>
          <h3 className="font-semibold text-text">Paid by</h3>
          <ul>
            {Object.entries(expensePayerAmounts(allocation.payers, expense.paidBy ?? {})).map(([id, cents]) => (
              <li key={id} className="break-words [overflow-wrap:anywhere]">{participantName(id) === 'Unknown' ? 'Unknown traveler' : participantName(id)} · {formatMoney(cents)}</li>
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
                <li key={person.id} className="flex min-w-0 justify-between gap-3 py-2">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{person.name}</span>
                  <span className="shrink-0">{included ? hasInvalidShare(allocation.problems, person.id) ? 'Invalid share' : share === 0 ? '$0.00 (explicit)' : formatMoney(share) : 'Not included'}</span>
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
    </Dialog>
  );
}
