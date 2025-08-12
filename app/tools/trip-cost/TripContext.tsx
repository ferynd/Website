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
      console.error('[addParticipant] No trip selected');
      return;
    }
    
    // Create new participant with all required fields
    const newPart: TripParticipant = {
      id: crypto.randomUUID(),
      name: name.trim(),
      userId: userId, 
      isRegistered: !!userId,
      addedBy: authorUid,
    };
    
    // Update participants array
    const updated = [...participants, newPart];
    
    // Create participantIds array (use userId if available, otherwise use id)
    const participantIds = updated.map((p) => p.userId || p.id);
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          participants: updated, 
          participantIds, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[addParticipant] Firebase error:', error);
      throw new Error('Failed to add participant. Please try again.');
    }
  };

  const updateParticipant = async (id: string, name: string) => {
    if (!trip) {
      console.error('[updateParticipant] No trip selected');
      return;
    }
    
    const updated = participants.map((p) =>
      p.id === id ? { ...p, name: name.trim() } : p
    );
    const participantIds = updated.map((p) => p.userId || p.id);
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          participants: updated, 
          participantIds, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[updateParticipant] Firebase error:', error);
      throw new Error('Failed to update participant. Please try again.');
    }
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) {
      console.error('[deleteParticipant] No trip selected');
      return;
    }
    
    const updated = participants.filter((p) => p.id !== id);
    const participantIds = updated.map((p) => p.userId || p.id);
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          participants: updated, 
          participantIds, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[deleteParticipant] Firebase error:', error);
      throw new Error('Failed to delete participant. Please try again.');
    }
  };

  const addExpense = async (draft: ExpenseDraft) => {
    if (!trip) {
      console.error('[addExpense] No trip selected');
      return;
    }
    
    // Parse and validate the total amount
    const totalAmount = Math.max(
      0,
      parseFloat(String(draft.totalAmount || ''))
    );
    
    if (totalAmount <= 0) {
      throw new Error('Enter an amount greater than 0.');
    }
    
    // Process who paid
    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }
    
    // Validate payer amounts
    const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
    if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
      throw new Error('Payer amounts must sum to the total amount.');
    }
    
    // Process split type
    const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
    let splitParticipants = Array.isArray(draft.splitParticipants)
      ? draft.splitParticipants.slice()
      : [];
    if (!splitParticipants.length) {
      splitParticipants = participants.map((p) => p.id);
    }
    
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
      
      // Validate manual split sums to total
      const sum = Object.values(manualSplit).reduce(
        (a, s) => a + s.value,
        0
      );
      if (Math.abs(sum - totalAmount) > 0.01) {
        throw new Error('Manual split must sum to total amount.');
      }
    }
    
    // Find the current user's participant ID (not their Firebase UID)
    const currentParticipant = participants.find(
      p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
    );
    const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';
    
    // If no one specified as payer, default to current user's participant ID
    if (Object.keys(paidBy).length === 0) {
      paidBy[currentParticipantId] = totalAmount;
    }
    
    // Create the expense object with a regular timestamp (not serverTimestamp)
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
      createdAt: Timestamp.now(), // Use Timestamp.now() instead of serverTimestamp()
    };
    
    // Save to Firebase
    const updated = [...expenses, expense];
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          expenses: updated, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
      
      // Reset the form
      setNewExpense(emptyExpenseDraft);
    } catch (error) {
      console.error('[addExpense] Firebase error:', error);
      throw new Error('Failed to add expense. Please try again.');
    }
  };

  const updateExpense = async (id: string, draft: ExpenseDraft) => {
    if (!trip) {
      console.error('[updateExpense] No trip selected');
      return;
    }
    
    const totalAmount = Math.max(
      0,
      parseFloat(String(draft.totalAmount || ''))
    );
    
    if (totalAmount <= 0) {
      throw new Error('Enter an amount greater than 0.');
    }
    
    const paidBy: Record<string, number> = {};
    for (const [pid, val] of Object.entries(draft.paidBy || {})) {
      const n = parseFloat(String(val));
      if (!Number.isNaN(n) && n > 0) paidBy[pid] = n;
    }
    
    const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
    if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
      throw new Error('Payer amounts must sum to the total amount.');
    }
    
    // Find the current user's participant ID
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
      splitParticipants = participants.map((p) => p.id);
    }
    
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
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          expenses: updated, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[updateExpense] Firebase error:', error);
      throw new Error('Failed to update expense. Please try again.');
    }
  };

  const deleteExpense = async (id: string) => {
    if (!trip) {
      console.error('[deleteExpense] No trip selected');
      return;
    }
    
    const updated = expenses.filter((e) => e.id !== id);
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          expenses: updated, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[deleteExpense] Firebase error:', error);
      throw new Error('Failed to delete expense. Please try again.');
    }
  };

  const addPayment = async (
    payerId: string,
    payeeId: string,
    amount: number,
    description: string,
    authorUid: string
  ) => {
    if (!trip) {
      console.error('[addPayment] No trip selected');
      return;
    }
    
    // Create payment with regular timestamp
    const payment: Payment = {
      id: crypto.randomUUID(),
      payerId,
      payeeId,
      amount,
      description,
      date: new Date().toISOString(),
      createdBy: authorUid,
      createdAt: Timestamp.now(), // Use Timestamp.now() instead of serverTimestamp()
    };
    
    const updated = [...payments, payment];
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          payments: updated, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[addPayment] Firebase error:', error);
      throw new Error('Failed to add payment. Please try again.');
    }
  };

  const deletePayment = async (id: string) => {
    if (!trip) {
      console.error('[deletePayment] No trip selected');
      return;
    }
    
    const updated = payments.filter((p) => p.id !== id);
    
    try {
      await setDoc(
        tripDoc(trip.id),
        { 
          payments: updated, 
          updatedAt: serverTimestamp() 
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[deletePayment] Firebase error:', error);
      throw new Error('Failed to delete payment. Please try again.');
    }
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