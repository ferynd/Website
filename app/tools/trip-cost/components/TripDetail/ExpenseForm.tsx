"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { EXPENSE_CATEGORIES } from '../../constants';
import type { UserProfile } from '../../pageTypes';

export default function ExpenseForm({
  userProfile,
}: {
  userProfile: UserProfile | null;
}) {
  const { participants, newExpense, setNewExpense, addExpense } = useTrip();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    if (!newExpense.description || !newExpense.totalAmount) return;
    const draft = {
      ...newExpense,
      splitParticipants: newExpense.splitParticipants.length
        ? newExpense.splitParticipants
        : participants.map((p) => p.id),
    };
    await addExpense(draft, userProfile.uid);
    setNewExpense({
      category: EXPENSE_CATEGORIES[0],
      description: '',
      totalAmount: '',
      paidBy: {},
      splitType: 'even',
      splitParticipants: [],
      manualSplit: {},
    });
  };

  return (
    <form onSubmit={submit} className="bg-white p-4 rounded shadow space-y-2">
      <h2 className="text-lg font-semibold">Add Expense</h2>
      <div className="flex gap-2">
        <select
          value={newExpense.category}
          onChange={(e) =>
            setNewExpense({ ...newExpense, category: e.target.value })
          }
          className="border p-1 flex-1"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          value={newExpense.description}
          onChange={(e) =>
            setNewExpense({ ...newExpense, description: e.target.value })
          }
          className="border p-1 flex-1"
          placeholder="Description"
        />
        <input
          value={newExpense.totalAmount}
          onChange={(e) =>
            setNewExpense({ ...newExpense, totalAmount: e.target.value })
          }
          type="number"
          step="0.01"
          className="border p-1 w-32"
          placeholder="Amount"
        />
      </div>
      <button
        type="submit"
        className="bg-green-600 text-white px-3 py-1 rounded disabled:opacity-50"
        disabled={!newExpense.description || !newExpense.totalAmount}
      >
        Add Expense
      </button>
    </form>
  );
}

