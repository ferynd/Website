"use client";

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useTrip } from '../../TripContext';
import { buildLedgerRows, capBadge, explicitZeroLabel } from '../../utils/ledgerView';
import { formatMoney } from '../../utils/money';
import type { LedgerViewRow } from '../../utils/ledgerView';

interface LedgerTableProps {
  onExpense: (id: string) => void;
  onTraveler: (id: string) => void;
  highlightedExpenseId?: string | null;
}

interface LedgerRowProps {
  row: LedgerViewRow;
  travelerIds: string[];
  collapsed: boolean;
  onToggleCategory: (category: string) => void;
  onExpense: (id: string) => void;
  highlightedExpenseId?: string | null;
}

const money = (cents: number) => <span className="tabular-nums">{formatMoney(cents)}</span>;

/** Category subtotal row, which controls visibility of its expense rows. */
function CategoryRow({ row, travelerIds, collapsed, onToggleCategory }: LedgerRowProps) {
  if (row.type !== 'category') return null;
  return (
    <tr className="border-b border-border bg-surface-2">
      <th scope="row" className="sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] border-r border-r-border bg-surface-2 px-3 py-2 text-left sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem]">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggleCategory(row.category)}
          className="flex items-center gap-1 text-left font-semibold text-text"
        >
          {collapsed ? <ChevronRight aria-hidden="true" size={16} className="shrink-0" /> : <ChevronDown aria-hidden="true" size={16} className="shrink-0" />}<span>{row.category}</span>
        </button>
      </th>
      <td className="min-w-[7rem] whitespace-nowrap px-3 py-2 text-right font-semibold">{money(row.totalCents)}</td>
      {travelerIds.map((id) => (
        <td key={id} className="min-w-[5.5rem] px-2 py-2 text-right">{money(row.cells[id] ?? 0)}</td>
      ))}
    </tr>
  );
}

/** Keyboard and pointer accessible expense row with original shares only. */
function ExpenseRow({ row, travelerIds, onExpense, highlightedExpenseId }: LedgerRowProps) {
  if (row.type !== 'expense') return null;
  const open = () => onExpense(row.expenseId);
  return (
    <tr onClick={open} className={`cursor-pointer border-b border-border/70 text-text-2 hover:bg-surface-2 ${highlightedExpenseId === row.expenseId ? 'expense-added' : ''}`}>
      <th
        scope="row"
        className="sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] border-r border-r-border bg-surface-1 px-3 py-2 text-left font-medium sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem]"
      >
        <button type="button" onClick={(event) => { event.stopPropagation(); open(); }} aria-label={`View details for ${row.description}`} className="block min-w-0 max-w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{row.description}</span>
        </button>
        <span className="mt-1 block min-w-0 break-words [overflow-wrap:anywhere] text-xs text-text-3">{row.payers}</span>
      </th>
      <td className="min-w-[7rem] whitespace-nowrap px-3 py-2 text-right">{money(row.totalCents)}</td>
      {travelerIds.map((id) => (
        <td key={id} className="min-w-[5.5rem] px-2 py-2 text-right">
          {explicitZeroLabel(row.cells[id] ?? null)}
        </td>
      ))}
    </tr>
  );
}

/** Summary, adjustment, uncovered, and final responsibility row. */
function SummaryRow({ row, travelerIds }: LedgerRowProps) {
  if (row.type === 'category' || row.type === 'expense') return null;
  const uncovered = row.type === 'uncovered';
  const unassigned = row.type === 'unassigned';
  const final = row.type === 'final';
  // Sticky cells must stay opaque so scrolled cells never show through;
  // problem rows get an error edge instead of a translucent tint here.
  const background = uncovered || unassigned
    ? 'border-l-4 border-error bg-surface-1'
    : final
      ? 'bg-surface-2'
      : 'bg-surface-1';
  const rowTone = uncovered || unassigned ? 'text-error' : final ? 'font-bold text-text' : 'text-text-2';

  return (
    <tr className={`border-t border-border ${rowTone} ${uncovered || unassigned ? 'bg-error/10' : final ? 'bg-surface-2' : ''}`}>
      <th scope="row" className={`sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] border-r border-r-border px-3 py-3 text-left sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem] ${background}`}>
        <span className="block break-words">{row.label}</span>
        {row.type === 'adjustment' && (
          <span className="mt-1 block text-xs text-text-3">moves responsibility; spending unchanged</span>
        )}
        {uncovered && (
          <span className="mt-1 block text-xs">
            Raise a cap or add someone without a cap. Settlement suggestions are paused.
          </span>
        )}
        {unassigned && <span className="mt-1 block text-xs">See the problems above; fix the expense to assign it.</span>}
      </th>
      <td className="min-w-[7rem] whitespace-nowrap px-3 py-3 text-right">
        {money(row.totalCents)}
      </td>
      {travelerIds.map((id) => {
        const value = row.cells[id] ?? null;
        return (
          <td key={id} className="min-w-[5.5rem] px-2 py-3 text-right">
            {row.type === 'adjustment' && typeof value === 'number' ? (
              <>
                <span className="sr-only">{value < 0 ? 'reduced by ' : value > 0 ? 'absorbs ' : ''}</span>
                {value > 0 ? '+' : value < 0 ? '−' : ''}{money(Math.abs(value))}
              </>
            ) : explicitZeroLabel(value)}
          </td>
        );
      })}
    </tr>
  );
}

