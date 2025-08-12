"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import Button from '@/components/Button';
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
      const ids = e.splitParticipants.length
        ? e.splitParticipants
        : participants.map((p) => p.id);
      return `Split evenly among ${ids.map((id) => name(id)).join(', ')}`;
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
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-xl font-semibold mb-3 text-gray-900">Expenses</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="py-2 px-1 text-sm font-semibold text-gray-900">Category</th>
              <th className="py-2 px-1 text-sm font-semibold text-gray-900">Description</th>
              <th className="py-2 px-1 text-sm font-semibold text-gray-900 text-right">Amount</th>
              <th className="py-2 px-1"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-1 align-top">
                  <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                    {e.category}
                  </span>
                </td>
                <td className="py-3 px-1">
                  <div className="text-gray-900 font-medium">{e.description}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    <span className="font-medium">Paid by:</span> {payersText(e)}
                  </div>
                  <div className="text-xs text-gray-600">
                    {splitText(e)}
                  </div>
                </td>
                <td className="py-3 px-1 text-right align-top">
                  <span className="text-gray-900 font-semibold">
                    {CURRENCY_SYMBOL}{e.totalAmount.toFixed(2)}
                  </span>
                </td>
                <td className="py-3 px-1 text-right align-top">
                  {(userProfile?.isAdmin || e.createdBy === userProfile?.uid) && (
                    <Button
                      onClick={() => onDeleteExpense(e.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:underline p-0 h-auto"
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}