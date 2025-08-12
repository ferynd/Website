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
    await addPayment(id, form.payeeId, Number(form.amount), '', userProfile.uid);
    setForms((f) => ({ ...f, [id]: { payeeId: '', amount: '' } }));
  };

  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Balances</h2>
      <ul className="space-y-4 text-gray-800">
        {balances.map((b) => (
          <li key={b.personId}>
            <div>
              {b.name}: {CURRENCY_SYMBOL}
              {b.balance.toFixed(2)}
            </div>
            <div className="flex gap-2 mt-1">
              <select
                value={forms[b.personId]?.payeeId || ''}
                onChange={(e) =>
                  handleChange(b.personId, 'payeeId', e.target.value)
                }
                className="border p-1 flex-1"
              >
                <option value="">Pay to...</option>
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
                className="border p-1 w-24"
                placeholder="Amount"
              />
              <button
                onClick={() => submit(b.personId)}
                className="bg-green-600 text-white px-2 rounded"
                aria-label="Add payment"
              >
                Add
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
