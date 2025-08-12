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
      throw new Error('[addParticipant] No trip loaded');
    }
    
    if (!name.trim()) {
      throw new Error('[addParticipant] Participant name is required');
    }

    try {
      // Remove undefined values for Firestore
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
      throw new Error(`[addParticipant] Failed to add participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const updateParticipant = async (id: string, name: string) => {
    if (!trip) {
      throw new Error('[updateParticipant] No trip loaded');
    }
    
    if (!name.trim()) {
      throw new Error('[updateParticipant] Participant name is required');
    }

    try {
      const updated = participants.map((p) =>
        p.id === id ? { ...p, name: name.trim() } : p
      );
      const participantIds = updated.map((p) => p.userId || p.id);
      
      console.log('[updateParticipant] Updating participant:', id, 'to name:', name.trim());
      
      await setDoc(
        tripDoc(trip.id),
        { participants: updated, participantIds, updatedAt: serverTimestamp() },
        { merge: true }
      );
      
      console.log('[updateParticipant] Successfully updated participant');
    } catch (error) {
      console.error('[updateParticipant] Firebase error:', error);
      throw new Error(`[updateParticipant] Failed to update participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const deleteParticipant = async (id: string) => {
    if (!trip) {
      throw new Error('[deleteParticipant] No trip loaded');
    }
    
    try {
      const updated = participants.filter((p) => p.id !== id);
      const participantIds = updated.map((p) => p.userId || p.id);
      
      console.log('[deleteParticipant] Deleting participant:', id);
      
      await setDoc(
        tripDoc(trip.id),
        { participants: updated, participantIds, updatedAt: serverTimestamp() },
        { merge: true }
      );
      
      console.log('[deleteParticipant] Successfully deleted participant');
    } catch (error) {
      console.error('[deleteParticipant] Firebase error:', error);
      throw new Error(`[deleteParticipant] Failed to delete participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const addExpense = async (draft: ExpenseDraft) => {
    if (!trip) {
      throw new Error('[addExpense] No trip loaded');
    }
    
    try {
      console.log('[addExpense] Starting to add expense with draft:', draft);
      
      // Parse and validate the total amount
      const totalAmount = Math.max(0, parseFloat(String(draft.totalAmount || '')));
      console.log('[addExpense] Parsed total amount:', totalAmount);
      
      if (totalAmount <= 0) {
        throw new Error('[addExpense] Enter an amount greater than 0.');
      }
      
      // Process who paid
      const paidBy: Record<string, number> = {};
      for (const [pid, val] of Object.entries(draft.paidBy || {})) {
        const n = parseFloat(String(val));
        if (!Number.isNaN(n) && n > 0) {
          paidBy[pid] = n;
        }
      }
      console.log('[addExpense] Processed paidBy:', paidBy);
      
      // Validate payer amounts
      const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
      if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
        throw new Error('[addExpense] Payer amounts must sum to the total amount.');
      }
      
      // Find current user's participant ID
      const currentParticipant = participants.find(
        p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
      );
      const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';
      console.log('[addExpense] Current participant ID:', currentParticipantId);
      
      // If no one specified as payer, default to current user
      if (Object.keys(paidBy).length === 0) {
        paidBy[currentParticipantId] = totalAmount;
        console.log('[addExpense] Defaulted paidBy to current user:', paidBy);
      }
      
      // Process split type
      const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
      let splitParticipants = Array.isArray(draft.splitParticipants) ? draft.splitParticipants.slice() : [];
      if (!splitParticipants.length) {
        splitParticipants = (trip?.participants || []).map((p) => p.id);
      }
      console.log('[addExpense] Split type:', splitType, 'participants:', splitParticipants);
      
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
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - totalAmount) > 0.01) {
          throw new Error('[addExpense] Manual split must sum to total amount.');
        }
        console.log('[addExpense] Manual split:', manualSplit);
      }
      
      // ===== FIX: Use regular Date instead of serverTimestamp() for array items =====
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
        // ✅ Use regular Date for items that go in arrays
        createdAt: Timestamp.fromDate(new Date()),
      };
      
      console.log('[addExpense] Created expense object:', expense);
      
      // Save to Firebase
      const updated = [...expenses, expense];
      console.log('[addExpense] Saving updated expenses array with', updated.length, 'items');
      
      await setDoc(
        tripDoc(trip.id),
        { 
          expenses: updated, 
          updatedAt: serverTimestamp()  // ✅ serverTimestamp() OK at document level
        },
        { merge: true }
      );
      
      console.log('[addExpense] Successfully saved expense to Firebase');
      
      // Reset the form
      setNewExpense(emptyExpenseDraft);
      console.log('[addExpense] Reset expense form');
      
    } catch (error) {
      console.error('[addExpense] Error adding expense:', error);
      throw new Error(`[addExpense] Failed to add expense: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const updateExpense = async (id: string, draft: ExpenseDraft) => {
    if (!trip) {
      throw new Error('[updateExpense] No trip loaded');
    }
    
    try {
      console.log('[updateExpense] Updating expense:', id, 'with draft:', draft);
      
      const totalAmount = Math.max(0, parseFloat(String(draft.totalAmount || '')));
      
      if (totalAmount <= 0) {
        throw new Error('[updateExpense] Enter an amount greater than 0.');
      }
      
      const paidBy: Record<string, number> = {};
      for (const [pid, val] of Object.entries(draft.paidBy || {})) {
        const n = parseFloat(String(val));
        if (!Number.isNaN(n) && n > 0) {
          paidBy[pid] = n;
        }
      }
      
      const sumPaid = Object.values(paidBy).reduce((a, n) => a + n, 0);
      if (sumPaid > 0 && Math.abs(sumPaid - totalAmount) > 0.01) {
        throw new Error('[updateExpense] Payer amounts must sum to the total amount.');
      }
      
      // Use participant ID consistently
      const currentParticipant = participants.find(
        p => p.userId === userProfile?.uid || p.addedBy === userProfile?.uid
      );
      const currentParticipantId = currentParticipant?.id || userProfile?.uid || 'unknown';
      
      if (Object.keys(paidBy).length === 0) {
        paidBy[currentParticipantId] = totalAmount;
      }
      
      const splitType = draft.splitType === 'manual' ? 'manual' : 'even';
      let splitParticipants = Array.isArray(draft.splitParticipants) ? draft.splitParticipants.slice() : [];
      if (!splitParticipants.length) {
        splitParticipants = (trip.participants || []).map((p) => p.id);
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
        const sum = Object.values(manualSplit).reduce((a, s) => a + s.value, 0);
        if (Math.abs(sum - totalAmount) > 0.01) {
          throw new Error('[updateExpense] Manual split must sum to total amount.');
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
              // Keep original createdAt, don't update it
            }
          : e
      );
      
      await setDoc(
        tripDoc(trip.id),
        { expenses: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
      
      console.log('[updateExpense] Successfully updated expense');
      
    } catch (error) {
      console.error('[updateExpense] Error updating expense:', error);
      throw new Error(`[updateExpense] Failed to update expense: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const deleteExpense = async (id: string) => {
    if (!trip) {
      throw new Error('[deleteExpense] No trip loaded');
    }
    
    try {
      console.log('[deleteExpense] Deleting expense:', id);
      
      const updated = expenses.filter((e) => e.id !== id);
      
      await setDoc(
        tripDoc(trip.id),
        { expenses: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
      
      console.log('[deleteExpense] Successfully deleted expense');
      
    } catch (error) {
      console.error('[deleteExpense] Error deleting expense:', error);
      throw new Error(`[deleteExpense] Failed to delete expense: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error('[addPayment] No trip loaded');
    }
    
    try {
      console.log('[addPayment] Adding payment from', payerId, 'to', payeeId, 'amount:', amount);
      
      // ===== FIX: Use regular Date instead of serverTimestamp() for array items =====
      const payment: Payment = {
        id: crypto.randomUUID(),
        payerId,
        payeeId,
        amount,
        description,
        date: new Date().toISOString(),
        createdBy: authorUid,
        // ✅ Use regular Date for items that go in arrays
        createdAt: Timestamp.fromDate(new Date()),
      };
      
      const updated = [...payments, payment];
      
      await setDoc(
        tripDoc(trip.id),
        { 
          payments: updated, 
          updatedAt: serverTimestamp()  // ✅ serverTimestamp() OK at document level
        },
        { merge: true }
      );
      
      console.log('[addPayment] Successfully added payment');
      
    } catch (error) {
      console.error('[addPayment] Error adding payment:', error);
      throw new Error(`[addPayment] Failed to add payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const deletePayment = async (id: string) => {
    if (!trip) {
      throw new Error('[deletePayment] No trip loaded');
    }
    
    try {
      console.log('[deletePayment] Deleting payment:', id);
      
      const updated = payments.filter((p) => p.id !== id);
      
      await setDoc(
        tripDoc(trip.id),
        { payments: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
      
      console.log('[deletePayment] Successfully deleted payment');
      
    } catch (error) {
      console.error('[deletePayment] Error deleting payment:', error);
      throw new Error(`[deletePayment] Failed to delete payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
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