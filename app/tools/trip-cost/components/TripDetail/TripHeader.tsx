"use client";

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
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
  const scroller = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [participants, ledger]);
  if (!trip) return null;

  return (
    <header className="min-w-0 rounded-lg bg-surface-1 p-4 shadow">
      <Button onClick={onBack} variant="ghost" className="px-0 text-sm text-accent hover:underline">
        <ArrowLeft aria-hidden="true" size={16} /> Back to trips
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
      <div className="relative mt-3 min-w-0">
        <div ref={scroller} className="min-w-0 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {balanceChips(ledger, participants).map((chip) => (
              <button
                key={chip.travelerId}
                type="button"
                onClick={() => onTraveler(chip.travelerId)}
                className="max-w-64 shrink-0 break-words rounded-full border border-border bg-surface-2 px-3 py-2 text-left text-sm text-text hover:border-accent [overflow-wrap:anywhere]"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        {overflows && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-1 to-transparent" />
        )}
      </div>
      {overflows && (
        <p className="mt-1 flex items-center gap-1 text-xs text-text-3">
          Swipe for more balances <ArrowRight aria-hidden="true" size={14} />
        </p>
      )}
      <div className="mt-3"><LedgerProblems /></div>
    </header>
  );
}
