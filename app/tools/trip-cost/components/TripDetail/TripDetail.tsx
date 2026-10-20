"use client";

import React, { useRef, useState } from 'react';
import { useTrip } from '../../TripContext';
import ParticipantsSection from './ParticipantsSection';
import ExpenseForm from './ExpenseForm';
import ExpensesList from './ExpensesList';
import BalanceSummary from './BalanceSummary';
import SettlementSuggestions from './SettlementSuggestions';
import PaymentHistory from './PaymentHistory';
import AuditLog from './AuditLog';
import TripSettings from './TripSettings';
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Identifies the modal currently on screen, so a deletion that settles
  // after the user cancelled (and maybe opened another confirmation) never
  // closes or annotates the newer modal.
  const activeRequest = useRef(0);
  const openConfirm = (next: { type: string; id: string }) => {
    activeRequest.current += 1;
    setDeleteError(null);
    setDeleteBusy(false);
    setConfirmDelete(next);
  };
  const closeConfirm = () => {
    activeRequest.current += 1;
    setConfirmDelete(null);
    setDeleteError(null);
    setDeleteBusy(false);
  };
  // Await the deletion so a rejection (e.g. a participant still referenced by
  // expenses/payments) is shown in the modal instead of being dropped as an
  // unhandled promise rejection while the modal silently closes.
  const runConfirmedDelete = async () => {
    if (!confirmDelete || deleteBusy) return;
    const target = confirmDelete;
    const request = activeRequest.current;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (target.type === 'expense') {
        await deleteExpense(target.id);
      } else if (target.type === 'payment') {
        await deletePayment(target.id);
      } else if (target.type === 'participant') {
        await deleteParticipant(target.id);
      }
      if (activeRequest.current === request) closeConfirm();
    } catch (error) {
      if (activeRequest.current !== request) return;
      setDeleteError(error instanceof Error ? error.message : 'Delete failed. Please try again.');
      setDeleteBusy(false);
    }
  };

  if (!trip) {
    return (
      <div className="min-h-screen bg-surface-2 flex items-center justify-center">
        <div className="text-text-3">Loading trip details...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-2">
      <div className="max-w-7xl mx-auto p-4">
        <div className="space-y-4">
          {/* Header */}
          <header className="bg-surface-1 rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <Button
                onClick={onBack}
                variant="ghost"
                size="sm"
                className="text-accent hover:underline p-0 h-auto"
              >
                ← Back to trips
              </Button>
              <h1 className="text-2xl font-bold text-text">{trip.name}</h1>
              <div className="text-text-3 text-sm">
                {expenses.length} expense{expenses.length !== 1 ? 's' : ''} ·{' '}
                {payments.length} payment{payments.length !== 1 ? 's' : ''}
              </div>
            </div>
          </header>

          {/* Main Content Grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <ParticipantsSection
                userProfile={userProfile}
                onDeleteParticipant={(id) =>
                  openConfirm({ type: 'participant', id })
                }
              />
              <ExpenseForm />
            </div>

            <div className="space-y-4">
              <BalanceSummary userProfile={userProfile} />
              <SettlementSuggestions />
            </div>
          </div>

          {/* Trip Settings (admin only) */}
          <TripSettings userProfile={userProfile} />

          {/* Full Width Sections */}
          <ExpensesList
            userProfile={userProfile}
            onDeleteExpense={(id) =>
              openConfirm({ type: 'expense', id })
            }
          />

          <PaymentHistory
            userProfile={userProfile}
            onDeletePayment={(id) =>
              openConfirm({ type: 'payment', id })
            }
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
            onCancel={closeConfirm}
            onConfirm={() => { void runConfirmedDelete(); }}
            error={deleteError}
            busy={deleteBusy}
          />
        )}
      </div>
    </div>
  );
}
