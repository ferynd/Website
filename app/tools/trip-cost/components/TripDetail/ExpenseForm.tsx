"use client";

import React, { useState, useEffect } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useTrip } from '../../TripContext';
import { EXPENSE_CATEGORIES, CURRENCY_SYMBOL } from '../../constants';

export default function ExpenseForm() {
  const { participants, trip, newExpense, setNewExpense, addExpense } = useTrip();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-select all participants by default when component mounts
  useEffect(() => {
    if (participants.length > 0 && newExpense.splitParticipants.length === 0) {
      setNewExpense(prev => ({
        ...prev,
        splitParticipants: participants.map(p => p.id)
      }));
    }
  }, [participants, newExpense.splitParticipants.length, setNewExpense]);

  // When only one participant is selected for manual split, auto-fill 100%
  useEffect(() => {
    if (
      newExpense.splitType === 'manual' &&
      newExpense.splitParticipants.length === 1
    ) {
      const pid = newExpense.splitParticipants[0];
      const mode = newExpense.manualSplitMode;
      const autoValue = mode === 'percent' ? '100' : newExpense.totalAmount || '0';
      const current = newExpense.manualSplit[pid]?.value;
      if (current !== autoValue) {
        setNewExpense(prev => ({
          ...prev,
          manualSplit: {
            [pid]: { type: mode, value: autoValue },
          },
        }));
      }
    }
  }, [
    newExpense.splitType,
    newExpense.splitParticipants,
    newExpense.manualSplitMode,
    newExpense.totalAmount,
    newExpense.manualSplit,
    setNewExpense,
  ]);

  // Apply trip default split when switching to manual mode with all participants selected
  const applyDefaultSplit = () => {
    const defaultSplit = trip?.defaultSplit;
    if (!defaultSplit || Object.keys(defaultSplit).length === 0) return;

    const allSelected =
      newExpense.splitParticipants.length === participants.length;
    if (!allSelected) return;

    const manualSplit: Record<string, { type: 'percent' | 'amount'; value: string }> = {};
    for (const pid of newExpense.splitParticipants) {
      if (defaultSplit[pid] != null) {
        manualSplit[pid] = { type: 'percent', value: String(defaultSplit[pid]) };
      }
    }
    setNewExpense(prev => ({
      ...prev,
      manualSplit,
      manualSplitMode: 'percent',
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await addExpense(newExpense);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Validation helpers
  const payerTotal = Object.values(newExpense.paidBy).reduce(
    (sum, val) => sum + (parseFloat(String(val)) || 0),
    0
  );
  const totalAmount = parseFloat(newExpense.totalAmount) || 0;
  const payerMismatch =
    payerTotal > 0 && Math.abs(payerTotal - totalAmount) > 0.01;

  const splitMode = newExpense.manualSplitMode || 'amount';
  const manualTotal =
    newExpense.splitType === 'manual'
      ? Object.values(newExpense.manualSplit).reduce(
          (sum, split) => sum + (parseFloat(String(split.value)) || 0),
          0
        )
      : 0;
  const manualTarget = splitMode === 'percent' ? 100 : totalAmount;
  const manualMismatch =
    newExpense.splitType === 'manual' &&
    manualTotal > 0 &&
    Math.abs(manualTotal - manualTarget) > 0.01;

  const hasDefaultSplit =
    trip?.defaultSplit && Object.keys(trip.defaultSplit).length > 0;

  return (
    <form onSubmit={submit} className="bg-surface-1 p-4 rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-3 text-text">Add Expense</h2>

      <div className="space-y-3">
        {/* Main inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Select
            value={newExpense.category}
            onChange={(e) =>
              setNewExpense({ ...newExpense, category: e.target.value })
            }
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          <Input
            value={newExpense.description}
            onChange={(e) =>
              setNewExpense({ ...newExpense, description: e.target.value })
            }
            placeholder="Description"
            required
          />

          <Input
            value={newExpense.totalAmount}
            onChange={(e) =>
              setNewExpense({ ...newExpense, totalAmount: e.target.value })
            }
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Total Amount"
            required
          />
        </div>

        {/* Paid By Section */}
        <div className="border-t pt-3">
          <p className="font-medium text-text-2 mb-2">
            Who paid? (Leave blank to default to you)
            {payerMismatch && (
              <span className="text-error text-sm ml-2">
                Amounts must sum to {CURRENCY_SYMBOL}
                {totalAmount.toFixed(2)}
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="p-1 w-24"
                  value={newExpense.paidBy[p.id] || ''}
                  onChange={(e) =>
                    setNewExpense({
                      ...newExpense,
                      paidBy: {
                        ...newExpense.paidBy,
                        [p.id]: e.target.value,
                      },
                    })
                  }
                  placeholder="0.00"
                />
                <span className="text-text-2">{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Split Section */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-text-2">How to split?</p>
            {hasDefaultSplit && newExpense.splitType === 'manual' && (
              <Button
                type="button"
                onClick={applyDefaultSplit}
                variant="ghost"
                size="sm"
                className="text-accent text-xs px-2 py-1 h-auto"
              >
                Use trip default
              </Button>
            )}
          </div>

          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Input
                type="radio"
                checked={newExpense.splitType === 'even'}
                onChange={() =>
                  setNewExpense({ ...newExpense, splitType: 'even' })
                }
                className="text-accent"
              />
              <span>Split Evenly</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Input
                type="radio"
                checked={newExpense.splitType === 'manual'}
                onChange={() =>
                  setNewExpense({ ...newExpense, splitType: 'manual' })
                }
                className="text-accent"
              />
              <span>Custom Split</span>
            </label>
          </div>

          {/* Dollar / Percent toggle for manual splits */}
          {newExpense.splitType === 'manual' && (
            <div className="flex gap-1 mb-3 p-0.5 bg-surface-2 rounded-lg w-fit">
              <button
                type="button"
                onClick={() =>
                  setNewExpense({
                    ...newExpense,
                    manualSplitMode: 'amount',
                    manualSplit: {},
                  })
                }
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  splitMode === 'amount'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-3 hover:text-text-2'
                }`}
              >
                {CURRENCY_SYMBOL} Dollar
              </button>
              <button
                type="button"
                onClick={() =>
                  setNewExpense({
                    ...newExpense,
                    manualSplitMode: 'percent',
                    manualSplit: {},
                  })
                }
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  splitMode === 'percent'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-3 hover:text-text-2'
                }`}
              >
                % Percent
              </button>
            </div>
          )}

          {manualMismatch && (
            <div className="text-error text-sm mb-2">
              {splitMode === 'percent'
                ? `Percentages must sum to 100% (currently ${manualTotal.toFixed(1)}%)`
                : `Amounts must sum to ${CURRENCY_SYMBOL}${totalAmount.toFixed(2)} (currently ${CURRENCY_SYMBOL}${manualTotal.toFixed(2)})`}
            </div>
          )}

          {/* Participant checkboxes + split values */}
          <div className="space-y-2">
            {participants.map((p) => {
              const included = newExpense.splitParticipants.includes(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <Input
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
                    className="text-accent"
                  />
                  <span className="flex-1 text-text-2">{p.name}</span>
                  {newExpense.splitType === 'manual' && included && (
                    <div className="flex items-center gap-1">
                      {splitMode === 'percent' && (
                        <span className="text-text-3 text-xs">%</span>
                      )}
                      {splitMode === 'amount' && (
                        <span className="text-text-3 text-xs">
                          {CURRENCY_SYMBOL}
                        </span>
                      )}
                      <Input
                        type="number"
                        step={splitMode === 'percent' ? '0.1' : '0.01'}
                        min="0"
                        max={splitMode === 'percent' ? '100' : undefined}
                        className="p-1 w-20"
                        value={newExpense.manualSplit[p.id]?.value || ''}
                        onChange={(e) =>
                          setNewExpense({
                            ...newExpense,
                            manualSplit: {
                              ...newExpense.manualSplit,
                              [p.id]: {
                                type: splitMode,
                                value: e.target.value,
                              },
                            },
                          })
                        }
                        placeholder={
                          splitMode === 'percent' ? '0' : '0.00'
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Running total indicator for manual split */}
          {newExpense.splitType === 'manual' && manualTotal > 0 && (
            <div className="mt-2 text-xs text-text-3">
              Total:{' '}
              <span
                className={
                  Math.abs(manualTotal - manualTarget) < 0.01
                    ? 'text-success font-medium'
                    : 'text-warning font-medium'
                }
              >
                {splitMode === 'percent'
                  ? `${manualTotal.toFixed(1)}%`
                  : `${CURRENCY_SYMBOL}${manualTotal.toFixed(2)}`}
              </span>
              {' / '}
              {splitMode === 'percent'
                ? '100%'
                : `${CURRENCY_SYMBOL}${totalAmount.toFixed(2)}`}
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div
          className="mt-3 p-2 bg-error/10 border border-error/20 text-error rounded text-sm"
          aria-live="polite"
        >
          {error}
        </div>
      )}

      {/* Submit button */}
      <Button
        type="submit"
        variant="success"
        className="mt-4 w-full"
        loading={isSubmitting}
        disabled={
          !newExpense.description ||
          !newExpense.totalAmount ||
          payerMismatch ||
          manualMismatch ||
          newExpense.splitParticipants.length === 0
        }
      >
        {isSubmitting ? 'Adding...' : 'Add Expense'}
      </Button>
    </form>
  );
}
