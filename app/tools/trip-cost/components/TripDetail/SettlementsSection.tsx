"use client";

import React, { useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { makeNameOf, settlementPausedMessage } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';
import {
  balanceBreakdownRows,
  paymentDraft,
  paymentHistoryRows,
  paymentPermission,
  type PaymentDraft,
} from '../../utils/settlementView';
import RecordPaymentDialog from './RecordPaymentDialog';

/** A pinned metric column and contained scroll match the expense matrix. */
function BalanceBreakdown() {
  const { ledger, participants } = useTrip();
  const nameOf = makeNameOf(participants);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto" role="region" aria-label="Balance breakdown" tabIndex={0}>
        <table className="isolate w-full min-w-max border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Balance breakdown for every traveler, in expense ledger order</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 w-[9.5rem] min-w-[9.5rem] bg-surface-1 px-3 py-3 text-left sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem]">
                Balance breakdown
              </th>
              {ledger.travelerIds.map((id) => (
                <th key={id} scope="col" className="min-w-[5.5rem] max-w-48 break-words bg-surface-1 px-3 py-3 text-right [overflow-wrap:anywhere]">
                  {nameOf(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {balanceBreakdownRows(ledger).map((row) => (
              <tr key={row.label} className={row.label === 'Remaining' ? 'font-semibold text-text' : 'text-text-2'}>
                <th scope="row" className="sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] border-t border-border bg-surface-1 px-3 py-3 text-left sm:w-56 sm:min-w-[14rem] lg:w-72 lg:min-w-[18rem]">
                  {row.label}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.travelerId} className="min-w-[5.5rem] border-t border-border px-3 py-3 text-right tabular-nums">
                    {cell.label}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ledger.travelerIds.length > 1 && (
        <p className="flex items-center gap-1 px-3 py-2 text-xs text-text-3">
          Scroll for more travelers <ArrowRight size={14} aria-hidden="true" />
        </p>
      )}
    </div>
  );
}

/** A shared, wrapping direction label for suggestions and recorded payments. */
function PaymentDirection({ from, to, amount }: { from: string; to: string; amount: string }) {
  return (
    <p className="break-words text-text [overflow-wrap:anywhere]">
      {from} <span className="sr-only">to</span>
      <ArrowRight className="inline" size={16} aria-hidden="true" /> {to} ·{' '}
      <span className="tabular-nums">{amount}</span>
    </p>
  );
}

export default function SettlementsSection({ userProfile, onDeletePayment }: {
  userProfile: UserProfile | null;
  onDeletePayment: (id: string) => void;
}) {
  const { ledger, participants, payments } = useTrip();
  const [dialog, setDialog] = useState<PaymentDraft | null>(null);
  const permissionId = useId();
  const permission = paymentPermission(userProfile, participants);
  const nameOf = makeNameOf(participants);
  const { settlements, paused } = ledger.settlement;

  return (
    <section className="min-w-0 space-y-5 rounded-lg bg-surface-1 p-4 shadow">
      <h2 className="text-xl font-semibold text-text">Settlements</h2>
      <BalanceBreakdown />
      <section className="min-w-0 space-y-3" aria-label="Settlement suggestions">
        <h3 className="font-semibold text-text">Suggestions</h3>
        {paused ? (
          <p className="text-sm text-error">{settlementPausedMessage(paused, ledger.unallocatedCents)}</p>
        ) : settlements.length === 0 ? (
          <p className="text-sm text-text-2">Everyone is settled.</p>
        ) : (
          <ul className="space-y-2">
            {settlements.map((suggestion, index) => {
              const initial = paymentDraft(participants, userProfile, suggestion);
              const allowed = paymentPermission(userProfile, participants, initial);
              const reasonId = `${permissionId}-${index}`;
              return (
                <li key={`${suggestion.from}-${suggestion.to}`} className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
                  <div className="min-w-0 flex-1">
                    <PaymentDirection
                      from={nameOf(suggestion.from)}
                      to={nameOf(suggestion.to)}
                      amount={formatMoney(suggestion.cents)}
                    />
                    {!allowed.allowed && (
                      <p id={reasonId} className="mt-1 text-sm text-text-3">{allowed.reason}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={!allowed.allowed}
                    aria-describedby={!allowed.allowed ? reasonId : undefined}
                    onClick={() => setDialog(initial)}
                  >
                    Record
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          variant="success"
          disabled={!permission.allowed}
          aria-describedby={permissionId}
          onClick={() => setDialog(paymentDraft(participants, userProfile))}
        >
          Record payment
        </Button>
        <p id={permissionId} className="break-words text-sm text-text-3 [overflow-wrap:anywhere]">
          {permission.reason}
        </p>
      </section>
      <section className="min-w-0 space-y-3" aria-label="Payment history">
        <h3 className="font-semibold text-text">Payment history</h3>
        {payments.length === 0 && <p className="text-sm text-text-3">No reimbursements recorded.</p>}
        <ul className="divide-y divide-border">
          {paymentHistoryRows(payments, participants).map((payment) => (
            <li key={payment.id} className="flex min-w-0 items-start gap-3 py-3">
              <div className="min-w-0 flex-1 space-y-1 break-words text-sm [overflow-wrap:anywhere]">
                <PaymentDirection from={payment.from} to={payment.to} amount={payment.amount} />
                {payment.note && <p className="text-text-2">{payment.note}</p>}
                <p className="text-text-3">
                  <time dateTime={payment.dateTime}>{payment.date}</time>
                  {payment.recordedBy && ` · Recorded by ${payment.recordedBy}`}
                </p>
              </div>
              {userProfile?.isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-error"
                  aria-label={`Delete payment from ${payment.from} to ${payment.to}`}
                  onClick={() => onDeletePayment(payment.id)}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {dialog && (
        <RecordPaymentDialog initial={dialog} userProfile={userProfile} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
