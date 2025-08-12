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
    if (!trip) {
      throw new Error('No trip loaded');
    }
    
    if (!name.trim()) {
      throw new Error('Participant name is required');
    }

    try {
      // ===== FIX: Remove undefined values for Firestore =====
      const newPart: TripParticipant = {
        id: crypto.randomUUID(),
        name: name.trim(),
        isRegistered: !!userId,
        addedBy: authorUid,
        // Only include userId if it's defined (Firestore doesn't allow undefined)
        ...(userId && { userId })
      };

      const updated = [...participants, newPart];
      
      // Create participantIds array - use userId if available, otherwise use participant id
      const participantIds = updated.map((p) => p.userId || p.id);
      
      console.log('[addParticipant] Saving participant:', newPart);
      console.log('[addParticipant] Updated participantIds:', participantIds);

      await setDoc(
        tripDoc(trip.id),
        { 
          participants: updated, 
          participantIds, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );

      console.log('[addParticipant] Successfully added participant');
    } catch (error) {
      console.error('[addParticipant] Firebase error:', error);
      throw new Error('Failed to add participant. Please try again.');
    }
  };

  const updateParticipant = async (id: string, name: string) => {
    if (!trip) return;
    
    if (!name.trim()) {
      throw new Error('Participant name is required');
    }

    try {
      const updated = participants.map((p) =>
        p.id === id ? { ...p, name: name.trim() } : p
      );
      const participantIds = updated.map((p) => p.userId || p.id);
      
      await setDoc(
        tripDoc(trip.id),
        { participants: updated, participantIds, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.error('[updateParticipant] Error:', error);
      throw new Error('Failed to update participant');
    }
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) return;
    
    try {
      const updated = participants.filter((p) => p.id !== id);
      const participantIds = updated.map((p) => p.userId || p.id);
      
      await setDoc(
        tripDoc(trip.id),
        { participants: updated, participantIds, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.error('[deleteParticipant] Error:', error);
      throw new Error('Failed to delete participant');
    }
  };

  const addExpense = async (draft: ExpenseDraft) => {
  if (!trip) return;
  
  // Parse and validate the total amount
  const totalAmount = Math.max(
    0,
    parseFloat(String(draft.totalAmount || ''))
  );
  
  // Process who paid
  const paidBy: Record<string, number> = {};
  for (const [pid, val] of Object.entries(draft.paidBy || {})) {
    const n = parseFloat(String(val));
    if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
  }
  
  // Validate payer amounts
  const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
  if (sumPaid === 0) {
    // Will be handled below by defaulting to current user
  } else if (Math.abs(sumPaid - totalAmount) > 0.01) {
    throw new Error('Payer amounts must sum to the total amount.');
  }
  
  // Process split type
  const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
  let splitParticipants = Array.isArray(draft.splitParticipants)
    ? draft.splitParticipants.slice()
    : [];
  if (!splitParticipants.length)
    splitParticipants = (trip?.participants || []).map((p) => p.id);
  
  // Process manual split amounts
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
  
  // Validate total amount
  if (totalAmount <= 0) throw new Error('Enter an amount greater than 0.');
  
  // ===== FIX: Find the current user's participant ID consistently =====
  const currentParticipant = participants.find(
    p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
  );
  const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';
  
  // If no one specified as payer, default to current user's participant ID
  if (Object.keys(paidBy).length === 0) {
    paidBy[currentParticipantId] = totalAmount;
  }
  
  // Validate manual split sums to total
  if (splitType === 'manual') {
    const sum = Object.values(manualSplit).reduce(
      (a, s) => a + s.value,
      0
    );
    if (Math.abs(sum - totalAmount) > 0.01) {
      throw new Error('Manual split must sum to total amount.');
    }
  }
  
  // Create the expense object
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
  
  // Save to Firebase
  const updated = [...expenses, expense];
  await setDoc(
    tripDoc(trip.id),
    { expenses: updated, updatedAt: serverTimestamp() },
    { merge: true }
  );
  
  // Reset the form
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
    const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
    if (sumPaid === 0) {
      // already handled below by defaulting to current user
    } else if (Math.abs(sumPaid - totalAmount) > 0.01) {
      throw new Error('Payer amounts must sum to the total amount.');
    }
    
    // ===== FIX: Use participant ID consistently like in addExpense =====
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