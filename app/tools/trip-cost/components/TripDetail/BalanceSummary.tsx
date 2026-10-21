"use client";

import React, { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { balanceStatus } from '../../utils/ledgerLabels';
import { formatMoney } from '../../utils/money';
import LedgerProblems from './LedgerProblems';

export default function BalanceSummary({
  userProfile,
}: {
  userProfile: UserProfile | null;
}) {
  const { participants, ledger, addPayment } = useTrip();
  const [forms, setForms] = useState<{
    [personId: string]: { payeeId: string; amount: string; description: string };
  }>({});
  const [error, setError] = useState('');

  if (!participants.length) return null;

  const handleChange = (
    id: string,
    field: 'payeeId' | 'amount' | 'description',
    value: string
  ) => {
    setForms((f) => ({ ...f, [id]: { ...f[id], [field]: value } }));
  };

  const submit = async (id: string) => {
    const form = forms[id];
    if (!userProfile || !form?.payeeId || !form.amount) return;

    setError('');
    try {
      await addPayment(
        id,
        form.payeeId,
        Number(form.amount),
        form.description || '',
        userProfile.uid
      );
      setForms((f) => ({
        ...f,
        [id]: { payeeId: '', amount: '', description: '' },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment. Please try again.');
    }
  };

  // Trip total is actual spending (sum of expense totals); caps and
  // reimbursements only move responsibility between travelers (C2).
  const totalSpend = ledger.totalSpendingCents;

  return (
    <section className="bg-surface-1 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-text">Balances</h2>
        {totalSpend > 0 && (
          <span className="text-xs text-text-3">
            Trip total: {formatMoney(totalSpend)}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-error/10 border border-error/20 text-error rounded text-sm">
          {error}
        </div>
      )}

      <LedgerProblems />

      <ul className="space-y-4">
        {participants.map((p) => {
          const remaining = ledger.remaining[p.id] ?? 0;
          const status = balanceStatus(remaining);
          const isNeutral = status.kind === 'settled';
          const subtotal = ledger.subtotals[p.id] ?? 0;
          const final = ledger.final[p.id] ?? 0;
          const sent = ledger.reimbursementsSent[p.id] ?? 0;
          const received = ledger.reimbursementsReceived[p.id] ?? 0;
          const capCents = ledger.caps.capCents[p.id];
          const isCapped = ledger.caps.cappedIds.includes(p.id);

          return (
            <li
              key={p.id}
              className="border-b border-border pb-3 last:border-0"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-text font-medium">{p.name}</span>
                  {isCapped && capCents !== undefined && (
                    <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded font-medium">
                      CAP {formatMoney(capCents, { compact: true })}
                    </span>
                  )}
                </div>
                <span
                  className={`font-semibold ${
                    status.kind === 'is-owed'
                      ? 'text-success'
                      : status.kind === 'owes'
                        ? 'text-error'
                        : 'text-text-3'
                  }`}
                >
                  {status.label}
                </span>
              </div>

              {/* Breakdown line */}
              <div className="text-xs text-text-3 mb-2">
                Paid for purchases {formatMoney(ledger.paid[p.id] ?? 0)} · Responsible for{' '}
                {formatMoney(final)}
                {final !== subtotal && (
                  <span className="text-warning ml-1">
                    (share {formatMoney(subtotal)} before caps)
                  </span>
                )}
                {(sent > 0 || received > 0) && (
                  <>
                    {' '}· Reimbursements sent {formatMoney(sent)} · received{' '}
                    {formatMoney(received)}
                  </>
                )}
              </div>

              {!isNeutral && (
                <div className="space-y-2 mt-2">
                  <div className="flex gap-2">
                    <Select
                      value={forms[p.id]?.payeeId || ''}
                      onChange={(e) =>
                        handleChange(p.id, 'payeeId', e.target.value)
                      }
                      className="flex-1 px-2 py-1"
                    >
                      <option value="">Select recipient...</option>
                      {participants
                        .filter((other) => other.id !== p.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </Select>
                    <Input
                      value={forms[p.id]?.amount || ''}
                      onChange={(e) =>
                        handleChange(p.id, 'amount', e.target.value)
                      }
                      type="number"
                      step="0.01"
                      className="px-2 py-1 w-24"
                      placeholder="Amount"
                    />
                    <Button
                      onClick={() => submit(p.id)}
                      variant="success"
                      size="sm"
                      className="px-3 py-1"
                      aria-label="Record payment"
                    >
                      Pay
                    </Button>
                  </div>
                  <Input
                    value={forms[p.id]?.description || ''}
                    onChange={(e) =>
                      handleChange(p.id, 'description', e.target.value)
                    }
                    className="px-2 py-1 w-full text-sm"
                    placeholder="Note (e.g. Venmo, cash)"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
