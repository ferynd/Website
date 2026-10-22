import type { Expense, OverageSplit, SpendCap, Trip } from '../pageTypes';
import { allocateCents, toCents } from './money';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every amount in this module is integer cents. Stored records stay in
 * dollars; they are converted once on the way in.
 */

export type LedgerProblemKind =
  /** Expense total is missing, negative, or not a number; counted as $0. */
  | 'invalid-total'
  /** Nobody is recorded as paying for the expense. */
  | 'no-payer'
  /** A payer id is not a current traveler; that amount is credited to no one. */
  | 'unknown-payer'
  /** Payer amounts differ from the total by more than $0.01; kept as recorded. */
  | 'payer-mismatch'
  /** The split includes nobody; the whole total is unassigned. */
  | 'empty-split'
  /** A split traveler is not on the trip; their share is unassigned. */
  | 'unknown-traveler'
  /** A manual share is negative or not a number; counted as $0. */
  | 'invalid-share'
  /** Manual shares miss the total by more than the legacy tolerance. */
  | 'split-mismatch'
  /** Payment amount is not positive, or payer and payee are the same; ignored. */
  | 'invalid-payment'
  /** Payment references someone who is not on the trip; ignored. */
  | 'unknown-payment-traveler'
  /** Budget caps leave over-cap costs with nobody eligible to absorb them. */
  | 'caps-infeasible'
  /** Manual overage shares cover nobody still eligible; split evenly instead. */
  | 'overage-fallback';

export interface LedgerProblem {
  kind: LedgerProblemKind;
  severity: 'error' | 'warning';
  expenseId?: string;
  paymentId?: string;
  travelerId?: string;
  /** Amount affected, when there is one. */
  cents?: number;
  /** For split-mismatch: whether shares fell short of or exceeded the total. */
  direction?: 'under' | 'over';
}

export interface ExpenseAllocation {
  expenseId: string;
  category: string;
  description: string;
  totalCents: number;
  /** Cents paid by each known traveler. */
  payers: Record<string, number>;
  /** Original share of each included known traveler (explicit zeros kept). */
  shares: Record<string, number>;
  /** Known travelers left out of this expense. */
  excluded: string[];
  /** Part of the total not allocated to any known traveler. */
  unassignedCents: number;
  /** Total minus the cents credited to known payers (non-zero means a payer problem). */
  unpaidCents: number;
  problems: LedgerProblem[];
}

export interface CapTransfer {
  /** Capped traveler whose responsibility is reduced. */
  from: string;
  /** Traveler who absorbs it. */
  to: string;
  cents: number;
}

export interface BudgetCapResult {
  /** Final cost responsibility after caps. */
  final: Record<string, number>;
  /** final − subtotal per traveler. */
  adjustments: Record<string, number>;
  transfers: CapTransfer[];
  /** Reductions nobody could absorb, per capped traveler. */
  uncovered: { from: string; cents: number }[];
  unallocatedCents: number;
  /** Manual overage shares covered nobody eligible, so the split fell back to even. */
  fallbackUsed: boolean;
  /** Valid caps (cents) of travelers on the trip. */
  capCents: Record<string, number>;
  /** Travelers held at their cap. */
  cappedIds: string[];
}

export interface LedgerCategory {
  category: string;
  totalCents: number;
  count: number;
  expenses: ExpenseAllocation[];
  subtotals: Record<string, number>;
  unassignedCents: number;
}

export interface Settlement {
  from: string;
  to: string;
  cents: number;
}

export type SettlementPauseReason = 'unallocated' | 'non-conserving';

export interface SettlementResult {
  settlements: Settlement[];
  paused: SettlementPauseReason | null;
}

export interface Ledger {
  travelerIds: string[];
  expenses: ExpenseAllocation[];
  /** Sorted by total, largest first. */
  categories: LedgerCategory[];
  /** Sum of expense totals. Reimbursements and caps never change it. */
  totalSpendingCents: number;
  /** Expense subtotal: each traveler's original allocated costs. */
  subtotals: Record<string, number>;
  caps: BudgetCapResult;
  final: Record<string, number>;
  /** Paid for purchases. */
  paid: Record<string, number>;
  reimbursementsSent: Record<string, number>;
  reimbursementsReceived: Record<string, number>;
  /** final − paid − sent + received. Positive owes, negative is owed. */
  remaining: Record<string, number>;
  /** Expense shares assigned to no known traveler. */
  unassignedCents: number;
  /** Spending not credited to any known payer. */
  unpaidCents: number;
  /** Unassigned shares plus costs no cap-eligible traveler could absorb. */
  unallocatedCents: number;
  problems: LedgerProblem[];
  settlement: SettlementResult;
}