/** Expense detail row dispatcher with category collapse handling. */
function LedgerDataRow(props: LedgerRowProps) {
  if (props.row.type === 'category') return <CategoryRow {...props} />;
  if (props.row.type === 'expense') {
    return props.collapsed ? null : <ExpenseRow {...props} />;
  }
  return <SummaryRow {...props} />;
}

/** Responsive ledger matrix with a sticky expense column and overflow cues. */
export default function LedgerTable({ onExpense, onTraveler, highlightedExpenseId }: LedgerTableProps) {
  const { ledger, participants, expenses } = useTrip();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [overflows, setOverflows] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = buildLedgerRows(ledger, participants, expenses);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [ledger.travelerIds.length, rows.length]);

  useEffect(() => {
    if (!highlightedExpenseId) return;
    const expense = expenses.find((item) => item.id === highlightedExpenseId);
    if (expense) {
      setCollapsed((old) => {
        const next = new Set(old);
        next.delete(expense.category);
        return next;
      });
    }
  }, [highlightedExpenseId, expenses]);

  const toggleCategory = (category: string) => {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-lg bg-surface-1 shadow">
      <div ref={scroller} className="relative overflow-x-auto">
        <table className="isolate w-full min-w-max border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Trip expense ledger showing totals and shares for every traveler</caption>
          <thead className="relative z-20 bg-surface-1">
            <tr className="border-b border-border text-text-2">
              <th scope="col" className="sticky left-0 z-30 w-[9.5rem] min-w-[9.5rem] border-r border-r-border bg-surface-1 px-3 py-3 text-left sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem]">Expense</th>
              <th scope="col" className="min-w-[7rem] whitespace-nowrap bg-surface-1 px-3 py-3 text-right">Total</th>
              {ledger.travelerIds.map((id) => {
                const participant = participants.find((item) => item.id === id);
                if (!participant) return null;
                return (
                  <th key={id} scope="col" className="relative z-10 min-w-[5.5rem] bg-surface-1 text-right">
                    <button type="button" onClick={(event) => { event.stopPropagation(); onTraveler(id); }} aria-label={`View details for ${participant.name}`} className="relative z-20 block min-h-11 w-full min-w-0 max-w-full px-2 py-3 text-right text-text hover:text-accent">
                      <span className="block break-words [overflow-wrap:anywhere]">{participant.name}</span>
                      {capBadge(ledger, id) && (
                        <span className="block whitespace-normal text-xs text-text-3">{capBadge(ledger, id)}</span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="relative z-0">
            {rows.map((row) => (
              <LedgerDataRow
                key={rowKey(row)}
                row={row}
                travelerIds={ledger.travelerIds}
                collapsed={(row.type === 'expense' || row.type === 'category') && collapsed.has(row.category)}
                onToggleCategory={toggleCategory}
                onExpense={onExpense}
                highlightedExpenseId={highlightedExpenseId}
              />
            ))}
          </tbody>
        </table>
      </div>
      {overflows && <p className="flex items-center gap-1 px-3 pb-3 text-xs text-text-3">Swipe for more travelers <ArrowRight aria-hidden="true" size={14} /></p>}
      <style jsx global>{`
        .expense-added > th,
        .expense-added > td {
          background-color: color-mix(in srgb, hsl(var(--accent)) 16%, hsl(var(--surface-1)));
          box-shadow: inset 0 2px 0 hsl(var(--accent) / 0.5), inset 0 -2px 0 hsl(var(--accent) / 0.5);
          transition: background-color 0.2s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .expense-added > th,
          .expense-added > td {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}

function rowKey(row: LedgerViewRow): string {
  if (row.type === 'category') return `category-${row.category}`;
  if (row.type === 'expense') return row.expenseId;
  if (row.type === 'adjustment') return `adjustment-${row.travelerId}`;
  return row.type;
}
