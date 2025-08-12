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
      <div className="border-t pt-2">
        <p className="font-medium">Paid By</p>
        {participants.map((p) => (
          <div key={p.id} className="flex items-center gap-2 mt-1">
            <input
              type="number"
              step="0.01"
              className="border p-1 w-24"
              value={newExpense.paidBy[p.id] || ''}
              onChange={(e) =>
                setNewExpense({
                  ...newExpense,
                  paidBy: { ...newExpense.paidBy, [p.id]: e.target.value },
                })
              }
              placeholder="0.00"
            />
            <span>{p.name}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2">
        <p className="font-medium">Split</p>
        <div className="flex gap-4 mb-2">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={newExpense.splitType === 'even'}
              onChange={() =>
                setNewExpense({ ...newExpense, splitType: 'even' })
              }
            />
            Evenly
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={newExpense.splitType === 'manual'}
              onChange={() =>
                setNewExpense({ ...newExpense, splitType: 'manual' })
              }
            />
            Manual
          </label>
        </div>
        <div className="space-y-1">
          {participants.map((p) => {
            const included = newExpense.splitParticipants.includes(p.id);
            return (
              <div key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => {
                    const set = new Set(newExpense.splitParticipants);
                    if (included) set.delete(p.id);
                    else set.add(p.id);
                    setNewExpense({
                      ...newExpense,
                      splitParticipants: Array.from(set),
                    });
                  }}
                />
                <span className="flex-1">{p.name}</span>
                {newExpense.splitType === 'manual' && included && (
                  <input
                    type="number"
                    step="0.01"
                    className="border p-1 w-20"
                    value={
                      newExpense.manualSplit[p.id]?.value || ''
                    }
                    onChange={(e) =>
                      setNewExpense({
                        ...newExpense,
                        manualSplit: {
                          ...newExpense.manualSplit,
                          [p.id]: { type: 'amount', value: e.target.value },
                        },
                      })
                    }
                    placeholder="Amount"
                  />
                )}
              </div>
            );
          })}
        </div>
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