export type LedgerInput = Pick<Trip, 'participants' | 'expenses' | 'payments'> &
  Partial<Pick<Trip, 'spendCaps' | 'overageSplit'>>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const zeroes = (ids: string[]): Record<string, number> =>
  Object.fromEntries(ids.map((id) => [id, 0]));

const sumValues = (record: Record<string, number>): number =>
  Object.values(record).reduce((s, n) => s + n, 0);

/** Legacy writes allowed payer and amount sums to miss by up to $0.01. */
const AMOUNT_TOLERANCE_CENTS = 1;
/** Legacy writes allowed percentage sums to miss 100 by 0.01 points. */
const PERCENT_TOLERANCE_POINTS = 0.01;
const EPSILON = 1e-6;

/** Whether a stored reimbursement is included in ledger totals. */
export function isValidLedgerPayment(payment: Trip['payments'][number], travelerIds: string[]): boolean {
  const cents = toCents(payment.amount);
  return Number.isFinite(cents) && cents > 0 && payment.payerId !== payment.payeeId &&
    travelerIds.includes(payment.payerId) && travelerIds.includes(payment.payeeId);
}

/* ------------------------------------------------------------------ */
/*  Expense allocation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Allocates one stored expense to travelers in integer cents.
 *
 * - Even splits use largest remainder, ties by `splitParticipants` order.
 * - Manual splits within the legacy tolerance (±$0.01, or ±0.01 percentage
 *   points) are spread over their actual sum so they cover the total exactly.
 *   Larger gaps are flagged: a shortfall stays unassigned, an excess is
 *   scaled down to the total.
 * - Payers within ±$0.01 are spread to the total; anything else is kept as
 *   recorded and flagged.
 * - Unknown travelers never absorb cost silently: their share is unassigned
 *   and reported.
 */
export function allocateExpense(expense: Expense, travelerIds: string[]): ExpenseAllocation {
  const known = new Set(travelerIds);
  const problems: LedgerProblem[] = [];
  const expenseId = expense.id;

  let totalCents = toCents(expense.totalAmount);
  if (!Number.isFinite(totalCents) || totalCents < 0) {
    problems.push({ kind: 'invalid-total', severity: 'error', expenseId });
    totalCents = 0;
  }

  /* ---- payers ---- */
  const payerOrder: string[] = [];
  const payerWeights: Record<string, number> = {};
  for (const [id, amount] of Object.entries(expense.paidBy || {})) {
    // The old form dropped blank/zero payer entries; skip them the same way.
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) continue;
    payerOrder.push(id);
    payerWeights[id] = amount * 100;
  }
  const payerSum = sumValues(payerWeights);
  let payerCents: Record<string, number> = {};
  if (!payerOrder.length) {
    if (totalCents > 0) problems.push({ kind: 'no-payer', severity: 'error', expenseId, cents: totalCents });
  } else if (Math.abs(payerSum - totalCents) <= AMOUNT_TOLERANCE_CENTS + EPSILON) {
    payerCents = allocateCents(totalCents, payerWeights, payerOrder);
  } else {
    for (const id of payerOrder) payerCents[id] = toCents(expense.paidBy[id]);
    problems.push({
      kind: 'payer-mismatch',
      severity: 'error',
      expenseId,
      cents: sumValues(payerCents) - totalCents,
    });
  }
  const payers: Record<string, number> = {};
  for (const id of payerOrder) {
    if (known.has(id)) {
      payers[id] = payerCents[id] ?? 0;
    } else {
      problems.push({ kind: 'unknown-payer', severity: 'error', expenseId, travelerId: id, cents: payerCents[id] ?? 0 });
    }
  }

  /* ---- shares ---- */
  // Duplicate ids would otherwise double-count a weight.
  const splitOrder = Array.from(new Set(expense.splitParticipants || []));
  let rawShares: Record<string, number> = {};
  if (!splitOrder.length) {
    if (totalCents > 0) problems.push({ kind: 'empty-split', severity: 'error', expenseId, cents: totalCents });
  } else if (expense.splitType !== 'manual') {
    rawShares = allocateCents(totalCents, Object.fromEntries(splitOrder.map((id) => [id, 1])), splitOrder);
  } else {
    rawShares = allocateManualSplit(expense, splitOrder, totalCents, problems);
  }

  const shares: Record<string, number> = {};
  for (const id of splitOrder) {
    if (known.has(id)) {
      shares[id] = rawShares[id] ?? 0;
    } else {
      problems.push({ kind: 'unknown-traveler', severity: 'error', expenseId, travelerId: id, cents: rawShares[id] ?? 0 });
    }
  }

  return {
    expenseId,
    category: expense.category,
    description: expense.description,
    totalCents,
    payers,
    shares,
    excluded: travelerIds.filter((id) => !(id in shares)),
    unassignedCents: totalCents - sumValues(shares),
    unpaidCents: totalCents - sumValues(payers),
    problems,
  };
}

