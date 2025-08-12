"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import type { UserProfile, Expense } from '../../pageTypes';

export default function ExpensesList({
  userProfile,
  onDeleteExpense,
}: {
  userProfile: UserProfile | null;
  onDeleteExpense: (id: string) => void;
}) {
  const { expenses, participants } = useTrip();
  if (!expenses.length) return null;

  const name = (id: string) =>
    participants.find((p) => p.id === id)?.name || 'Unknown';

  const payersText = (e: Expense) => {
    const entries = Object.entries(e.paidBy || {});
    return entries.length
      ? entries
          .map(
            ([id, amt]) => `${name(id)} (${CURRENCY_SYMBOL}${Number(amt).toFixed(2)})`
          )
          .join(', ')
      : '—';
  };

  const splitText = (e: Expense) => {
    if (e.splitType === 'even') {
      if (e.splitParticipants.length === 0) {
        return 'Split evenly among everyone';
      }
      return `Split evenly among ${e.splitParticipants
        .map((id: string) => name(id))
        .join(', ')}`;
    }
    return (
      'Split: ' +
      e.splitParticipants
        .map((id: string) => {
          const share = e.manualSplit[id];
          if (!share) return name(id);
          return share.type === 'percent'
            ? `${name(id)} ${share.value}%`
            : `${name(id)} ${CURRENCY_SYMBOL}${Number(share.value).toFixed(2)}`;
        })
        .join(', ')
    );
  };
  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Expenses</h2>
      <table className="w-full text-left text-gray-800">
        <thead>
          <tr className="border-b">
            <th className="py-1">Category</th>
            <th className="py-1">Description</th>
            <th className="py-1 text-right">Amount</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-b last:border-b-0">
              <td className="py-1 align-top">{e.category}</td>
              <td className="py-1">
                <div>{e.description}</div>
                <div className="text-xs italic text-gray-600">
                  Paid by {payersText(e)}; {splitText(e)}
                </div>
              </td>
              <td className="py-1 text-right align-top">
                {CURRENCY_SYMBOL}
                {e.totalAmount.toFixed(2)}
              </td>
              <td className="py-1 text-right align-top">
                {(userProfile?.isAdmin || e.createdBy === userProfile?.uid) && (
                  <button
                    onClick={() => onDeleteExpense(e.id)}
                    className="text-red-600 text-xs"
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
