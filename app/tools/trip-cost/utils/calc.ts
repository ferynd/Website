// ===============================
// CONFIGURATION
// ===============================
// None

import type { Expense, Payment, Person, Balance } from '../pageTypes';

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