function allocateManualSplit(
  expense: Expense,
  splitOrder: string[],
  totalCents: number,
  problems: LedgerProblem[],
): Record<string, number> {
  const expenseId = expense.id;
  const ideal: Record<string, number> = {};
  const percents: Record<string, number> = {};
  let hasAmount = false;
  let hasPercent = false;
  for (const id of splitOrder) {
    const entry = expense.manualSplit?.[id];
    // A missing entry is how the old form stored a blank (zero) share.
    if (!entry) {
      ideal[id] = 0;
      continue;
    }
    const value = entry.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      problems.push({ kind: 'invalid-share', severity: 'error', expenseId, travelerId: id });
      ideal[id] = 0;
      percents[id] = 0;
      continue;
    }
    if (entry.type === 'percent') {
      hasPercent = true;
      percents[id] = value;
      ideal[id] = (value / 100) * totalCents;
    } else {
      hasAmount = true;
      ideal[id] = value * 100;
    }
  }
  const idealSum = sumValues(ideal);
  const tolerance =
    (hasAmount ? AMOUNT_TOLERANCE_CENTS : 0) +
    (hasPercent ? (totalCents * PERCENT_TOLERANCE_POINTS) / 100 : 0) +
    EPSILON;
  // Pure percent splits use the recorded percentages as exact weights.
  const weights = hasPercent && !hasAmount ? { ...ideal, ...percents } : ideal;
  const diff = idealSum - totalCents;

  if (Math.abs(diff) <= tolerance && idealSum > 0) {
    return allocateCents(totalCents, weights, splitOrder);
  }
  if (totalCents === 0) return zeroes(splitOrder);
  if (diff > 0) {
    problems.push({ kind: 'split-mismatch', severity: 'error', expenseId, direction: 'over', cents: Math.round(diff) });
    return allocateCents(totalCents, weights, splitOrder);
  }
  // Shortfall: charge what was recorded and leave the gap unassigned.
  const recorded = idealSum > 0 ? allocateCents(Math.round(idealSum), weights, splitOrder) : zeroes(splitOrder);
  problems.push({
    kind: 'split-mismatch',
    severity: 'error',
    expenseId,
    direction: 'under',
    cents: totalCents - sumValues(recorded),
  });
  return recorded;
}

/* ------------------------------------------------------------------ */
/*  Budget caps                                                        */
/* ------------------------------------------------------------------ */

/**
 * Applies per-traveler budget caps to expense subtotals (never to
 * reimbursements).
 *
 * Over-cap costs cascade to every traveler not held at their cap (decision
 * D1: including people with a $0 share), evenly or by manual overage shares.
 * Manual shares that cover nobody still eligible fall back to even and set
 * `fallbackUsed`. When nobody is eligible, the rest is `unallocatedCents`.
 *
 * Transfers attribute each capped traveler's reduction to absorbers in
 * proportion to each absorber's net increase (display only). Every transfer
 * nets to zero and each traveler's transfers sum to their net adjustment.
 */
