"use client";

import React from 'react';
import Dialog from '../ui/Dialog';
import { useTrip } from '../../TripContext';
import { balanceStatus, makeNameOf } from '../../utils/ledgerLabels';
import { formatMoney, toCents } from '../../utils/money';
import { isValidLedgerPayment } from '../../utils/ledger';

interface TravelerDetailSheetProps {
  travelerId: string | null;
  onClose: () => void;
}

interface MetricProps {
  label: string;
  value: number;
}

/** One money metric in the traveler detail grid. */
function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded bg-surface-2 p-3">
      <div className="text-text-3">{label}</div>
      <strong>{formatMoney(value)}</strong>
    </div>
  );
}

/** Explain one traveler's original shares, cap movement, and remaining balance. */
export default function TravelerDetailSheet({ travelerId, onClose }: TravelerDetailSheetProps) {
  const { participants, ledger, payments } = useTrip();
  const person = participants.find((participant) => participant.id === travelerId);
  const nameOf = makeNameOf(participants);
  if (!person) return null;

  const adjustment = ledger.caps.adjustments[person.id] ?? 0;
  const status = balanceStatus(ledger.remaining[person.id] ?? 0);
  const rows = ledger.expenses.filter((expense) => Object.hasOwn(expense.shares, person.id));

  return (
    <Dialog open title={`${person.name} · cost details`} onClose={onClose}>
      <div className="space-y-4 text-sm text-text-2">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Expense subtotal" value={ledger.subtotals[person.id] ?? 0} />
          <Metric label="Final responsibility" value={ledger.final[person.id] ?? 0} />
          <Metric label="Paid for purchases" value={ledger.paid[person.id] ?? 0} />
          <Metric label="Reimbursements sent" value={ledger.reimbursementsSent[person.id] ?? 0} />
          <Metric label="Reimbursements received" value={ledger.reimbursementsReceived[person.id] ?? 0} />
          <div className="rounded bg-surface-2 p-3">
            <div className="text-text-3">Remaining</div>
            <strong>{status.label}</strong>
          </div>
        </div>
        {adjustment !== 0 && (
          <p>
            {adjustment < 0
              ? `${person.name}'s responsibility was reduced by ${formatMoney(-adjustment)} under the budget cap.`
              : `${person.name} absorbs ${formatMoney(adjustment)} in costs moved from capped travelers.`}
          </p>
        )}
        <section>
          <h3 className="font-semibold text-text">Expense shares</h3>
          <ul className="mt-2 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.expenseId} className="flex min-w-0 justify-between gap-3 py-2">
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{row.description}</span>
                <span className="shrink-0">{formatMoney(row.shares[person.id])}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="font-semibold text-text">Reimbursements</h3>
          <ul className="mt-2 space-y-1">
            {payments
              .filter((payment) => isValidLedgerPayment(payment, ledger.travelerIds) && (payment.payerId === person.id || payment.payeeId === person.id))
              .map((payment) => (
                <li key={payment.id}>
                  {payment.payerId === person.id
                    ? `Sent to ${nameOf(payment.payeeId)}`
                    : `Received from ${nameOf(payment.payerId)}`}
                  {' · '}{formatMoney(toCents(payment.amount))}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
