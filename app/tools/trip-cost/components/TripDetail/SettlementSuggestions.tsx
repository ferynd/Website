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
  
  if (!settlements.length) {
    return (
      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="text-xl font-semibold mb-3 text-gray-900">Settlement Suggestions</h2>
        <p className="text-gray-600 italic">All balances are settled!</p>
      </section>
    );
  }
  
  return (
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-xl font-semibold mb-3 text-gray-900">Settlement Suggestions</h2>
      <p className="text-sm text-gray-600 mb-3">
        Optimal payments to settle all balances:
      </p>
      <ul className="space-y-2">
        {settlements.map((s, idx) => (
          <li key={idx} className="flex items-center p-2 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex-1">
              <span className="font-medium text-gray-900">{s.from}</span>
              <span className="text-gray-600 mx-2">→</span>
              <span className="font-medium text-gray-900">{s.to}</span>
            </div>
            <span className="font-semibold text-amber-700">
              {CURRENCY_SYMBOL}{s.amount.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}