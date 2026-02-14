"use client";

import React, { useState } from 'react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import { groupExpensesByCategory } from '../../utils/calc';
import type { UserProfile, Expense, ExpenseDraft } from '../../pageTypes';

const CATEGORY_COLORS: Record<string, string> = {
  Food: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Transportation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Accommodation: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Activities: 'bg-green-500/10 text-green-400 border-green-500/20',
  Shopping: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  Other: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

function expenseToDraft(e: Expense): ExpenseDraft {
  return {
    category: e.category,
    description: e.description,
    totalAmount: String(e.totalAmount),
    paidBy: Object.fromEntries(
      Object.entries(e.paidBy).map(([k, v]) => [k, String(v)])
    ),
    splitType: e.splitType,
    splitParticipants: [...e.splitParticipants],
    manualSplit: Object.fromEntries(
      Object.entries(e.manualSplit).map(([k, v]) => [
        k,
        { type: v.type, value: String(v.value) },
      ])
    ),
    manualSplitMode:
      Object.values(e.manualSplit)[0]?.type || 'amount',
  };
}

export default function ExpensesList({
  userProfile,
  onDeleteExpense,
}: {
  userProfile: UserProfile | null;
  onDeleteExpense: (id: string) => void;
}) {
  const { expenses, participants, updateExpense } = useTrip();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ExpenseDraft | null>(null);
  const [editError, setEditError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (!expenses.length) return null;

  const categories = groupExpensesByCategory(expenses);
  const grandTotal = expenses.reduce((s, e) => s + e.totalAmount, 0);

  const name = (id: string) =>
    participants.find((p) => p.id === id)?.name || 'Unknown';

  const payersText = (e: Expense) => {
    const entries = Object.entries(e.paidBy || {});
    return entries.length
      ? entries
          .map(([id, amt]) => `${name(id)} (${CURRENCY_SYMBOL}${Number(amt).toFixed(2)})`)
          .join(', ')
      : '—';
  };

  const splitText = (e: Expense) => {
    if (e.splitType === 'even') {
      const ids = e.splitParticipants.length
        ? e.splitParticipants
        : participants.map((p) => p.id);
      return `Evenly among ${ids.map((id) => name(id)).join(', ')}`;
    }
    return e.splitParticipants
      .map((id: string) => {
        const share = e.manualSplit[id];
        if (!share) return name(id);
        return share.type === 'percent'
          ? `${name(id)} ${share.value}%`
          : `${name(id)} ${CURRENCY_SYMBOL}${Number(share.value).toFixed(2)}`;
      })
      .join(', ');
  };

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setEditDraft(expenseToDraft(e));
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    setEditError('');
    try {
      await updateExpense(editingId, editDraft);
      setEditingId(null);
      setEditDraft(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  return (
    <section className="bg-surface-1 rounded-lg shadow">
      {/* Header with grand total */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-xl font-semibold text-text">Expenses</h2>
        <div className="text-right">
          <div className="text-xs text-text-3 uppercase tracking-wider">Total</div>
          <div className="text-lg font-bold text-text">
            {CURRENCY_SYMBOL}{grandTotal.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Category groups */}
      <div className="divide-y divide-border">
        {categories.map((cat) => {
          const isCollapsed = collapsed.has(cat.category);
          const colorClass =
            CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.Other;

          return (
            <div key={cat.category}>
              {/* Category header / subtotal row */}
              <button
                onClick={() => toggleCategory(cat.category)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-text-3 text-sm w-5 text-center">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span
                    className={`inline-block px-2.5 py-1 text-xs font-semibold rounded-full border ${colorClass}`}
                  >
                    {cat.category}
                  </span>
                  <span className="text-text-3 text-sm">
                    {cat.count} item{cat.count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-text">
                    {CURRENCY_SYMBOL}{cat.total.toFixed(2)}
                  </span>
                  <span className="text-text-3 text-xs ml-2">
                    ({((cat.total / grandTotal) * 100).toFixed(0)}%)
                  </span>
                </div>
              </button>

              {/* Expense rows within category */}
              {!isCollapsed && (
                <div className="bg-surface-2/30">
                  {cat.expenses.map((e) => {
                    const isEditing = editingId === e.id;
                    const canModify =
                      userProfile?.isAdmin ||
                      e.createdBy === userProfile?.uid;

                    if (isEditing && editDraft) {
                      return (
                        <div
                          key={e.id}
                          className="px-4 py-3 border-t border-border/50 bg-accent/5"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                            <input
                              value={editDraft.description}
                              onChange={(ev) =>
                                setEditDraft({
                                  ...editDraft,
                                  description: ev.target.value,
                                })
                              }
                              className="bg-surface-1 border border-border rounded px-2 py-1 text-text text-sm"
                              placeholder="Description"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={editDraft.totalAmount}
                              onChange={(ev) =>
                                setEditDraft({
                                  ...editDraft,
                                  totalAmount: ev.target.value,
                                })
                              }
                              className="bg-surface-1 border border-border rounded px-2 py-1 text-text text-sm"
                              placeholder="Amount"
                            />
                            <div className="flex gap-2">
                              <Button
                                onClick={saveEdit}
                                variant="success"
                                size="sm"
                                className="flex-1"
                              >
                                Save
                              </Button>
                              <Button
                                onClick={cancelEdit}
                                variant="ghost"
                                size="sm"
                                className="text-text-3"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                          {editError && (
                            <div className="text-error text-xs mt-1">
                              {editError}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={e.id}
                        className="flex items-start gap-3 px-4 py-3 border-t border-border/50 hover:bg-surface-2/60 transition-colors group"
                      >
                        {/* Left: description + split details */}
                        <div className="flex-1 min-w-0 pl-8">
                          <div className="text-text font-medium text-sm">
                            {e.description}
                          </div>
                          <div className="text-xs text-text-3 mt-0.5 space-y-0.5">
                            <div>
                              <span className="text-text-3/70">Paid by</span>{' '}
                              {payersText(e)}
                            </div>
                            <div>
                              <span className="text-text-3/70">Split:</span>{' '}
                              {splitText(e)}
                            </div>
                          </div>
                        </div>

                        {/* Right: amount + actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-text font-semibold text-sm">
                            {CURRENCY_SYMBOL}{e.totalAmount.toFixed(2)}
                          </span>
                          {canModify && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                onClick={() => startEdit(e)}
                                variant="ghost"
                                size="sm"
                                className="text-accent hover:text-accent/80 p-0 h-auto text-xs"
                              >
                                Edit
                              </Button>
                              <Button
                                onClick={() => onDeleteExpense(e.id)}
                                variant="ghost"
                                size="sm"
                                className="text-error hover:text-error/90 p-0 h-auto text-xs"
                              >
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Category summary bar */}
      {categories.length > 1 && (
        <div className="px-4 py-3 border-t border-border">
          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-surface-2">
            {categories.map((cat) => {
              const pct = (cat.total / grandTotal) * 100;
              const barColorMap: Record<string, string> = {
                Food: 'bg-orange-500',
                Transportation: 'bg-blue-500',
                Accommodation: 'bg-purple-500',
                Activities: 'bg-green-500',
                Shopping: 'bg-pink-500',
                Other: 'bg-gray-500',
              };
              return (
                <div
                  key={cat.category}
                  className={`${barColorMap[cat.category] || 'bg-gray-500'} rounded-full`}
                  style={{ width: `${pct}%` }}
                  title={`${cat.category}: ${CURRENCY_SYMBOL}${cat.total.toFixed(2)} (${pct.toFixed(0)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {categories.map((cat) => {
              const dotColorMap: Record<string, string> = {
                Food: 'bg-orange-500',
                Transportation: 'bg-blue-500',
                Accommodation: 'bg-purple-500',
                Activities: 'bg-green-500',
                Shopping: 'bg-pink-500',
                Other: 'bg-gray-500',
              };
              return (
                <div key={cat.category} className="flex items-center gap-1.5 text-xs text-text-3">
                  <span className={`w-2 h-2 rounded-full ${dotColorMap[cat.category] || 'bg-gray-500'}`} />
                  {cat.category}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
