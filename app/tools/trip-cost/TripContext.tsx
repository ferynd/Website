"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
} from 'react';
import {
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { tripDoc, tripAuditCol } from './db';
import { uniqueLinkedParticipant } from './utils/payer';
import type {
  Trip,
  TripParticipant,
  Expense,
  Payment,
  AuditEntry,
  ExpenseDraft,
  UserProfile,
  SpendCap,
  OverageSplit,
  DefaultSplit,
} from './pageTypes';
import { buildLedger, type Ledger } from './utils/ledger';
import { draftToExpenseFields, type DraftContext } from './utils/expenseDraft';
import { expenseSaveOriginal } from './utils/expenseSave';
import { validatePayment } from './utils/payment';
import { fromCents } from './utils/money';
import {
  linkParticipantAccount as linkAccount,
  participantForAccount,
  participantIdsFor,
} from './utils/participants';

interface TripContextValue {
  trip: Trip | null;
  participants: TripParticipant[];
  expenses: Expense[];
  payments: Payment[];
  auditEntries: AuditEntry[];
  /** Cents-exact ledger: allocations, caps, balances, problems, settlements. */
  ledger: Ledger;
  addParticipant: (
    name: string,
    authorUid: string,
    userId?: string
  ) => Promise<void>;
  updateParticipant: (id: string, name: string) => Promise<void>;
  /** Admin only (D3): links an existing traveler to a registered account, keeping its id. */
  linkParticipantAccount: (id: string, uid: string) => Promise<void>;
  deleteParticipant: (id: string) => Promise<void>;
  addExpense: (draft: ExpenseDraft) => Promise<void>;
  updateExpense: (id: string, draft: ExpenseDraft, baseline?: Expense) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addPayment: (
    payerId: string,
    payeeId: string,
    amount: number,
    description: string,
    authorUid: string
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  updateSpendCaps: (caps: SpendCap[]) => Promise<void>;
  updateOverageSplit: (split: OverageSplit) => Promise<void>;
  updateDefaultSplit: (split: DefaultSplit) => Promise<void>;
}

const TripContext = createContext<TripContextValue | undefined>(undefined);

export const TripProvider = ({
  selectedTripId,
  userProfile,
  children,
}: {
  selectedTripId: string;
  userProfile: UserProfile | null;
  children: React.ReactNode;
}) => {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    setTrip(null);
    setExpenses([]);
    setPayments([]);
    setAuditEntries([]);
    if (!selectedTripId) return;
    const unsub = onSnapshot(tripDoc(selectedTripId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Omit<Trip, 'id'>;
        setTrip({ id: snap.id, ...data });
        setExpenses(data.expenses || []);
        setPayments(data.payments || []);
      }
    });
    return () => unsub();
  }, [selectedTripId]);

  useEffect(() => {
    setAuditEntries([]);
    if (!selectedTripId || !userProfile?.isAdmin) return;
    const q = query(tripAuditCol(selectedTripId), orderBy('ts', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setAuditEntries(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AuditEntry, 'id'>) }))
      );
    });
    return () => unsub();
  }, [selectedTripId, userProfile]);

  const participants = useMemo(
    () => trip?.participants || [],
    [trip]
  );

  const ledger = useMemo(
    () =>
      buildLedger({
        participants,
        expenses,
        payments,
        spendCaps: trip?.spendCaps,
        overageSplit: trip?.overageSplit,
      }),
    [participants, expenses, payments, trip?.spendCaps, trip?.overageSplit]
  );

  const addParticipant = async (
    name: string,
    authorUid: string,
    userId?: string
  ) => {
    if (!trip) throw new Error('No trip loaded');
    if (!name.trim()) throw new Error('Participant name is required');
    if (userId && participantForAccount(participants, userId)) {
      throw new Error('That account is already a traveler on this trip.');
    }

    const newPart: TripParticipant = {
      id: crypto.randomUUID(),
      name: name.trim(),
      isRegistered: !!userId,
      addedBy: authorUid,
      ...(userId && { userId })
    };

    const updated = [...participants, newPart];
    const participantIds = participantIdsFor(updated);

    await setDoc(
      tripDoc(trip.id),
      { participants: updated, participantIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const updateParticipant = async (id: string, name: string) => {
    if (!trip) throw new Error('No trip loaded');
    if (!name.trim()) throw new Error('Participant name is required');

    const updated = participants.map((p) =>
      p.id === id ? { ...p, name: name.trim() } : p
    );
    const participantIds = participantIdsFor(updated);

    await setDoc(
      tripDoc(trip.id),
      { participants: updated, participantIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const linkParticipantAccount = async (id: string, uid: string) => {
    if (!trip) throw new Error('No trip loaded');
    if (!userProfile?.isAdmin) throw new Error('Only an admin can link accounts.');

    const result = linkAccount(participants, id, uid);
    if (!result.ok) throw new Error(result.message);

    await setDoc(
      tripDoc(trip.id),
      {
        participants: result.participants,
        participantIds: result.participantIds,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) throw new Error('No trip loaded');

    // Deleting a participant used to silently orphan any expense/payment
    // that still referenced them — paid amounts and obligations then just
    // disappeared from balance totals with no indication why (F-089).
    // Block deletion instead until those references are gone.
    const referencedByExpense = expenses.some(
      (e) =>
        Object.prototype.hasOwnProperty.call(e.paidBy, id) ||
        e.splitParticipants.includes(id) ||
        Object.prototype.hasOwnProperty.call(e.manualSplit, id),
    );
    const referencedByPayment = payments.some((p) => p.payerId === id || p.payeeId === id);
    if (referencedByExpense || referencedByPayment) {
      throw new Error(
        'This participant has expenses or payments referencing them. Remove or reassign those first.',
      );
    }

    const updated = participants.filter((p) => p.id !== id);
    const participantIds = participantIdsFor(updated);

    // Also remove any spend cap for this participant
    const updatedCaps = (trip.spendCaps || []).filter(
      (c) => c.participantId !== id
    );

    // Clean up default split
    const updatedDefaultSplit = { ...(trip.defaultSplit || {}) };
    delete updatedDefaultSplit[id];

    await setDoc(
      tripDoc(trip.id),
      {
        participants: updated,
        participantIds,
        spendCaps: updatedCaps,
        defaultSplit: updatedDefaultSplit,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  // Shared by add and edit. A blank payer only defaults to the caller when
  // exactly one participant record is linked to their account; matching on
  // addedBy too could credit the wrong person (F-090).
  const draftContext = (original?: Expense): DraftContext => ({
    travelerIds: participants.map((p) => p.id),
    defaultPayerId: uniqueLinkedParticipant(participants, userProfile?.uid)?.id,
    original,
  });

  const addExpense = async (draft: ExpenseDraft) => {
    if (!trip) throw new Error('No trip loaded');

    const { fields, errors } = draftToExpenseFields(draft, draftContext());
    if (!fields) throw new Error(errors[0].message);

    const expense: Expense = {
      id: crypto.randomUUID(),
      ...fields,
      createdBy: userProfile?.uid || 'unknown',
      createdAt: Timestamp.fromDate(new Date()),
    };

    const updated = [...expenses, expense];
    await setDoc(
      tripDoc(trip.id),
      { expenses: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const updateExpense = async (id: string, draft: ExpenseDraft, baseline?: Expense) => {
    if (!trip) throw new Error('No trip loaded');

    const live = expenses.find((e) => e.id === id);
    if (!live) throw new Error('This expense no longer exists.');

    // Money fields left untouched keep their stored values, so legacy rows
    // stay editable; any changed amount or split must add up exactly (C5).
    // "Save anyway" validates untouched fields against the editor snapshot.
    const { fields, errors } = draftToExpenseFields(
      draft,
      draftContext(expenseSaveOriginal(live, baseline)),
    );
    if (!fields) throw new Error(errors[0].message);

    const updated = expenses.map((e) => (e.id === id ? { ...e, ...fields } : e));

    await setDoc(
      tripDoc(trip.id),
      { expenses: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deleteExpense = async (id: string) => {
    if (!trip) throw new Error('No trip loaded');
    const updated = expenses.filter((e) => e.id !== id);
    await setDoc(
      tripDoc(trip.id),
      { expenses: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const addPayment = async (
    payerId: string,
    payeeId: string,
    amount: number,
    description: string,
    authorUid: string
  ) => {
    if (!trip) throw new Error('No trip loaded');

    const { cents, errors } = validatePayment(
      { payerId, payeeId, amount },
      participants.map((p) => p.id)
    );
    if (cents === null) throw new Error(errors[0].message);

    const payment: Payment = {
      id: crypto.randomUUID(),
      payerId,
      payeeId,
      amount: fromCents(cents),
      description,
      date: new Date().toISOString(),
      createdBy: authorUid,
      createdAt: Timestamp.fromDate(new Date()),
    };

    const updated = [...payments, payment];
    await setDoc(
      tripDoc(trip.id),
      { payments: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deletePayment = async (id: string) => {
    if (!trip) throw new Error('No trip loaded');
    const updated = payments.filter((p) => p.id !== id);
    await setDoc(
      tripDoc(trip.id),
      { payments: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const updateSpendCaps = async (caps: SpendCap[]) => {
    if (!trip) throw new Error('No trip loaded');
    await setDoc(
      tripDoc(trip.id),
      { spendCaps: caps, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const updateOverageSplit = async (split: OverageSplit) => {
    if (!trip) throw new Error('No trip loaded');
    await setDoc(
      tripDoc(trip.id),
      { overageSplit: split, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const updateDefaultSplit = async (split: DefaultSplit) => {
    if (!trip) throw new Error('No trip loaded');
    await setDoc(
      tripDoc(trip.id),
      { defaultSplit: split, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const value: TripContextValue = {
    trip,
    participants,
    expenses,
    payments,
    auditEntries,
    ledger,
    addParticipant,
    updateParticipant,
    linkParticipantAccount,
    deleteParticipant,
    addExpense,
    updateExpense,
    deleteExpense,
    addPayment,
    deletePayment,
    updateSpendCaps,
    updateOverageSplit,
    updateDefaultSplit,
  };

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
};

export const useTrip = () => {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be within TripProvider');
  return ctx;
};
