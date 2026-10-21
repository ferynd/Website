import type { TripParticipant } from '../pageTypes';
import type { BudgetCapResult, Ledger, LedgerProblem, SettlementPauseReason } from './ledger';
import { formatMoney } from './money';

/* ------------------------------------------------------------------ */
/*  Names                                                              */
/* ------------------------------------------------------------------ */

export const UNKNOWN_TRAVELER = 'Unknown traveler';

export function makeNameOf(participants: Pick<TripParticipant, 'id' | 'name'>[]): (id: string) => string {
  const names = new Map(participants.map((p) => [p.id, p.name]));
  return (id) => names.get(id) || UNKNOWN_TRAVELER;
}

const possessive = (name: string) => `${name}'s`;

/* ------------------------------------------------------------------ */
/*  Budget cap rows                                                    */
/* ------------------------------------------------------------------ */

/**
 * "Kait's cap ($200): $100 covered by James"
 * "Kait's cap ($200): $100 covered by James $50, Bob $50"
 * "Kait's cap ($200): $100 covered by James $80; $20 not covered by anyone"
 */
export function capAdjustmentLabel(input: {
  name: string;
  capCents: number;
  absorbers: { name: string; cents: number }[];
  uncoveredCents?: number;
}): string {
  const money = (cents: number) => formatMoney(cents, { compact: true });
  const covered = input.absorbers.reduce((s, a) => s + a.cents, 0);
  const uncovered = input.uncoveredCents ?? 0;
  const prefix = `${possessive(input.name)} cap (${money(input.capCents)}): `;
  const parts: string[] = [];
  if (input.absorbers.length === 1) {
    parts.push(`${money(covered)} covered by ${input.absorbers[0].name}`);
  } else if (input.absorbers.length > 1) {
    const list = input.absorbers.map((a) => `${a.name} ${money(a.cents)}`).join(', ');
    parts.push(`${money(covered)} covered by ${list}`);
  }
  if (uncovered > 0) parts.push(`${money(uncovered)} not covered by anyone`);
  return prefix + parts.join('; ');
}

export interface CapAdjustmentRow {
  travelerId: string;
  label: string;
  /** Signed change per traveler: negative for the capped traveler, positive for absorbers. */
  deltas: Record<string, number>;
  uncoveredCents: number;
}

/** One row per traveler whose costs were reduced by their cap. */
export function capAdjustmentRows(caps: BudgetCapResult, nameOf: (id: string) => string): CapAdjustmentRow[] {
  return Object.keys(caps.adjustments)
    .filter((id) => caps.adjustments[id] < 0)
    .map((id) => {
      const transfers = caps.transfers.filter((t) => t.from === id);
      const uncoveredCents = caps.uncovered
        .filter((u) => u.from === id)
        .reduce((s, u) => s + u.cents, 0);
      const deltas: Record<string, number> = { [id]: caps.adjustments[id] };
      for (const t of transfers) deltas[t.to] = (deltas[t.to] ?? 0) + t.cents;
      return {
        travelerId: id,
        label: capAdjustmentLabel({
          name: nameOf(id),
          capCents: caps.capCents[id] ?? 0,
          absorbers: transfers.map((t) => ({ name: nameOf(t.to), cents: t.cents })),
          uncoveredCents,
        }),
        deltas,
        uncoveredCents,
      };
    });
}

/* ------------------------------------------------------------------ */
/*  Balance status                                                     */
/* ------------------------------------------------------------------ */

export interface BalanceStatus {
  kind: 'owes' | 'is-owed' | 'settled';
  label: string;
}

/** Remaining is positive when the traveler owes and negative when they are owed. */
export function balanceStatus(remainingCents: number): BalanceStatus {
  if (remainingCents > 0) return { kind: 'owes', label: `Owes ${formatMoney(remainingCents)}` };
  if (remainingCents < 0) return { kind: 'is-owed', label: `Is owed ${formatMoney(-remainingCents)}` };
  return { kind: 'settled', label: 'Settled' };
}

/* ------------------------------------------------------------------ */
/*  Problems                                                           */
/* ------------------------------------------------------------------ */

export function describeProblem(
  problem: LedgerProblem,
  ledger: Pick<Ledger, 'expenses'>,
  nameOf: (id: string) => string,
): string {
  const expense = ledger.expenses.find((e) => e.expenseId === problem.expenseId);
  const what = `"${expense?.description || 'Untitled expense'}"`;
  const amount = formatMoney(Math.abs(problem.cents ?? 0));
  switch (problem.kind) {
    case 'invalid-total':
      return `${what} has an invalid total and is counted as $0.00.`;
    case 'no-payer':
      return `${what}: nobody is recorded as paying ${amount}.`;
    case 'unknown-payer':
      return `${what}: ${amount} was paid by someone who is no longer on the trip.`;
    case 'payer-mismatch':
      return `${what}: payer amounts are ${amount} ${(problem.cents ?? 0) > 0 ? 'more' : 'less'} than the total.`;
    case 'empty-split':
      return `${what}: no travelers are included, so ${amount} is unassigned.`;
    case 'unknown-traveler':
      return `${what}: ${amount} is assigned to someone who is no longer on the trip.`;
    case 'invalid-share':
      return `${what}: ${possessive(nameOf(problem.travelerId ?? ''))} share is invalid and counted as $0.00.`;
    case 'split-mismatch':
      return problem.direction === 'over'
        ? `${what}: shares add up to ${amount} more than the total, so they were scaled down to fit.`
        : `${what}: shares are ${amount} short of the total; the difference is unassigned.`;
    case 'invalid-payment':
      return 'A recorded payment has an invalid amount or the same payer and payee, so it is ignored.';
    case 'unknown-payment-traveler':
      return `A recorded payment of ${amount} involves someone who is no longer on the trip, so it is ignored.`;
    case 'caps-infeasible':
      return `Budget caps leave ${amount} not covered by anyone. Raise a cap or add someone without a cap.`;
    case 'overage-fallback':
      return "Custom overage shares don't cover anyone still under their cap, so over-cap costs are split evenly instead.";
  }
}

export function settlementPausedMessage(reason: SettlementPauseReason, unallocatedCents: number): string {
  if (reason === 'unallocated') {
    return `${formatMoney(unallocatedCents)} of costs is not assigned to anyone. Settlement suggestions are paused until the problems above are fixed.`;
  }
  return "Balances don't add up to zero. Settlement suggestions are paused until the problems above are fixed.";
}
