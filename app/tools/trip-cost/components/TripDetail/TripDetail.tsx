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
import Button from '@/components/Button';

export default function TripDetail({
  onBack,
  userProfile,
}: {
  onBack: () => void;
  userProfile: UserProfile | null;
}) {
  const {
    trip,
    expenses,
    payments,
    auditEntries,
    deleteExpense,
    deletePayment,
    deleteParticipant,
  } = useTrip();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: string;
    id: string;
  } | null>(null);

  if (!trip) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading trip details...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4">
        <div className="space-y-4">
          {/* Header */}
          <header className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <Button
                onClick={onBack}
                variant="ghost"
                size="sm"
                className="text-blue-600 hover:underline p-0 h-auto"
              >
                ← Back to trips
              </Button>
              <h1 className="text-2xl font-bold text-gray-800">{trip.name}</h1>
              <div className="text-gray-600 text-sm">
                {expenses.length} expense{expenses.length !== 1 ? 's' : ''} · {payments.length} payment{payments.length !== 1 ? 's' : ''}
              </div>
            </div>
          </header>

          {/* Main Content Grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <ParticipantsSection
                userProfile={userProfile}
                onDeleteParticipant={(id) =>
                  setConfirmDelete({ type: 'participant', id })
                }
              />
              <ExpenseForm />
            </div>
            
            <div className="space-y-4">
              <BalanceSummary userProfile={userProfile} />
              <SettlementSuggestions />
            </div>
          </div>

          {/* Full Width Sections */}
          <ExpensesList
            userProfile={userProfile}
            onDeleteExpense={(id) => setConfirmDelete({ type: 'expense', id })}
          />
          
          <PaymentHistory
            userProfile={userProfile}
            onDeletePayment={(id) => setConfirmDelete({ type: 'payment', id })}
          />
          
          {userProfile?.isAdmin && (
            <AuditLog
              entries={auditEntries}
              show={showAuditLog}
              onToggle={() => setShowAuditLog((s) => !s)}
            />
          )}
        </div>

        {/* Modals */}
        {confirmDelete && (
          <ConfirmDeleteModal
            itemType={confirmDelete.type}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => {
              if (confirmDelete.type === 'expense') {
                deleteExpense(confirmDelete.id);
              } else if (confirmDelete.type === 'payment') {
                deletePayment(confirmDelete.id);
              } else if (confirmDelete.type === 'participant') {
                deleteParticipant(confirmDelete.id);
              }
              setConfirmDelete(null);
            }}
          />
        )}
      </div>
    </div>
  );
}