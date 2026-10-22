"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useTrip } from '../../TripContext';
import ExpenseEditor from './ExpenseEditor';
import SettlementsSection from './SettlementsSection';
import ParticipantsSettingsTab from './ParticipantsSettingsTab';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import TripHeader from './TripHeader';
import TripTabs from './TripTabs';
import LedgerTable from './LedgerTable';
import ExpenseDetailSheet from './ExpenseDetailSheet';
import TravelerDetailSheet from './TravelerDetailSheet';
import { draftToExpenseFields, expenseToDraft, type ExpenseFields } from '../../utils/expenseDraft';
import { expenseRevision } from '../../utils/expenseSave';
import type { Expense, UserProfile } from '../../pageTypes';

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
  const { trip, expenses, participants, deleteExpense, deletePayment, deleteParticipant } = useTrip();
  const [editor, setEditor] = useState<{ original?: Expense; previousIds: string[] } | null>(null);
  const [highlightRequest, setHighlightRequest] = useState<{ previousIds: string[]; fields: ExpenseFields } | null>(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<string | null>(null);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [travelerId, setTravelerId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const activeRequest = useRef(0);

  useEffect(() => {
    if (!highlightRequest) return;
    // The mutation API returns void. Match the successfully added fields against
    // the subsequent snapshot, excluding every expense present when Add opened.
    const added = expenses.find((expense) => {
      if (highlightRequest.previousIds.includes(expense.id) || expense.createdBy !== userProfile?.uid) return false;
      const result = draftToExpenseFields(expenseToDraft(expense), {
        original: expense,
        travelerIds: participants.map((person) => person.id),
      });
      return result.fields && expenseRevision({ ...result.fields, id: '', createdBy: '' }) ===
        expenseRevision({ ...highlightRequest.fields, id: '', createdBy: '' });
    });
    if (added) {
      setHighlightedExpenseId(added.id);
      setHighlightRequest(null);
    }
  }, [expenses, participants, highlightRequest, userProfile?.uid]);

  useEffect(() => {
    if (!highlightedExpenseId) return;
    const timer = window.setTimeout(() => setHighlightedExpenseId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedExpenseId]);

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
      <LedgerTable onExpense={setExpenseId} onTraveler={setTravelerId} highlightedExpenseId={highlightedExpenseId} />
      <SettlementsSection
        userProfile={userProfile}
        onDeletePayment={(id) => openConfirm({ type: 'payment', id })}
      />
    </div>
  );

  const participantContent = (
    <ParticipantsSettingsTab
      userProfile={userProfile}
      onDeleteParticipant={(id) => openConfirm({ type: 'participant', id })}
    />
  );

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-clip bg-surface-2">
      <div className="mx-auto w-full min-w-0 max-w-7xl p-3 sm:p-4">
        <div className="min-w-0 space-y-4">
          <TripHeader
            onBack={onBack}
            onAddExpense={() => setEditor({ previousIds: expenses.map((expense) => expense.id) })}
            onTraveler={setTravelerId}
          />
          <TripTabs expenses={expenseContent} participantsSettings={participantContent} />
        </div>
      </div>
      <ExpenseDetailSheet
        expenseId={expenseId}
        userProfile={userProfile}
        onClose={() => setExpenseId(null)}
        onDelete={(id) => openConfirm({ type: 'expense', id })}
        onEdit={(original) => setEditor({ original, previousIds: [] })}
      />
      {editor && (
        <ExpenseEditor
          key={`${trip.id}-${editor.original?.id ?? 'add'}`}
          original={editor.original}
          userProfile={userProfile}
          onClose={() => setEditor(null)}
          onSaved={(fields) => {
            if (!editor.original) setHighlightRequest({ previousIds: editor.previousIds, fields });
            setEditor(null);
          }}
        />
      )}
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
