import type { Ledger } from './ledger';
import type { TripParticipant } from '../pageTypes';
import { balanceStatus, capAdjustmentRows, makeNameOf } from './ledgerLabels';
import { formatMoney } from './money';

/** Render-ready row shapes for the ledger matrix. */
/** Category subtotal row, shown before its expense entries. */
export interface CategoryRow {
  type: 'category';
  category: string;
  totalCents: number;
  cells: Record<string, number>;
}

/** Expense record row containing original traveler shares and payer summary. */
export interface ExpenseRow {
  type: 'expense';
  expenseId: string;
  category: string;
  description: string;
  totalCents: number;
  cells: Record<string, number | null>;
  payers: string;
}

/** Original allocation totals before budget cap transfers. */
export interface SubtotalRow {
  type: 'subtotal';
  label: 'Expense subtotal';
  totalCents: number;
  cells: Record<string, number>;
}

/** Signed budget cap transfer for one capped traveler. */
export interface AdjustmentRow {
  type: 'adjustment';
  label: string;
  totalCents: 0;
  cells: Record<string, number>;
  travelerId: string;
}

/** Spending left without an eligible traveler to absorb it. */
export interface UncoveredRow {
  type: 'uncovered';
  label: 'Not covered by anyone';
  totalCents: number;
  cells: Record<string, null>;
}

/** Final responsibility totals after budget cap transfers. */
export interface FinalRow {
  type: 'final';
  label: 'Final cost responsibility';
  totalCents: number;
  cells: Record<string, number>;
}

/** Union of row types rendered by the Trip Cost ledger matrix. */
export type LedgerViewRow =
  | CategoryRow
  | ExpenseRow
  | SubtotalRow
  | AdjustmentRow
  | UncoveredRow
  | FinalRow;

/** Summarize recorded payers without mixing purchase amounts into share cells. */
export function payerSummary(payers: Record<string, number>, participants: TripParticipant[]): string {
  const names = Object.keys(payers)
    .filter((id) => payers[id] > 0)
    .map((id) => participants.find((participant) => participant.id === id)?.name ?? 'Unknown');
  if (names.length > 1) return `Paid by ${names[0]} + ${names.length - 1}`;
  return names.length ? `Paid by ${names[0]}` : 'No payer recorded';
}

/** Return the cap and remaining room measured against final responsibility. */
export function capBadge(ledger: Ledger, travelerId: string): string | null {
  const cap = ledger.caps.capCents[travelerId];
  if (cap === undefined) return null;
  const left = Math.max(0, cap - (ledger.final[travelerId] ?? 0));
  return `cap ${formatMoney(cap, { compact: true })} · ${formatMoney(left, { compact: true })} left`;
}

/** Build balance labels in participant order, including a settled zero balance. */
export function balanceChips(ledger: Ledger, participants: TripParticipant[]) {
  return participants.map((participant) => {
    const status = balanceStatus(ledger.remaining[participant.id] ?? 0);
    return {
      travelerId: participant.id,
      label: `${participant.name} · ${status.label}`,
      kind: status.kind,
    };
  });
}

/** Derive all table rows from the ledger without changing ledger calculations. */
export function buildLedgerRows(ledger: Ledger, participants: TripParticipant[]): LedgerViewRow[] {
  const ids = ledger.travelerIds;
  const nameOf = makeNameOf(participants);
  const rows: LedgerViewRow[] = [];

  for (const category of ledger.categories) {
    rows.push({
      type: 'category',
      category: category.category,
      totalCents: category.totalCents,
      cells: category.subtotals,
    });
    for (const expense of category.expenses) {
      const cells: Record<string, number | null> = {};
      for (const id of ids) {
        cells[id] = Object.hasOwn(expense.shares, id) ? expense.shares[id] : null;
      }
      rows.push({
        type: 'expense',
        expenseId: expense.expenseId,
        category: expense.category,
        description: expense.description,
        totalCents: expense.totalCents,
        cells,
        payers: payerSummary(expense.payers, participants),
      });
    }
  }

  rows.push({
    type: 'subtotal',
    label: 'Expense subtotal',
    totalCents: ledger.totalSpendingCents,
    cells: ledger.subtotals,
  });
  for (const adjustment of capAdjustmentRows(ledger.caps, nameOf)) {
    rows.push({
      type: 'adjustment',
      label: adjustment.label,
      totalCents: 0,
      cells: adjustment.deltas,
      travelerId: adjustment.travelerId,
    });
  }
  if (ledger.unallocatedCents > 0) {
    rows.push({
      type: 'uncovered',
      label: 'Not covered by anyone',
      totalCents: ledger.unallocatedCents,
      cells: Object.fromEntries(ids.map((id) => [id, null])),
    });
  }
  rows.push({
    type: 'final',
    label: 'Final cost responsibility',
    totalCents: ids.reduce((sum, id) => sum + (ledger.final[id] ?? 0), 0),
    cells: ledger.final,
  });
  return rows;
}

/** Format an excluded share as a dash and preserve explicit zero as money. */
export function explicitZeroLabel(value: number | null): string {
  return value === null ? '—' : formatMoney(value);
}
