"use client";

import React, { useRef, useState } from 'react';
import { useTrip } from '../../TripContext';
import ParticipantsSection from './ParticipantsSection';
import ExpenseForm from './ExpenseForm';
import BalanceSummary from './BalanceSummary';
import SettlementSuggestions from './SettlementSuggestions';
import PaymentHistory from './PaymentHistory';
import AuditLog from './AuditLog';
import TripSettings from './TripSettings';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import Dialog from '../ui/Dialog';
import TripHeader from './TripHeader';
import TripTabs from './TripTabs';
import LedgerTable from './LedgerTable';
import ExpenseDetailSheet from './ExpenseDetailSheet';
import TravelerDetailSheet from './TravelerDetailSheet';
import type { UserProfile } from '../../pageTypes';

interface TripDetailProps {
  onBack: () => void;
  userProfile: UserProfile | null;
}

interface DeleteTarget {
  type: 'expense' | 'payment' | 'participant';
  id: string;
}

/** Trip Cost detail page with the ledger and settings split into two tabs. */
export default function TripDetail({ onBack, userProfile }: TripDetailProps) {
  const { trip, auditEntries, deleteExpense, deletePayment, deleteParticipant } = useTrip();
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [travelerId, setTravelerId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const activeRequest = useRef(0);

  const openConfirm = (target: DeleteTarget) => {
    activeRequest.current += 1;
    setDeleteError(null);
    setDeleteBusy(false);
    setConfirmDelete(target);
  };

  const closeConfirm = () => {
    // Invalidates an in-flight request so a late response cannot close a newer dialog.
    activeRequest.current += 1;
    setConfirmDelete(null);
    setDeleteError(null);
    setDeleteBusy(false);
  };

  const runConfirmedDelete = async () => {
    if (!confirmDelete || deleteBusy) return;
    const target = confirmDelete;
    const request = activeRequest.current;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (target.type === 'expense') await deleteExpense(target.id);
      else if (target.type === 'payment') await deletePayment(target.id);
      else await deleteParticipant(target.id);

      // The confirmation stays open until the awaited delete succeeds; expense sheets then close.
      if (activeRequest.current === request) {
        closeConfirm();
        setExpenseId(null);
      }
    } catch (error) {
      if (activeRequest.current !== request) return;
      setDeleteError(error instanceof Error ? error.message : 'Delete failed. Please try again.');
      setDeleteBusy(false);
    }
  };

  if (!trip) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2">
        <div className="text-text-3">Loading trip details...</div>
      </div>
    );
  }

  const expenseContent = (
    <div className="min-w-0 space-y-4">
      <LedgerTable onExpense={setExpenseId} onTraveler={setTravelerId} />
      <BalanceSummary userProfile={userProfile} />
      <SettlementSuggestions />
      <PaymentHistory
        userProfile={userProfile}
        onDeletePayment={(id) => openConfirm({ type: 'payment', id })}
      />
    </div>
  );

  const participantContent = (
    <>
      <ParticipantsSection
        userProfile={userProfile}
        onDeleteParticipant={(id) => openConfirm({ type: 'participant', id })}
      />
      <TripSettings userProfile={userProfile} />
      {userProfile?.isAdmin && (
        <AuditLog
          entries={auditEntries}
          show={showAuditLog}
          onToggle={() => setShowAuditLog((shown) => !shown)}
        />
      )}
    </>
  );

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-clip bg-surface-2">
      <div className="mx-auto w-full min-w-0 max-w-7xl p-3 sm:p-4">
        <div className="min-w-0 space-y-4">
          <TripHeader
            onBack={onBack}
            onAddExpense={() => setAddOpen(true)}
            onTraveler={setTravelerId}
          />
          <TripTabs expenses={expenseContent} participantsSettings={participantContent} />
        </div>
      </div>
      <Dialog open={addOpen} title="Add expense" dismissible={!addBusy} onClose={() => setAddOpen(false)}>
        <ExpenseForm onBusyChange={setAddBusy} onSaved={() => setAddOpen(false)} onCancel={() => setAddOpen(false)} />
      </Dialog>
      <ExpenseDetailSheet
        expenseId={expenseId}
        userProfile={userProfile}
        onClose={() => setExpenseId(null)}
        onDelete={(id) => openConfirm({ type: 'expense', id })}
      />
      <TravelerDetailSheet travelerId={travelerId} onClose={() => setTravelerId(null)} />
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
  );
}
