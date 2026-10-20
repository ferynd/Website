"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';

export default function SettlementSuggestions() {
  const { settlements, cappedBalances } = useTrip();
  // Non-zero on every entry when spend caps couldn't fully redistribute
  // overage — settlement advice is refused rather than guessed in that
  // case (see calculateSettlements), so "no settlements" must not be
  // read as "trip is settled" here (F-087).
  const unallocatedOverage = cappedBalances[0]?.unallocatedOverage ?? 0;
  const capsInfeasible = unallocatedOverage > 0;

  if (!settlements.length) {
    return (
      <section className="bg-surface-1 rounded-lg shadow p-4">
        <h2 className="text-xl font-semibold mb-3 text-text">Settlement Suggestions</h2>
        {capsInfeasible ? (
          <p className="text-sm text-error">
            Spend caps could not be fully applied — {CURRENCY_SYMBOL}{unallocatedOverage.toFixed(2)} of
            overage has nowhere to go (every other participant is already at their cap). Raise a cap,
            add a participant, or remove one to see settlement suggestions.
          </p>
        ) : (
          <p className="text-text-3 italic">All balances are settled!</p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-surface-1 rounded-lg shadow p-4">
      <h2 className="text-xl font-semibold mb-3 text-text">Settlement Suggestions</h2>
      <p className="text-sm text-text-3 mb-3">
        Optimal payments to settle all balances:
      </p>
      <ul className="space-y-2">
        {settlements.map((s, idx) => (
          <li key={idx} className="flex items-center p-2 bg-warning/10 rounded-lg border border-warning/20">
            <div className="flex-1">
              <span className="font-medium text-text">{s.from}</span>
              <span className="text-text-3 mx-2">→</span>
              <span className="font-medium text-text">{s.to}</span>
            </div>
            <span className="font-semibold text-warning">
              {CURRENCY_SYMBOL}{s.amount.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}