"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';

export default function SettlementSuggestions() {
  const { settlements } = useTrip();
  if (!settlements.length) return null;
  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Settlement Suggestions</h2>
      <ul className="list-disc pl-5 text-gray-800">
        {settlements.map((s, idx) => (
          <li key={idx}>
            {s.from} → {s.to}: {CURRENCY_SYMBOL}
            {s.amount.toFixed(2)}
          </li>
        ))}
      </ul>
    </section>
  );
}
