"use client";

import React, { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import type { UserProfile } from '../../pageTypes';

export default function BalanceSummary({
  userProfile,
}: {
  userProfile: UserProfile | null;
}) {
  const { participants, cappedBalances, addPayment } = useTrip();
  const [forms, setForms] = useState<{
    [personId: string]: { payeeId: string; amount: string; description: string };
  }>({});
  const [error, setError] = useState('');

  if (!cappedBalances.length) return null;

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
    } catch {
      setError('Failed to add payment. Please try again.');
    }
  };

  const totalSpend = cappedBalances.reduce((s, b) => s + b.shouldHavePaid, 0);

  return (
    <section className="bg-surface-1 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-text">Balances</h2>
        {totalSpend > 0 && (
          <span className="text-xs text-text-3">
            Trip total: {CURRENCY_SYMBOL}{totalSpend.toFixed(2)}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-error/10 border border-error/20 text-error rounded text-sm">
          {error}
        </div>
      )}

      <ul className="space-y-4">
        {cappedBalances.map((b) => {
          const isPositive = b.balance > 0;
          const isNegative = b.balance < 0;
          const isNeutral = Math.abs(b.balance) < 0.01;

          return (
            <li
              key={b.personId}
              className="border-b border-border pb-3 last:border-0"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-text font-medium">{b.name}</span>
                  {b.isCapped && (
                    <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded font-medium">
                      CAP {CURRENCY_SYMBOL}{b.capAmount?.toFixed(0)}
                    </span>
                  )}
                </div>
                <span
                  className={`font-semibold ${
                    isPositive
                      ? 'text-success'
                      : isNegative
                        ? 'text-error'
                        : 'text-text-3'
                  }`}
                >
                  {isPositive && '+'}
                  {CURRENCY_SYMBOL}
                  {Math.abs(b.balance).toFixed(2)}
                  {isNeutral && ' (settled)'}
                </span>
              </div>

              {/* Breakdown line */}
              <div className="text-xs text-text-3 mb-2">
                Paid {CURRENCY_SYMBOL}{b.totalPaid.toFixed(2)} · Owes{' '}
                {CURRENCY_SYMBOL}{b.shouldHavePaid.toFixed(2)}
                {b.isCapped &&
                  b.rawShouldHavePaid !== b.shouldHavePaid && (
                    <span className="text-warning ml-1">
                      (was {CURRENCY_SYMBOL}
                      {b.rawShouldHavePaid.toFixed(2)} before cap)
                    </span>
                  )}
              </div>

              {!isNeutral && (
                <div className="space-y-2 mt-2">
                  <div className="flex gap-2">
                    <Select
                      value={forms[b.personId]?.payeeId || ''}
                      onChange={(e) =>
                        handleChange(b.personId, 'payeeId', e.target.value)
                      }
                      className="flex-1 px-2 py-1"
                    >
                      <option value="">Select recipient...</option>
                      {participants
                        .filter((p) => p.id !== b.personId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Select>
                    <Input
                      value={forms[b.personId]?.amount || ''}
                      onChange={(e) =>
                        handleChange(b.personId, 'amount', e.target.value)
                      }
                      type="number"
                      step="0.01"
                      className="px-2 py-1 w-24"
                      placeholder="Amount"
                    />
                    <Button
                      onClick={() => submit(b.personId)}
                      variant="success"
                      size="sm"
                      className="px-3 py-1"
                      aria-label="Record payment"
                    >
                      Pay
                    </Button>
                  </div>
                  <Input
                    value={forms[b.personId]?.description || ''}
                    onChange={(e) =>
                      handleChange(b.personId, 'description', e.target.value)
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
