"use client";

// ===============================
// CONFIGURATION
// ===============================
// None - provider consumes selectedTripId from props

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
  ExpenseDraft,
  UserProfile,
} from './pageTypes';
import { calculateBalances, calculateSettlements } from './utils/calc';

interface TripContextValue {
  trip: Trip | null;
  participants: TripParticipant[];
  expenses: Expense[];
  payments: Payment[];
  auditEntries: AuditEntry[];
  balances: Balance[];
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
  updateExpense: (
    id: string,
    draft: ExpenseDraft
  ) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addPayment: (
    payerId: string,
    payeeId: string,
    amount: number,
    description: string,
    authorUid: string
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
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
  const settlements = useMemo(
    () => calculateSettlements(balances),
    [balances]
  );

  const addParticipant = async (
    name: string,
    authorUid: string,
    userId?: string
  ) => {
    if (!trip) return;
    const newPart: TripParticipant = {
      id: crypto.randomUUID(),
      name,
      userId,
      isRegistered: !!userId,
      addedBy: authorUid,
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
    if (!trip) return;
    const updated = participants.map((p) =>
      p.id === id ? { ...p, name } : p
    );
    const participantIds = updated.map((p) => p.userId || p.id);
    await setDoc(
      tripDoc(trip.id),
      { participants: updated, participantIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) return;
    const updated = participants.filter((p) => p.id !== id);
    const participantIds = updated.map((p) => p.userId || p.id);
    await setDoc(
      tripDoc(trip.id),
      { participants: updated, participantIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const addExpense = async (draft: ExpenseDraft) => {
    if (!trip) return;
    const totalAmount = Math.max(
      0,
      parseFloat(String(draft.totalAmount || ''))
    );
    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }
    const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
    let splitParticipants = Array.isArray(draft.splitParticipants)
      ? draft.splitParticipants.slice()
      : [];
    if (!splitParticipants.length)
      splitParticipants = (trip?.participants || []).map((p) => p.id);
    const manualSplit: Expense['manualSplit'] = {};
    if (splitType === 'manual') {
      for (const pid of splitParticipants) {
        const v = draft.manualSplit?.[pid]?.value;
        const n = parseFloat(String(v));
        if (!Number.isNaN(n) && n >= 0) {
          manualSplit[pid] = { type: 'amount', value: n };
        }
      }
    }
    if (totalAmount <= 0) throw new Error('Enter an amount greater than 0.');
    const currentUserId = userProfile?.uid ?? 'unknown';
    if (Object.keys(paidBy).length === 0) {
      paidBy[currentUserId] = totalAmount;
    }
    if (splitType === 'manual') {
      const sum = Object.values(manualSplit).reduce(
        (a, s) => a + s.value,
        0
      );
      if (Math.abs(sum - totalAmount) > 0.01) {
        throw new Error('Manual split must sum to total amount.');
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
      createdAt: serverTimestamp() as Timestamp,
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
    if (!trip) return;
    const totalAmount = Math.max(
      0,
      parseFloat(String(draft.totalAmount || ''))
    );
    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }
    const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
    let splitParticipants = Array.isArray(draft.splitParticipants)
      ? draft.splitParticipants.slice()
      : [];
    if (!splitParticipants.length)
      splitParticipants = (trip.participants || []).map((p) => p.id);
    const manualSplit: Expense['manualSplit'] = {};
    if (splitType === 'manual') {
      for (const pid of splitParticipants) {
        const v = draft.manualSplit?.[pid]?.value;
        const n = parseFloat(String(v));
        if (!Number.isNaN(n) && n >= 0) {
          manualSplit[pid] = { type: 'amount', value: n };
        }
      }
      const sum = Object.values(manualSplit).reduce(
        (a, s) => a + s.value,
        0
      );
      if (Math.abs(sum - totalAmount) > 0.01) {
        throw new Error('Manual split must sum to total amount.');
      }
    }
    if (totalAmount <= 0) throw new Error('Enter an amount greater than 0.');
    const currentUserId = userProfile?.uid ?? 'unknown';
    if (Object.keys(paidBy).length === 0) {
      paidBy[currentUserId] = totalAmount;
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
    if (!trip) return;
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
    if (!trip) return;
    const payment: Payment = {
      id: crypto.randomUUID(),
      payerId,
      payeeId,
      amount,
      description,
      date: new Date().toISOString(),
      createdBy: authorUid,
      createdAt: serverTimestamp() as Timestamp,
    };
    const updated = [...payments, payment];
    await setDoc(
      tripDoc(trip.id),
      { payments: updated, updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  const deletePayment = async (id: string) => {
    if (!trip) return;
    const updated = payments.filter((p) => p.id !== id);
    await setDoc(
      tripDoc(trip.id),
      { payments: updated, updatedAt: serverTimestamp() },
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
  };

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
};

export const useTrip = () => {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be within TripProvider');
  return ctx;
};

