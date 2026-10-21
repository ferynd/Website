"use client";

import React from 'react';
import { useTrip } from '../../TripContext';
import { describeProblem, makeNameOf } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';

/** Lists ledger data problems and unassigned costs so totals never drift silently. */
export default function LedgerProblems() {
  const { ledger, participants } = useTrip();
  if (!ledger.problems.length && ledger.unallocatedCents === 0) return null;

  const nameOf = makeNameOf(participants);
  const isError =
    ledger.unallocatedCents > 0 || ledger.problems.some((p) => p.severity === 'error');

  return (
    <div
      role="status"
      className={`mb-3 p-3 rounded border text-sm ${
        isError
          ? 'bg-error/10 border-error/20 text-error'
          : 'bg-warning/10 border-warning/20 text-warning'
      }`}
    >
      <p className="font-medium">
        {ledger.unallocatedCents > 0
          ? `Unassigned: ${formatMoney(ledger.unallocatedCents)} of trip costs is not assigned to anyone.`
          : 'Some trip records need attention.'}
      </p>
      {ledger.problems.length > 0 && (
        <ul className="list-disc pl-5 mt-1 space-y-1">
          {ledger.problems.map((problem, idx) => (
            <li key={idx}>{describeProblem(problem, ledger, nameOf)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
