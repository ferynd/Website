"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useState } from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import type { UserProfile } from '../../pageTypes';

export default function BalanceSummary({
  userProfile,
}: {
  userProfile: UserProfile | null;
}) {
  const { participants, balances, addPayment } = useTrip();
  const [forms, setForms] = useState<{
    [personId: string]: { payeeId: string; amount: string };
  }>({});
  const [error, setError] = useState('');

  if (!balances.length) return null;

  const handleChange = (
    id: string,
    field: 'payeeId' | 'amount',
    value: string
  ) => {
    setForms((f) => ({ ...f, [id]: { ...f[id], [field]: value } }));
  };

  const submit = async (id: string) => {
    const form = forms[id];
    if (!userProfile || !form?.payeeId || !form.amount) return;
    
    setError('');
    try {
      await addPayment(id, form.payeeId, Number(form.amount), '', userProfile.uid);
      setForms((f) => ({ ...f, [id]: { payeeId: '', amount: '' } }));
    } catch (err) {
      console.error('[BalanceSummary] Payment error:', err);
      setError('Failed to add payment. Please try again.');
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-xl font-semibold mb-3 text-gray-900">Balances</h2>
      
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}
      
      <ul className="space-y-4">
        {balances.map((b) => {
          const isPositive = b.balance > 0;
          const isNegative = b.balance < 0;
          const isNeutral = Math.abs(b.balance) < 0.01;
          
          return (
            <li key={b.personId} className="border-b border-gray-100 pb-3 last:border-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 font-medium">{b.name}</span>
                <span className={`font-semibold ${
                  isPositive ? 'text-green-600' : 
                  isNegative ? 'text-red-600' : 
                  'text-gray-600'
                }`}>
                  {isPositive && '+'}{CURRENCY_SYMBOL}{Math.abs(b.balance).toFixed(2)}
                  {isNeutral && ' (settled)'}
                </span>
              </div>
              
              {!isNeutral && (
                <div className="flex gap-2 mt-2">
                  <select
                    value={forms[b.personId]?.payeeId || ''}
                    onChange={(e) =>
                      handleChange(b.personId, 'payeeId', e.target.value)
                    }
                    className="border border-gray-300 rounded px-2 py-1 flex-1 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select recipient...</option>
                    {participants
                      .filter((p) => p.id !== b.personId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <input
                    value={forms[b.personId]?.amount || ''}
                    onChange={(e) =>
                      handleChange(b.personId, 'amount', e.target.value)
                    }
                    type="number"
                    step="0.01"
                    className="border border-gray-300 rounded px-2 py-1 w-24 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Amount"
                  />
                  <button
                    onClick={() => submit(b.personId)}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded transition-colors font-medium"
                    aria-label="Record payment"
                  >
                    Pay
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}