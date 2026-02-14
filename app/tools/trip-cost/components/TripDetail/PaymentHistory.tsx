"use client";

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
    <section className="bg-surface-1 rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-2 text-text">Payments</h2>
      <ul className="space-y-2 text-text">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex items-center p-2 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <span className="flex-1">
              <span className="font-medium">{name(p.payerId)}</span>
              <span className="text-text-3 mx-1">paid</span>
              <span className="font-medium">{name(p.payeeId)}</span>
              <span className="ml-2 font-semibold">
                {CURRENCY_SYMBOL}{p.amount.toFixed(2)}
              </span>
              {p.description && (
                <span className="text-text-3 text-sm ml-2">
                  — {p.description}
                </span>
              )}
              <span className="text-text-3 text-sm ml-2">
                ({new Date(p.date).toLocaleDateString()})
              </span>
            </span>
            {userProfile?.isAdmin && (
              <Button
                onClick={() => onDeletePayment(p.id)}
                variant="ghost"
                size="sm"
                className="text-error hover:text-error/90 text-xs ml-2 p-0 h-auto"
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
