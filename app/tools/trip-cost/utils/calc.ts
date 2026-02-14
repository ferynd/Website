import type {
  Expense,
  Payment,
  Person,
  Balance,
  CappedBalance,
  SpendCap,
  OverageSplit,
} from '../pageTypes';

/* ------------------------------------------------------------------ */
/*  Core balance calculation (unchanged logic, no caps)                */
/* ------------------------------------------------------------------ */

export function calculateBalances(
  people: Person[],
  expenses: Expense[],
  allPayments: Payment[]
): Balance[] {
  const balances: Balance[] = people.map((person) => ({
    personId: person.id,
    name: person.name,
    totalPaid: 0,
    shouldHavePaid: 0,
    balance: 0,
  }));

  expenses.forEach((expense) => {
    Object.entries(expense.paidBy).forEach(([personId, amount]) => {
      const bal = balances.find((b) => b.personId === personId);
      if (bal) bal.totalPaid += amount;
    });

    const shouldPayMap: { [personId: string]: number } = {};
    if (expense.splitType === 'even') {
      const per = expense.totalAmount / expense.splitParticipants.length;
      expense.splitParticipants.forEach((id) => {
        shouldPayMap[id] = per;
      });
    } else {
      expense.splitParticipants.forEach((id) => {
        const split = expense.manualSplit[id];
        if (split) {
          shouldPayMap[id] =
            split.type === 'percent'
              ? (split.value / 100) * expense.totalAmount
              : split.value;
        }
      });
    }
    Object.entries(shouldPayMap).forEach(([id, amount]) => {
      const bal = balances.find((b) => b.personId === id);
      if (bal) bal.shouldHavePaid += amount;
    });
  });

  allPayments.forEach((p) => {
    const payer = balances.find((b) => b.personId === p.payerId);
    const payee = balances.find((b) => b.personId === p.payeeId);
    if (payer) payer.totalPaid += p.amount;
    if (payee) payee.shouldHavePaid += p.amount;
  });

  balances.forEach((b) => {
    b.balance = b.totalPaid - b.shouldHavePaid;
  });
  return balances;
}

/* ------------------------------------------------------------------ */
/*  Spend-cap enforcement with cascading redistribution                */
/* ------------------------------------------------------------------ */

/**
 * Applies per-participant spend caps to raw balances.
 *
 * Algorithm (iterative cascading):
 *  1. Start with raw shouldHavePaid from calculateBalances.
 *  2. For each capped participant whose shouldHavePaid > cap,
 *     compute overage = shouldHavePaid − cap, lock them at cap.
 *  3. Redistribute overage to uncapped participants using overageSplit
 *     (even or manual shares).
 *  4. Repeat until no new participant exceeds their cap (cascading).
 *  5. Recompute balance = totalPaid − shouldHavePaid for everyone.
 */
export function applySpendCaps(
  rawBalances: Balance[],
  spendCaps: SpendCap[],
  overageSplit: OverageSplit = { type: 'even' }
): CappedBalance[] {
  if (!spendCaps.length) {
    return rawBalances.map((b) => ({
      ...b,
      rawShouldHavePaid: b.shouldHavePaid,
      isCapped: false,
    }));
  }

  const capMap = new Map(spendCaps.map((c) => [c.participantId, c.maxAmount]));

  // Working copy of shouldHavePaid
  const work = new Map(
    rawBalances.map((b) => [b.personId, b.shouldHavePaid])
  );
  const locked = new Set<string>();

  // Iterative cascading – repeat until stable
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, cap] of capMap) {
      if (locked.has(pid)) continue;
      const current = work.get(pid) ?? 0;
      if (current <= cap + 0.005) continue; // within tolerance

      // This person is over cap
      const overage = current - cap;
      work.set(pid, cap);
      locked.add(pid);
      changed = true;

      // Find eligible recipients (not locked, present in balances)
      const eligible = rawBalances
        .map((b) => b.personId)
        .filter((id) => id !== pid && !locked.has(id));

      if (!eligible.length) break; // no one to absorb

      if (overageSplit.type === 'manual' && overageSplit.shares) {
        // Manual percentage shares among eligible
        const shares = overageSplit.shares;
        const totalShare = eligible.reduce(
          (s, id) => s + (shares[id] ?? 0),
          0
        );
        if (totalShare > 0) {
          for (const id of eligible) {
            const pct = (shares[id] ?? 0) / totalShare;
            work.set(id, (work.get(id) ?? 0) + overage * pct);
          }
        } else {
          // Fallback: even among eligible
          const per = overage / eligible.length;
          for (const id of eligible) {
            work.set(id, (work.get(id) ?? 0) + per);
          }
        }
      } else {
        // Even split among eligible
        const per = overage / eligible.length;
        for (const id of eligible) {
          work.set(id, (work.get(id) ?? 0) + per);
        }
      }
    }
  }

  return rawBalances.map((b) => {
    const newShouldHavePaid = work.get(b.personId) ?? b.shouldHavePaid;
    const cap = capMap.get(b.personId);
    return {
      ...b,
      rawShouldHavePaid: b.shouldHavePaid,
      shouldHavePaid: Math.round(newShouldHavePaid * 100) / 100,
      balance:
        Math.round((b.totalPaid - newShouldHavePaid) * 100) / 100,
      isCapped: locked.has(b.personId),
      capAmount: cap,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Settlement suggestions (greedy two-pointer)                        */
/* ------------------------------------------------------------------ */

export function calculateSettlements(balances: Balance[]): {
  from: string;
  to: string;
  amount: number;
}[] {
  const copy = balances.map((b) => ({ ...b }));
  const settlements: { from: string; to: string; amount: number }[] = [];
  copy.sort((a, b) => a.balance - b.balance);
  let i = 0;
  let j = copy.length - 1;
  while (i < j) {
    const debtor = copy[i];
    const creditor = copy[j];
    if (Math.abs(debtor.balance) < 0.01) {
      i++;
      continue;
    }
    if (Math.abs(creditor.balance) < 0.01) {
      j--;
      continue;
    }
    const amount = Math.min(Math.abs(debtor.balance), creditor.balance);
    settlements.push({
      from: debtor.name,
      to: creditor.name,
      amount: Math.round(amount * 100) / 100,
    });
    debtor.balance += amount;
    creditor.balance -= amount;
    if (Math.abs(debtor.balance) < 0.01) i++;
    if (Math.abs(creditor.balance) < 0.01) j--;
  }
  return settlements;
}

/* ------------------------------------------------------------------ */
/*  Helpers for category aggregation                                   */
/* ------------------------------------------------------------------ */

export interface CategorySummary {
  category: string;
  total: number;
  count: number;
  expenses: Expense[];
}

export function groupExpensesByCategory(
  expenses: Expense[]
): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const e of expenses) {
    const existing = map.get(e.category);
    if (existing) {
      existing.total += e.totalAmount;
      existing.count += 1;
      existing.expenses.push(e);
    } else {
      map.set(e.category, {
        category: e.category,
        total: e.totalAmount,
        count: 1,
        expenses: [e],
      });
    }
  }
  // Sort categories by total descending
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
