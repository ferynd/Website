"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useState } from 'react';
import { useTrip } from '../../TripContext';
import ParticipantsSection from './ParticipantsSection';
import ExpenseForm from './ExpenseForm';
import ExpensesList from './ExpensesList';
import BalanceSummary from './BalanceSummary';
import SettlementSuggestions from './SettlementSuggestions';
import PaymentHistory from './PaymentHistory';
import AuditLog from './AuditLog';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import type { UserProfile } from '../../pageTypes';

export default function TripDetail({
  onBack,
  userProfile,
}: {
  onBack: () => void;
  userProfile: UserProfile | null;
}) {
  const { trip, expenses, payments, auditEntries } = useTrip();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: string;
    id: string;
  } | null>(null);

  if (!trip) return null;

  return (
    <div className="space-y-4 text-gray-800">
      <header className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-blue-600 hover:underline"
        >
          ← Back to trips
        </button>
        <h1 className="text-2xl font-bold">{trip.name}</h1>
        <div className="text-gray-700">
          {expenses.length} expenses · {payments.length} payments
        </div>
      </header>
      <ParticipantsSection userProfile={userProfile} />
      <ExpenseForm userProfile={userProfile} />
      <ExpensesList />
      <BalanceSummary userProfile={userProfile} />
      <SettlementSuggestions />
      <PaymentHistory />
      {userProfile?.isAdmin && (
        <AuditLog
          entries={auditEntries}
          show={showAuditLog}
          onToggle={() => setShowAuditLog((s) => !s)}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          itemType={confirmDelete.type}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            // deletion handled externally
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
