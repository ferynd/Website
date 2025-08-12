"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import Button from '@/components/Button';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import type { UserProfile } from '../../pageTypes';

export default function PaymentHistory({
  userProfile,
  onDeletePayment,
}: {
  userProfile: UserProfile | null;
  onDeletePayment: (id: string) => void;
}) {
  const { payments, participants } = useTrip();
  if (!payments.length) return null;
  const name = (id: string) =>
    participants.find((p) => p.id === id)?.name || 'Unknown';
  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Payments</h2>
      <ul className="space-y-1 text-gray-800">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center">
            <span className="flex-1">
              {name(p.payerId)} paid {name(p.payeeId)} {CURRENCY_SYMBOL}
              {p.amount.toFixed(2)}{' '}
              <span className="text-gray-600 text-sm ml-2">
                ({new Date(p.date).toLocaleDateString()})
              </span>
            </span>
            {userProfile?.isAdmin && (
              <Button
                onClick={() => onDeletePayment(p.id)}
                variant="ghost"
                size="sm"
                className="text-red-600 text-xs ml-2 p-0 h-auto"
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
