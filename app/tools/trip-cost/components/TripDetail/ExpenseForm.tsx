"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useState, useEffect } from 'react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import { EXPENSE_CATEGORIES, CURRENCY_SYMBOL } from '../../constants';

export default function ExpenseForm() {
  const { participants, newExpense, setNewExpense, addExpense } = useTrip();
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    
    try {
      await addExpense(newExpense);
      // Reset form is handled in context after successful add
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate if payer amounts match total
  const payerTotal = Object.values(newExpense.paidBy)
    .reduce((sum, val) => sum + (parseFloat(String(val)) || 0), 0);
  const totalAmount = parseFloat(newExpense.totalAmount) || 0;
  const payerMismatch = payerTotal > 0 && Math.abs(payerTotal - totalAmount) > 0.01;

  // Calculate if manual split matches total
  const manualTotal = newExpense.splitType === 'manual' 
    ? Object.values(newExpense.manualSplit)
        .reduce((sum, split) => sum + (parseFloat(String(split.value)) || 0), 0)
    : 0;
  const manualMismatch = newExpense.splitType === 'manual' && 
    manualTotal > 0 && Math.abs(manualTotal - totalAmount) > 0.01;

  return (
    <form onSubmit={submit} className="bg-white p-4 rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-3 text-gray-800">Add Expense</h2>
      
      {/* Main inputs */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={newExpense.category}
            onChange={(e) =>
              setNewExpense({ ...newExpense, category: e.target.value })
            }
            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-blue-500"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          
          <input
            value={newExpense.description}
            onChange={(e) =>
              setNewExpense({ ...newExpense, description: e.target.value })
            }
            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-blue-500"
            placeholder="Description"
            required
          />
          
          <input
            value={newExpense.totalAmount}
            onChange={(e) =>
              setNewExpense({ ...newExpense, totalAmount: e.target.value })
            }
            type="number"
            step="0.01"
            min="0.01"
            className="border border-gray-300 p-2 rounded-md focus:ring-2 focus:ring-blue-500"
            placeholder="Total Amount"
            required
          />
        </div>

        {/* Paid By Section */}
        <div className="border-t pt-3">
          <p className="font-medium text-gray-700 mb-2">
            Who paid? (Leave blank to default to you)
            {payerMismatch && (
              <span className="text-red-600 text-sm ml-2">
                Amounts must sum to {CURRENCY_SYMBOL}{totalAmount.toFixed(2)}
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="border border-gray-300 p-1 w-24 rounded"
                  value={newExpense.paidBy[p.id] || ''}
                  onChange={(e) =>
                    setNewExpense({
                      ...newExpense,
                      paidBy: { ...newExpense.paidBy, [p.id]: e.target.value },
                    })
                  }
                  placeholder="0.00"
                />
                <span className="text-gray-700">{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Split Section */}
        <div className="border-t pt-3">
          <p className="font-medium text-gray-700 mb-2">How to split?</p>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={newExpense.splitType === 'even'}
                onChange={() =>
                  setNewExpense({ ...newExpense, splitType: 'even' })
                }
                className="text-blue-600"
              />
              <span>Split Evenly</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={newExpense.splitType === 'manual'}
                onChange={() =>
                  setNewExpense({ ...newExpense, splitType: 'manual' })
                }
                className="text-blue-600"
              />
              <span>Manual Split</span>
            </label>
          </div>
          
          {manualMismatch && (
            <div className="text-red-600 text-sm mb-2">
              Manual split must sum to {CURRENCY_SYMBOL}{totalAmount.toFixed(2)}
            </div>
          )}
          
          <div className="space-y-2">
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
                    className="text-blue-600"
                  />
                  <span className="flex-1 text-gray-700">{p.name}</span>
                  {newExpense.splitType === 'manual' && included && (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="border border-gray-300 p-1 w-24 rounded"
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
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm" aria-live="polite">
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