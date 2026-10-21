"use client";

import React from 'react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import { balanceChips } from '../../utils/ledgerView';
import { formatMoney } from '../../utils/money';
import LedgerProblems from './LedgerProblems';

interface TripHeaderProps {
  onBack: () => void;
  onAddExpense: () => void;
  onTraveler: (id: string) => void;
}

/** Trip name, spending total, expense action, and traveler balance shortcuts. */
export default function TripHeader({ onBack, onAddExpense, onTraveler }: TripHeaderProps) {
  const { trip, participants, ledger } = useTrip();
  if (!trip) return null;

  return (
    <header className="min-w-0 rounded-lg bg-surface-1 p-4 shadow">
      <Button onClick={onBack} variant="ghost" className="px-0 text-sm text-accent hover:underline">
        ← Back to trips
      </Button>
      <div className="mt-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-text">{trip.name}</h1>
          <p className="mt-1 text-sm text-text-2">Total spending</p>
          <p className="text-2xl font-bold tabular-nums text-text">
            {formatMoney(ledger.totalSpendingCents)}
          </p>
        </div>
        <Button onClick={onAddExpense} variant="success" className="w-full sm:w-auto">
          Add expense
        </Button>
      </div>
      <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
        {balanceChips(ledger, participants).map((chip) => (
          <button
            key={chip.travelerId}
            type="button"
            onClick={() => onTraveler(chip.travelerId)}
            className="shrink-0 rounded-full border border-border bg-surface-2 px-3 py-2 text-sm text-text hover:border-accent"
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="mt-3"><LedgerProblems /></div>
    </header>
  );
}