export function applyBudgetCaps(
  subtotals: Record<string, number>,
  caps: SpendCap[] | undefined,
  overageSplit: OverageSplit | undefined,
  order: string[],
): BudgetCapResult {
  const ids = Array.from(new Set(order));
  const capCents: Record<string, number> = {};
  for (const cap of caps || []) {
    if (!ids.includes(cap.participantId)) continue;
    const cents = toCents(cap.maxAmount);
    if (!Number.isFinite(cents) || cents < 0) continue;
    capCents[cap.participantId] = cents;
  }
  const base = (id: string) => subtotals[id] ?? 0;

  const locked = new Set<string>();
  let final: Record<string, number> = Object.fromEntries(ids.map((id) => [id, base(id)]));
  let unallocatedCents = 0;
  let fallbackUsed = false;

  // Lock everyone over their cap, re-spread the pooled overage over the rest,
  // and repeat: absorbing can push someone else over their cap.
  for (;;) {
    for (const id of ids) {
      if (!locked.has(id) && id in capCents && final[id] > capCents[id]) locked.add(id);
    }
    const pool = ids
      .filter((id) => locked.has(id))
      .reduce((s, id) => s + (base(id) - capCents[id]), 0);
    const eligible = ids.filter((id) => !locked.has(id));
    const next: Record<string, number> = {};
    for (const id of ids) next[id] = locked.has(id) ? capCents[id] : base(id);
    unallocatedCents = 0;
    fallbackUsed = false;

    if (pool > 0 && !eligible.length) {
      unallocatedCents = pool;
    } else if (pool > 0) {
      let weights: Record<string, number> = Object.fromEntries(eligible.map((id) => [id, 1]));
      if (overageSplit?.type === 'manual') {
        const manual = Object.fromEntries(
          eligible.map((id) => {
            const share = overageSplit.shares?.[id];
            return [id, typeof share === 'number' && Number.isFinite(share) && share > 0 ? share : 0];
          }),
        );
        if (sumValues(manual) > 0) weights = manual;
        else fallbackUsed = true;
      }
      const spread = allocateCents(pool, weights, eligible);
      for (const id of eligible) next[id] += spread[id];
    }
    final = next;
    if (!ids.some((id) => !locked.has(id) && id in capCents && final[id] > capCents[id])) break;
  }

  const adjustments = Object.fromEntries(ids.map((id) => [id, final[id] - base(id)]));
  const { transfers, uncovered } = attributeTransfers(adjustments, unallocatedCents, ids);

  return {
    final,
    adjustments,
    transfers,
    uncovered,
    unallocatedCents,
    fallbackUsed,
    capCents,
    cappedIds: ids.filter((id) => locked.has(id)),
  };
}

const UNCOVERED = '\u0000uncovered';

function attributeTransfers(
  adjustments: Record<string, number>,
  unallocatedCents: number,
  ids: string[],
): { transfers: CapTransfer[]; uncovered: { from: string; cents: number }[] } {
  const reducers = ids.filter((id) => adjustments[id] < 0);
  const columns = ids.filter((id) => adjustments[id] > 0);
  // Remaining capacity per absorber; "not covered" is a pseudo-absorber.
  const capacity: Record<string, number> = Object.fromEntries(columns.map((id) => [id, adjustments[id]]));
  if (unallocatedCents > 0) {
    columns.push(UNCOVERED);
    capacity[UNCOVERED] = unallocatedCents;
  }
  const transfers: CapTransfer[] = [];
  const uncovered: { from: string; cents: number }[] = [];
  // Allocating each row over the remaining capacity keeps every column sum
  // exact (the last row takes exactly what is left) while staying within a
  // cent of strict proportionality.
  for (const from of reducers) {
    const row = allocateCents(-adjustments[from], { ...capacity }, columns);
    for (const to of columns) {
      const cents = row[to];
      if (!cents) continue;
      capacity[to] -= cents;
      if (to === UNCOVERED) uncovered.push({ from, cents });
      else transfers.push({ from, to, cents });
    }
  }
  return { transfers, uncovered };
}

/* ------------------------------------------------------------------ */
/*  Settlements                                                        */
/* ------------------------------------------------------------------ */

/**
 * Greedy settlement suggestions keyed by traveler id. `remaining` is
 * positive for people who owe and negative for people who are owed; key
 * order breaks ties.
 *
 * Paused (no suggestions) when costs are unallocated or remaining does not
 * net to zero: advice would otherwise leave money unsettled or have one
 * creditor pay another (F-087).
 */
export function calculateSettlements(
  remaining: Record<string, number>,
  options: { unallocatedCents?: number } = {},
): SettlementResult {
  if ((options.unallocatedCents ?? 0) !== 0) return { settlements: [], paused: 'unallocated' };
  const entries = Object.entries(remaining);
  if (
    entries.some(([, cents]) => !Number.isSafeInteger(cents)) ||
    entries.reduce((s, [, cents]) => s + cents, 0) !== 0
  ) {
    return { settlements: [], paused: 'non-conserving' };
  }

  // Largest debtor first, largest creditor last (stable, so ties keep key order).
  const work = entries.map(([id, cents]) => ({ id, cents })).sort((a, b) => b.cents - a.cents);
  const settlements: Settlement[] = [];
  let i = 0;
  let j = work.length - 1;
  while (i < j) {
    const debtor = work[i];
    const creditor = work[j];
    if (debtor.cents <= 0) {
      i++;
      continue;
    }
    if (creditor.cents >= 0) {
      j--;
      continue;
    }
    const cents = Math.min(debtor.cents, -creditor.cents);
    settlements.push({ from: debtor.id, to: creditor.id, cents });
    debtor.cents -= cents;
    creditor.cents += cents;
    if (debtor.cents === 0) i++;
    if (creditor.cents === 0) j--;
  }
  return { settlements, paused: null };
}

