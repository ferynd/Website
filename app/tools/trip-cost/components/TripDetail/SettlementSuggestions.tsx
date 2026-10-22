"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useTrip } from '../../TripContext';
import { makeNameOf, settlementPausedMessage } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';

export default function SettlementSuggestions() {
  const { ledger, participants } = useTrip();
  const { settlements, paused } = ledger.settlement;
  const nameOf = makeNameOf(participants);

  if (!settlements.length) {
    return (
      <section className="bg-surface-1 rounded-lg shadow p-4">
        <h2 className="text-xl font-semibold mb-3 text-text">Settlement Suggestions</h2>
        {/* Advice is refused rather than guessed when costs are unassigned or
            balances don't net to zero, so "no settlements" must not be read
            as "trip is settled" here (F-087). */}
        {paused ? (
          <p className="text-sm text-error">
            {settlementPausedMessage(paused, ledger.unallocatedCents)}
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
        {settlements.map((s) => (
          <li key={`${s.from}-${s.to}`} className="flex items-center p-2 bg-warning/10 rounded-lg border border-warning/20">
            <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
              <span className="font-medium text-text">{nameOf(s.from)}</span>
              <span className="mx-2 inline-flex text-text-3"><ArrowRight aria-hidden="true" size={16} /></span>
              <span className="font-medium text-text">{nameOf(s.to)}</span>
            </div>
            <span className="shrink-0 pl-2 text-right font-semibold text-warning">
              {formatMoney(s.cents)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
