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
import { EXPENSE_CATEGORIES } from './constants';
import type {
  Trip,
  TripParticipant,
  Expense,
  Payment,
  AuditEntry,
  Balance,
  CappedBalance,
  ExpenseDraft,
  UserProfile,
  SpendCap,
  OverageSplit,
  DefaultSplit,
} from './pageTypes';
import {
  calculateBalances,
  calculateSettlements,
  applySpendCaps,
} from './utils/calc';

interface TripContextValue {
  trip: Trip | null;
  participants: TripParticipant[];
  expenses: Expense[];
  payments: Payment[];
  auditEntries: AuditEntry[];
  balances: Balance[];
  cappedBalances: CappedBalance[];
  settlements: { from: string; to: string; amount: number }[];
  newExpense: ExpenseDraft;
  setNewExpense: React.Dispatch<React.SetStateAction<ExpenseDraft>>;
  addParticipant: (
    name: string,
    authorUid: string,
    userId?: string
  ) => Promise<void>;
  updateParticipant: (id: string, name: string) => Promise<void>;
  deleteParticipant: (id: string) => Promise<void>;
  addExpense: (draft: ExpenseDraft) => Promise<void>;
  updateExpense: (id: string, draft: ExpenseDraft) => Promise<void>;
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
  const emptyExpenseDraft: ExpenseDraft = {
    category: EXPENSE_CATEGORIES[0],
    description: '',
    totalAmount: '',
    paidBy: {},
    splitType: 'even',
    splitParticipants: [],
    manualSplit: {},
    manualSplitMode: 'amount',
  };
  const [newExpense, setNewExpense] = useState<ExpenseDraft>(emptyExpenseDraft);

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

  const balances = useMemo(
    () => calculateBalances(participants, expenses, payments),
    [participants, expenses, payments]
  );

  const cappedBalances = useMemo(
    () =>
      applySpendCaps(
        balances,
        trip?.spendCaps || [],
        trip?.overageSplit || { type: 'even' }
      ),
    [balances, trip?.spendCaps, trip?.overageSplit]
  );

  const settlements = useMemo(
    () => calculateSettlements(cappedBalances),
    [cappedBalances]
  );

  const addParticipant = async (
    name: string,
    authorUid: string,
    userId?: string
  ) => {
    if (!trip) throw new Error('No trip loaded');
    if (!name.trim()) throw new Error('Participant name is required');

    const newPart: TripParticipant = {
      id: crypto.randomUUID(),
      name: name.trim(),
      isRegistered: !!userId,
      addedBy: authorUid,
      ...(userId && { userId })
    };

    const updated = [...participants, newPart];
    const participantIds = updated.map((p) => p.userId || p.id);

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
    const participantIds = updated.map((p) => p.userId || p.id);

    await setDoc(
      tripDoc(trip.id),
      { participants: updated, participantIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) throw new Error('No trip loaded');

    const updated = participants.filter((p) => p.id !== id);
    const participantIds = updated.map((p) => p.userId || p.id);

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

  const addExpense = async (draft: ExpenseDraft) => {
    if (!trip) throw new Error('No trip loaded');

    const totalAmount = Math.max(0, parseFloat(String(draft.totalAmount || '')));
    if (totalAmount <= 0) throw new Error('Enter an amount greater than 0.');

    // Process who paid
    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }

    const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
    if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
      throw new Error('Payer amounts must sum to the total amount.');
    }

    // Find current user's participant ID
    const currentParticipant = participants.find(
      p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
    );
    const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';

    if (Object.keys(paidBy).length === 0) {
      paidBy[currentParticipantId] = totalAmount;
    }

    // Process split
    const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
    let splitParticipants = Array.isArray(draft.splitParticipants)
      ? draft.splitParticipants.slice()
      : [];
    if (!splitParticipants.length) {
      splitParticipants = (trip.participants || []).map((p) => p.id);
    }

    const manualSplit: Expense['manualSplit'] = {};
    if (splitType === 'manual') {
      const mode = draft.manualSplitMode || 'amount';
      for (const pid of splitParticipants) {
        const v = draft.manualSplit?.[pid]?.value;
        const n = parseFloat(String(v));
        if (!Number.isNaN(n) && n >= 0) {
          manualSplit[pid] = { type: mode, value: n };
        }
      }

      // Validate
      if (mode === 'percent') {
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - 100) > 0.01) {
          throw new Error('Percentage split must sum to 100%.');
        }
      } else {
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - totalAmount) > 0.01) {
          throw new Error('Manual split must sum to total amount.');
        }
      }
    }

    const expense: Expense = {
      id: crypto.randomUUID(),
      category: draft.category,
      description: draft.description.trim(),
      totalAmount,
      paidBy,
      splitType,
      splitParticipants,
      manualSplit,
      createdBy: userProfile?.uid || 'unknown',
      createdAt: Timestamp.fromDate(new Date()),
    };

    const updated = [...expenses, expense];
    await setDoc(
      tripDoc(trip.id),
      { expenses: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );

    setNewExpense(emptyExpenseDraft);
  };

  const updateExpense = async (id: string, draft: ExpenseDraft) => {
    if (!trip) throw new Error('No trip loaded');

    const totalAmount = Math.max(0, parseFloat(String(draft.totalAmount || '')));
    if (totalAmount <= 0) throw new Error('Enter an amount greater than 0.');

    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }

    const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
    if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
      throw new Error('Payer amounts must sum to the total amount.');
    }

    const currentParticipant = participants.find(
      p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
    );
    const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';

    if (Object.keys(paidBy).length === 0) {
      paidBy[currentParticipantId] = totalAmount;
    }

    const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
    let splitParticipants = Array.isArray(draft.splitParticipants)
      ? draft.splitParticipants.slice()
      : [];
    if (!splitParticipants.length) {
      splitParticipants = (trip.participants || []).map((p) => p.id);
    }

    const manualSplit: Expense['manualSplit'] = {};
    if (splitType === 'manual') {
      const mode = draft.manualSplitMode || 'amount';
      for (const pid of splitParticipants) {
        const v = draft.manualSplit?.[pid]?.value;
        const n = parseFloat(String(v));
        if (!Number.isNaN(n) && n >= 0) {
          manualSplit[pid] = { type: mode, value: n };
        }
      }

      if (mode === 'percent') {
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - 100) > 0.01) {
          throw new Error('Percentage split must sum to 100%.');
        }
      } else {
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - totalAmount) > 0.01) {
          throw new Error('Manual split must sum to total amount.');
        }
      }
    }

    const updated = expenses.map((e) =>
      e.id === id
        ? {
            ...e,
            category: draft.category,
            description: draft.description.trim(),
            totalAmount,
            paidBy,
            splitType,
            splitParticipants,
            manualSplit,
          }
        : e
    );

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

    const payment: Payment = {
      id: crypto.randomUUID(),
      payerId,
      payeeId,
      amount,
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
    balances,
    cappedBalances,
    settlements,
    newExpense,
    setNewExpense,
    addParticipant,
    updateParticipant,
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
