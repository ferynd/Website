"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';

export default function PaymentHistory() {
  const { payments, participants } = useTrip();
  if (!payments.length) return null;
  const name = (id: string) =>
    participants.find((p) => p.id === id)?.name || 'Unknown';
  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Payments</h2>
      <ul className="space-y-1 text-gray-800">
        {payments.map((p) => (
          <li key={p.id}>
            {name(p.payerId)} paid {name(p.payeeId)} {CURRENCY_SYMBOL}
            {p.amount.toFixed(2)}{' '}
            <span className="text-gray-600 text-sm ml-2">
              ({new Date(p.date).toLocaleDateString()})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