/* ------------------------------------------------------------------ */
/*  Ledger                                                             */
/* ------------------------------------------------------------------ */

/**
 * Builds the whole trip ledger: expense allocations grouped by category,
 * expense subtotal, budget-cap transfers, final responsibility, purchases
 * paid, reimbursements, remaining balances, problems, and settlements.
 *
 * Reimbursements only move money between travelers: they never change
 * total spending, final responsibility, or what counts against a cap.
 */
export function buildLedger(trip: LedgerInput): Ledger {
  const travelerIds = Array.from(new Set((trip.participants || []).map((p) => p.id)));
  const known = new Set(travelerIds);
  const problems: LedgerProblem[] = [];

  const expenses = (trip.expenses || []).map((e) => allocateExpense(e, travelerIds));
  const subtotals = zeroes(travelerIds);
  const paid = zeroes(travelerIds);
  let totalSpendingCents = 0;
  let unassignedCents = 0;
  let unpaidCents = 0;
  const categoryMap = new Map<string, LedgerCategory>();
  for (const allocation of expenses) {
    totalSpendingCents += allocation.totalCents;
    unassignedCents += allocation.unassignedCents;
    unpaidCents += allocation.unpaidCents;
    for (const [id, cents] of Object.entries(allocation.shares)) subtotals[id] += cents;
    for (const [id, cents] of Object.entries(allocation.payers)) paid[id] += cents;
    problems.push(...allocation.problems);

    let group = categoryMap.get(allocation.category);
    if (!group) {
      group = {
        category: allocation.category,
        totalCents: 0,
        count: 0,
        expenses: [],
        subtotals: zeroes(travelerIds),
        unassignedCents: 0,
      };
      categoryMap.set(allocation.category, group);
    }
    group.totalCents += allocation.totalCents;
    group.count += 1;
    group.expenses.push(allocation);
    group.unassignedCents += allocation.unassignedCents;
    for (const [id, cents] of Object.entries(allocation.shares)) group.subtotals[id] += cents;
  }
  const categories = Array.from(categoryMap.values()).sort((a, b) => b.totalCents - a.totalCents);

  const caps = applyBudgetCaps(subtotals, trip.spendCaps, trip.overageSplit, travelerIds);
  if (caps.unallocatedCents > 0) {
    problems.push({ kind: 'caps-infeasible', severity: 'error', cents: caps.unallocatedCents });
  }
  if (caps.fallbackUsed) problems.push({ kind: 'overage-fallback', severity: 'warning' });

  const sent = zeroes(travelerIds);
  const received = zeroes(travelerIds);
  for (const payment of trip.payments || []) {
    const cents = toCents(payment.amount);
    if (!Number.isFinite(cents) || cents <= 0 || payment.payerId === payment.payeeId) {
      problems.push({ kind: 'invalid-payment', severity: 'warning', paymentId: payment.id });
      continue;
    }
    if (!known.has(payment.payerId) || !known.has(payment.payeeId)) {
      problems.push({
        kind: 'unknown-payment-traveler',
        severity: 'error',
        paymentId: payment.id,
        travelerId: known.has(payment.payerId) ? payment.payeeId : payment.payerId,
        cents,
      });
      continue;
    }
    sent[payment.payerId] += cents;
    received[payment.payeeId] += cents;
  }

  const remaining = Object.fromEntries(
    travelerIds.map((id) => [id, caps.final[id] - paid[id] - sent[id] + received[id]]),
  );
  const unallocatedCents = unassignedCents + caps.unallocatedCents;

  return {
    travelerIds,
    expenses,
    categories,
    totalSpendingCents,
    subtotals,
    caps,
    final: caps.final,
    paid,
    reimbursementsSent: sent,
    reimbursementsReceived: received,
    remaining,
    unassignedCents,
    unpaidCents,
    unallocatedCents,
    problems,
    settlement: calculateSettlements(remaining, { unallocatedCents }),
  };
}
