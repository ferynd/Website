'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Timestamp } from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { ADMIN_EMAIL } from './firebaseConfig';
import {
  auth,
  db,
  usersCol,
  userDoc,
  tripsCol,
  tripDoc,
  tripAuditCol,
} from './db';

// ===============================
// CONFIGURATION (Keep at top for easy access)
// ===============================

const EXPENSE_CATEGORIES = [
  'Food',
  'Transportation', 
  'Accommodation',
  'Activities',
  'Shopping',
  'Other'
];

const CURRENCY_SYMBOL = '$';
const AUTO_SAVE_DELAY = 1500; // milliseconds

// Debug mode - set to true to see console logs
const DEBUG_MODE = true;

// ===============================
// TYPE DEFINITIONS
// ===============================

interface Person {
  id: string;
  name: string;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastInitial: string;
  isAdmin: boolean;
  createdAt?: Timestamp;
}

interface TripParticipant {
  id: string;
  name: string;
  userId?: string;
  isRegistered: boolean;
  addedBy: string;
}

interface Expense {
  id: string;
  category: string;
  description: string;
  totalAmount: number;
  paidBy: { [personId: string]: number };
  splitType: 'even' | 'manual';
  splitParticipants: string[];
  manualSplit: { [personId: string]: { type: 'percent' | 'amount'; value: number | string } };
  createdBy?: string;
  createdAt?: Timestamp;
}

interface Payment {
  id: string;
  payerId: string;
  payeeId: string;
  date: string;
  description: string;
  amount: number;
  createdBy?: string;
  createdAt?: Timestamp;
}

interface Trip {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  participants: TripParticipant[];
  participantIds: string[];
  expenses: Expense[];
  payments: Payment[];
}

interface AuditEntry {
  id: string;
  type: string;
  actorUid: string | null;
  actorEmail: string | null;
  ts?: Timestamp;
  details?: unknown;
}

interface Balance {
  personId: string;
  name: string;
  totalPaid: number;
  shouldHavePaid: number;
  balance: number;
}

// ===============================
// MAIN COMPONENT
// ===============================

export default function TripCostPage() {
  // Authentication State
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // Auth Form State
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  // Data State
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // UI State - Trip Management
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState('');
  const [customParticipantName, setCustomParticipantName] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [showAuditLog, setShowAuditLog] = useState(false);

  // UI State - Expense Form
  const [newExpense, setNewExpense] = useState({
    category: EXPENSE_CATEGORIES[0],
    description: '',
    totalAmount: '',
    paidBy: {} as { [personId: string]: string },
    splitType: 'even' as 'even' | 'manual',
    splitParticipants: [] as string[],
    manualSplit: {} as { [personId: string]: { type: 'percent' | 'amount'; value: string } }
  });

  // UI State - Editing
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editPersonName, setEditPersonName] = useState('');

  // UI State - Payments
  const [paymentForms, setPaymentForms] = useState<{ [personId: string]: Payment }>({});

  // UI State - Confirmations
  const [confirmDelete, setConfirmDelete] = useState<{ type: string; id: string } | null>(null);

  // Save Timer
  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // ===============================
  // AUTHENTICATION & DATA LOADING
  // ===============================

  // Listen for auth changes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        if (DEBUG_MODE) {
          console.log('User logged in:', firebaseUser.email);
          console.log('Checking against ADMIN_EMAIL:', ADMIN_EMAIL);
        }
        
        // Get the user's profile document
        const profileRef = userDoc(firebaseUser.uid);
        const profileSnap = await getDoc(profileRef);
        
        if (profileSnap.exists()) {
          const data = profileSnap.data() as Omit<UserProfile, 'uid'>;
          
          // Check if this user should be admin based on email
          const shouldBeAdmin = firebaseUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
          
          if (DEBUG_MODE) {
            console.log('Current isAdmin in profile:', data.isAdmin);
            console.log('Should be admin based on email:', shouldBeAdmin);
          }
          
          // If user should be admin but isn't marked as such, update the profile
          if (shouldBeAdmin && !data.isAdmin) {
            console.log('Updating user to admin status...');
            await setDoc(profileRef, { 
              ...data, 
              isAdmin: true,
              updatedAt: serverTimestamp() 
            }, { merge: true });
            
            // Re-fetch the updated profile
            const updatedSnap = await getDoc(profileRef);
            const updatedData = updatedSnap.data() as Omit<UserProfile, 'uid'>;
            setUserProfile({ uid: profileSnap.id, ...updatedData });
            
            if (DEBUG_MODE) {
              console.log('Admin status updated successfully');
            }
          } else {
            setUserProfile({ uid: profileSnap.id, ...data });
          }
        } else {
          // No profile exists - this shouldn't happen for logged-in users
          // Create a basic profile
          console.log('No profile found, creating one...');
          const displayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
          const isAdmin = firebaseUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
          
          const newProfile = {
            email: firebaseUser.email || '',
            displayName: displayName,
            firstName: displayName,
            lastInitial: '',
            isAdmin: isAdmin,
            createdAt: serverTimestamp()
          };
          
          await setDoc(profileRef, newProfile);
          setUserProfile({ 
            uid: firebaseUser.uid, 
            ...newProfile,
            createdAt: undefined // Remove serverTimestamp placeholder
          });
          
          if (DEBUG_MODE) {
            console.log('Created new profile with admin status:', isAdmin);
          }
        }
        
        setShowAuth(false);
      } else {
        setUser(null);
        setUserProfile(null);
        setShowAuth(true);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Load all users (admin only)
  useEffect(() => {
    if (!userProfile?.isAdmin) {
      if (DEBUG_MODE && userProfile) {
        console.log('Not loading all users - not admin. Current profile:', userProfile);
      }
      return;
    }
    
    const load = async () => {
      try {
        if (DEBUG_MODE) {
          console.log('Loading all users as admin...');
        }
        const snap = await getDocs(usersCol());
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<UserProfile, 'uid'>;
          list.push({ uid: d.id, ...data });
        });
        setAllUsers(list);
        if (DEBUG_MODE) {
          console.log('Loaded users:', list.length);
        }
      } catch (error) {
        console.error('Failed to load users:', error);
      }
    };
    load();
  }, [userProfile]);

  // Load trips for current user
  useEffect(() => {
    if (!user) return;
    
    const base = tripsCol();
    const q = userProfile?.isAdmin 
      ? base 
      : query(base, where('participantIds', 'array-contains', user.uid));
    
    if (DEBUG_MODE) {
      console.log('Loading trips. Is admin?', userProfile?.isAdmin);
    }
    
    const unsub = onSnapshot(q, 
      (snap) => {
        const list: Trip[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<Trip, 'id'>;
          list.push({ id: d.id, ...data });
        });
        setTrips(list);
        if (DEBUG_MODE) {
          console.log('Loaded trips:', list.length);
        }
      },
      (error) => {
        console.error('Error loading trips:', error);
        // Check if it's a permissions error
        if (error.code === 'permission-denied') {
          console.error('Permission denied. Check Firebase rules and data structure.');
        }
      }
    );
    return () => unsub();
  }, [user, userProfile]);

  // Real-time sync for active trip
  useEffect(() => {
    if (!selectedTrip) return;
    const unsub = onSnapshot(tripDoc(selectedTrip.id), (d) => {
      if (!d.exists()) return;
      const data = d.data() as Omit<Trip, 'id'>;
      setSelectedTrip({ id: d.id, ...data });
      setPeople((data.participants || []).map((p) => ({ id: p.id, name: p.name })));
      setExpenses(data.expenses || []);
      setAllPayments(data.payments || []);
    });
    return () => unsub();
  }, [selectedTrip]);

  // Load audit log (admin only)
  useEffect(() => {
    if (!selectedTrip || !userProfile?.isAdmin) return;
    const q = query(tripAuditCol(selectedTrip.id), orderBy('ts', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const items: AuditEntry[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...(d.data() as Omit<AuditEntry, 'id'>) }));
      setAuditEntries(items);
    });
    return () => unsub();
  }, [selectedTrip, userProfile]);

  // ===============================
  // AUDIT LOGGING
  // ===============================

  const writeAudit = useCallback(
    async (tripId: string, type: string, details?: unknown) => {
      if (!user) return;
      try {
        await addDoc(tripAuditCol(tripId), {
          type,
          details: details ?? null,
          actorUid: user.uid,
          actorEmail: user.email,
          ts: serverTimestamp(),
        });
      } catch (e) {
        console.error('Audit write failed:', e);
      }
    },
    [user]
  );

  // ===============================
  // SAVE FUNCTIONALITY
  // ===============================

  const saveTrip = useCallback(async () => {
    if (!selectedTrip || !user) return;
    
    const participantIds = Array.from(
      new Set((selectedTrip.participants || [])
        .map((p) => p.userId)
        .filter(Boolean) as string[])
    );
    
    const updated: Trip = {
      ...selectedTrip,
      participants: selectedTrip.participants,
      expenses,
      payments: allPayments,
      participantIds,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };
    
    try {
      await setDoc(tripDoc(selectedTrip.id), updated, { merge: true });
      await writeAudit(selectedTrip.id, 'trip_saved', {
        participants: updated.participants.length,
        expenses: updated.expenses.length,
        payments: updated.payments.length,
      });
    } catch (err) {
      console.error('Failed to save trip:', err);
    }
  }, [selectedTrip, expenses, allPayments, user, writeAudit]);

  // Auto-save debounced
  useEffect(() => {
    if (!selectedTrip || !user) return;
    if (saveTimer) clearTimeout(saveTimer);
    const timer = setTimeout(() => saveTrip(), AUTO_SAVE_DELAY);
    setSaveTimer(timer);
    return () => clearTimeout(timer);
  }, [expenses, allPayments, selectedTrip?.participants]);

  // ===============================
  // CALCULATIONS
  // ===============================

  const calculateBalances = useMemo((): Balance[] => {
    const balances: Balance[] = people.map(person => ({
      personId: person.id,
      name: person.name,
      totalPaid: 0,
      shouldHavePaid: 0,
      balance: 0
    }));

    // Calculate what each person paid
    expenses.forEach(expense => {
      Object.entries(expense.paidBy).forEach(([personId, amount]) => {
        const balance = balances.find(b => b.personId === personId);
        if (balance) balance.totalPaid += amount;
      });
    });

    // Calculate what each person should have paid
    expenses.forEach(expense => {
      const shouldPayMap: { [personId: string]: number } = {};
      
      if (expense.splitType === 'even') {
        const perPerson = expense.totalAmount / expense.splitParticipants.length;
        expense.splitParticipants.forEach(personId => {
          shouldPayMap[personId] = perPerson;
        });
      } else {
        expense.splitParticipants.forEach(personId => {
          const split = expense.manualSplit[personId];
          if (split) {
            if (split.type === 'percent') {
              shouldPayMap[personId] = (Number(split.value) / 100) * expense.totalAmount;
            } else {
              shouldPayMap[personId] = Number(split.value);
            }
          }
        });
      }

      Object.entries(shouldPayMap).forEach(([personId, amount]) => {
        const balance = balances.find(b => b.personId === personId);
        if (balance) balance.shouldHavePaid += amount;
      });
    });

    // Add direct payments
    allPayments.forEach(payment => {
      const payer = balances.find(b => b.personId === payment.payerId);
      const payee = balances.find(b => b.personId === payment.payeeId);
      if (payer) payer.totalPaid += payment.amount;
      if (payee) payee.shouldHavePaid += payment.amount;
    });

    // Calculate final balances
    balances.forEach(balance => {
      balance.balance = balance.totalPaid - balance.shouldHavePaid;
    });

    return balances;
  }, [people, expenses, allPayments]);

  const calculateSettlements = useMemo(() => {
    const balancesCopy = calculateBalances.map(b => ({ ...b }));
    const settlements: { from: string; to: string; amount: number }[] = [];

    balancesCopy.sort((a, b) => a.balance - b.balance);

    let i = 0;
    let j = balancesCopy.length - 1;

    while (i < j) {
      const debtor = balancesCopy[i];
      const creditor = balancesCopy[j];

      if (Math.abs(debtor.balance) < 0.01) {
        i++;
        continue;
      }
      if (Math.abs(creditor.balance) < 0.01) {
        j--;
        continue;
      }

      const amount = Math.min(Math.abs(debtor.balance), creditor.balance);
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount: Math.round(amount * 100) / 100
      });

      debtor.balance += amount;
      creditor.balance -= amount;

      if (Math.abs(debtor.balance) < 0.01) i++;
      if (Math.abs(creditor.balance) < 0.01) j--;
    }

    return settlements;
  }, [calculateBalances]);

  // ===============================
  // HANDLERS - AUTHENTICATION
  // ===============================

  const handleAuthSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      
      try {
        if (isLogin) {
          // Just sign in - the onAuthStateChanged handler will check/update admin status
          await signInWithEmailAndPassword(auth, authEmail, authPassword);
          if (DEBUG_MODE) {
            console.log('Sign in successful for:', authEmail);
          }
        } else {
          // Sign up new user
          if (!firstName.trim() || !lastInitial.trim()) {
            setAuthError('Please provide your first name and last initial.');
            return;
          }
          
          const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
          const uid = cred.user.uid;
          const displayName = `${firstName.trim()} ${lastInitial.trim().toUpperCase()}`;
          const isAdmin = authEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
          
          if (DEBUG_MODE) {
            console.log('Creating new user profile. Is admin?', isAdmin);
          }
          
          await setDoc(userDoc(uid), {
            email: authEmail.toLowerCase(),
            firstName: firstName.trim(),
            lastInitial: lastInitial.trim().toUpperCase(),
            displayName,
            isAdmin: isAdmin,
            createdAt: serverTimestamp(),
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        setAuthError(message);
        console.error('Auth error:', err);
      }
    };

    // Add a manual admin check function (for debugging)
    const checkAdminStatus = async () => {
      if (!user) return;
      
      const shouldBeAdmin = user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      console.log('Manual admin check:');
      console.log('Current user email:', user.email);
      console.log('Admin email:', ADMIN_EMAIL);
      console.log('Should be admin:', shouldBeAdmin);
      console.log('Current profile isAdmin:', userProfile?.isAdmin);
      
      if (shouldBeAdmin && !userProfile?.isAdmin) {
        console.log('Forcing admin update...');
        const profileRef = userDoc(user.uid);
        await setDoc(profileRef, { isAdmin: true }, { merge: true });
        
        // Re-fetch profile
        const snap = await getDoc(profileRef);
        if (snap.exists()) {
          const data = snap.data() as Omit<UserProfile, 'uid'>;
          setUserProfile({ uid: snap.id, ...data });
          console.log('Admin status force updated');
        }
      }
    };

  const handleLogout = async () => {
    await signOut(auth);
    setSelectedTrip(null);
  };

  // ===============================
  // HANDLERS - TRIP MANAGEMENT
  // ===============================

  const handleCreateTrip = async () => {
    const name = newTripName.trim();
    if (!name || !user || !userProfile?.isAdmin) return;
    
    const tripId = crypto.randomUUID();
    const docData: Omit<Trip, 'id'> = {
      name,
      createdBy: user.uid,
      createdAt: serverTimestamp() as unknown as Timestamp,
      updatedAt: serverTimestamp() as unknown as Timestamp,
      participants: [{
        id: user.uid,
        name: userProfile.displayName,
        userId: user.uid,
        isRegistered: true,
        addedBy: user.uid
      }],
      participantIds: [user.uid],
      expenses: [],
      payments: [],
    };
    
    try {
      await setDoc(tripDoc(tripId), docData);
      await writeAudit(tripId, 'trip_created', { name });
      setNewTripName('');
    } catch (err) {
      console.error('Failed to create trip:', err);
    }
  };

  const handleDeleteTrip = async (trip: Trip) => {
    if (!userProfile?.isAdmin) return;
    if (!window.confirm(`Delete the trip "${trip.name}"? This cannot be undone.`)) return;
    
    try {
      await writeAudit(trip.id, 'trip_deleted', { name: trip.name });
      await deleteDoc(tripDoc(trip.id));
      if (selectedTrip?.id === trip.id) setSelectedTrip(null);
    } catch (err) {
      console.error('Failed to delete trip:', err);
    }
  };

  const handleOpenTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    setPeople((trip.participants || []).map((p) => ({ id: p.id, name: p.name })));
    setExpenses(trip.expenses || []);
    setAllPayments(trip.payments || []);
    // Reset expense form
    setNewExpense({
      category: EXPENSE_CATEGORIES[0],
      description: '',
      totalAmount: '',
      paidBy: {},
      splitType: 'even',
      splitParticipants: [],
      manualSplit: {}
    });
  };

  // ===============================
  // HANDLERS - PARTICIPANTS
  // ===============================

  const handleAddParticipant = async () => {
    if (!userProfile?.isAdmin || !user || !selectedTrip) return;
    
    let participant: TripParticipant | null = null;
    
    if (selectedUserIdToAdd) {
      const u = allUsers.find((u) => u.uid === selectedUserIdToAdd);
      if (!u) return;
      
      // Check if user already added
      if (selectedTrip.participants.some(p => p.userId === u.uid)) {
        alert('This user is already a participant');
        return;
      }
      
      participant = {
        id: u.uid,
        name: u.displayName,
        userId: u.uid,
        isRegistered: true,
        addedBy: user.uid,
      };
    } else if (customParticipantName.trim()) {
      participant = {
        id: crypto.randomUUID(),
        name: customParticipantName.trim(),
        isRegistered: false,
        addedBy: user.uid,
      } as TripParticipant;
    }
    
    if (!participant) return;

    setPeople((prev) => [...prev, { id: participant!.id, name: participant!.name }]);
    setSelectedTrip((prev) =>
      prev ? {
        ...prev,
        participants: [...prev.participants, participant!],
        participantIds: participant!.userId 
          ? [...new Set([...prev.participantIds, participant!.userId])]
          : prev.participantIds
      } : prev
    );
    
    setSelectedUserIdToAdd('');
    setCustomParticipantName('');
    await writeAudit(selectedTrip.id, 'participant_added', { participant });
  };

  const handleRemoveParticipant = async (personId: string) => {
    if (!userProfile?.isAdmin || !selectedTrip) return;
    
    const person = people.find(p => p.id === personId);
    if (!person) return;
    
    if (!window.confirm(`Remove ${person.name} from the trip? This will also remove their expenses and payments.`)) {
      return;
    }

    // Remove from people
    setPeople(prev => prev.filter(p => p.id !== personId));
    
    // Remove from participants
    setSelectedTrip(prev => {
      if (!prev) return prev;
      const updatedParticipants = prev.participants.filter(p => p.id !== personId);
      const updatedParticipantIds = updatedParticipants
        .map(p => p.userId)
        .filter(Boolean) as string[];
      return {
        ...prev,
        participants: updatedParticipants,
        participantIds: [...new Set(updatedParticipantIds)]
      };
    });
    
    // Remove related expenses and payments
    setExpenses(prev => prev.filter(e => 
      !e.paidBy[personId] && !e.splitParticipants.includes(personId)
    ));
    setAllPayments(prev => prev.filter(p => 
      p.payerId !== personId && p.payeeId !== personId
    ));
    
    await writeAudit(selectedTrip.id, 'participant_removed', { person });
  };

  const handleEditPersonName = (personId: string, newName: string) => {
    if (!userProfile?.isAdmin || !selectedTrip) return;
    
    const participant = selectedTrip.participants.find(p => p.id === personId);
    if (!participant || participant.isRegistered) return; // Can't edit registered users
    
    setPeople(prev => prev.map(p => 
      p.id === personId ? { ...p, name: newName } : p
    ));
    
    setSelectedTrip(prev => prev ? {
      ...prev,
      participants: prev.participants.map(p => 
        p.id === personId ? { ...p, name: newName } : p
      )
    } : prev);
    
    setEditingPersonId(null);
    setEditPersonName('');
  };

  // ===============================
  // HANDLERS - EXPENSES
  // ===============================

  const handleAddExpense = async () => {
    if (!selectedTrip || !user) return;
    
    // Validation
    const totalAmount = parseFloat(newExpense.totalAmount);
    if (isNaN(totalAmount) || totalAmount <= 0) {
      alert('Please enter a valid total amount');
      return;
    }
    
    // Check paidBy amounts
    const paidByTotal = Object.values(newExpense.paidBy)
      .reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
    
    if (Math.abs(paidByTotal - totalAmount) > 0.01) {
      alert(`Paid amounts (${CURRENCY_SYMBOL}${paidByTotal.toFixed(2)}) must equal total (${CURRENCY_SYMBOL}${totalAmount.toFixed(2)})`);
      return;
    }
    
    // Check split participants
    if (newExpense.splitParticipants.length === 0) {
      alert('Please select at least one person to split with');
      return;
    }
    
    // Check manual split totals
    if (newExpense.splitType === 'manual') {
      const splitTotal = newExpense.splitParticipants.reduce((sum, personId) => {
        const split = newExpense.manualSplit[personId];
        if (!split) return sum;
        if (split.type === 'percent') {
          return sum + parseFloat(split.value) / 100 * totalAmount;
        } else {
          return sum + parseFloat(split.value);
        }
      }, 0);
      
      if (Math.abs(splitTotal - totalAmount) > 0.01) {
        alert(`Split amounts (${CURRENCY_SYMBOL}${splitTotal.toFixed(2)}) must equal total (${CURRENCY_SYMBOL}${totalAmount.toFixed(2)})`);
        return;
      }
    }
    
    const expense: Expense = {
      id: editingExpenseId || crypto.randomUUID(),
      category: newExpense.category,
      description: newExpense.description,
      totalAmount,
      paidBy: Object.fromEntries(
        Object.entries(newExpense.paidBy)
          .filter(([_, val]) => parseFloat(val) > 0)
          .map(([key, val]) => [key, parseFloat(val)])
      ),
      splitType: newExpense.splitType,
      splitParticipants: newExpense.splitParticipants,
      manualSplit: newExpense.manualSplit,
      createdBy: editingExpenseId 
        ? expenses.find(e => e.id === editingExpenseId)?.createdBy || user.uid
        : user.uid,
      createdAt: serverTimestamp() as unknown as Timestamp
    };
    
    if (editingExpenseId) {
      setExpenses(prev => prev.map(e => e.id === editingExpenseId ? expense : e));
      await writeAudit(selectedTrip.id, 'expense_updated', { expense });
    } else {
      setExpenses(prev => [...prev, expense]);
      await writeAudit(selectedTrip.id, 'expense_added', { expense });
    }
    
    // Reset form
    setNewExpense({
      category: EXPENSE_CATEGORIES[0],
      description: '',
      totalAmount: '',
      paidBy: {},
      splitType: 'even',
      splitParticipants: [],
      manualSplit: {}
    });
    setEditingExpenseId(null);
  };

  const handleEditExpense = (expense: Expense) => {
    setEditingExpenseId(expense.id);
    setNewExpense({
      category: expense.category,
      description: expense.description,
      totalAmount: expense.totalAmount.toString(),
      paidBy: Object.fromEntries(
        Object.entries(expense.paidBy).map(([k, v]) => [k, v.toString()])
      ),
      splitType: expense.splitType,
      splitParticipants: expense.splitParticipants,
      manualSplit: Object.fromEntries(
        Object.entries(expense.manualSplit).map(([k, v]) => [k, { ...v, value: v.value.toString() }])
      )
    });
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!selectedTrip) return;
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) return;
    
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    await writeAudit(selectedTrip.id, 'expense_deleted', { expense });
    setConfirmDelete(null);
  };

  // ===============================
  // HANDLERS - PAYMENTS
  // ===============================

  const handleAddPayment = async (payerId: string) => {
    if (!selectedTrip || !user) return;
    
    const form = paymentForms[payerId];
    if (!form || !form.payeeId || !form.amount) return;
    
    const amount = parseFloat(form.amount.toString());
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }
    
    const payment: Payment = {
      id: editingPaymentId || crypto.randomUUID(),
      payerId,
      payeeId: form.payeeId,
      date: form.date || new Date().toISOString().split('T')[0],
      description: form.description || 'Direct payment',
      amount,
      createdBy: editingPaymentId
        ? allPayments.find(p => p.id === editingPaymentId)?.createdBy || user.uid
        : user.uid,
      createdAt: serverTimestamp() as unknown as Timestamp
    };
    
    if (editingPaymentId) {
      setAllPayments(prev => prev.map(p => p.id === editingPaymentId ? payment : p));
      await writeAudit(selectedTrip.id, 'payment_updated', { payment });
    } else {
      setAllPayments(prev => [...prev, payment]);
      await writeAudit(selectedTrip.id, 'payment_added', { payment });
    }
    
    // Reset form
    setPaymentForms(prev => ({ ...prev, [payerId]: { ...form, amount: 0, description: '' } }));
    setEditingPaymentId(null);
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!selectedTrip) return;
    const payment = allPayments.find(p => p.id === paymentId);
    if (!payment) return;
    
    setAllPayments(prev => prev.filter(p => p.id !== paymentId));
    await writeAudit(selectedTrip.id, 'payment_deleted', { payment });
    setConfirmDelete(null);
  };

  // ===============================
  // PERMISSION HELPERS
  // ===============================

  const canEditExpense = (expense: Expense) => {
    return userProfile?.isAdmin || expense.createdBy === user?.uid;
  };

  const canEditPayment = (payment: Payment) => {
    return userProfile?.isAdmin || payment.createdBy === user?.uid;
  };

  // ===============================
  // RENDER FUNCTIONS
  // ===============================

  const renderAuthForm = () => (
    <div className="min-h-screen bg-gray-50 flex justify-center items-center p-4">
      <div className="w-full max-w-md bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
          {isLogin ? 'Log in to Trip Cost' : 'Create Account'}
        </h2>
        
        {authError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {authError}
          </div>
        )}
        
        <form onSubmit={handleAuthSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            />
          </div>
          
          {!isLogin && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>
              <div className="w-24">
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial</label>
                <input
                  type="text"
                  value={lastInitial}
                  onChange={(e) => setLastInitial(e.target.value.slice(0, 1))}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  maxLength={1}
                  required
                />
              </div>
            </div>
          )}
          
          <button
            type="submit"
            className="w-full bg-purple-600 text-white py-3 rounded-md hover:bg-purple-700 transition-colors font-medium"
          >
            {isLogin ? 'Log In' : 'Sign Up'}
          </button>
        </form>
        
        <div className="mt-6 text-center text-sm text-gray-600">
          {isLogin ? (
            <>
              Don't have an account?{' '}
              <button
                onClick={() => {
                  setIsLogin(false);
                  setAuthError('');
                }}
                className="text-purple-600 hover:underline font-medium"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => {
                  setIsLogin(true);
                  setAuthError('');
                }}
                className="text-purple-600 hover:underline font-medium"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderTripList = () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">Trip Cost Calculator</h1>
            <div className="flex items-center gap-4">
              <span className="text-gray-600">
                {userProfile?.displayName}
                {userProfile?.isAdmin && (
                  <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Admin</span>
                )}
              </span>
              <button
                onClick={handleLogout}
                className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition-colors text-sm"
              >
                Log out
              </button>
            </div>
          </div>
        </div>

        {/* Create Trip (Admin) */}
        {userProfile?.isAdmin && (
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={newTripName}
                onChange={(e) => setNewTripName(e.target.value)}
                placeholder="Enter trip name..."
                className="flex-1 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <button
                onClick={handleCreateTrip}
                className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 transition-colors font-medium"
              >
                Create Trip
              </button>
            </div>
          </div>
        )}

        {/* Trip Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <div key={trip.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
              <div className="p-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">{trip.name}</h2>
                <div className="space-y-1 text-sm text-gray-600 mb-4">
                  <p>{trip.participants.length} participant{trip.participants.length !== 1 && 's'}</p>
                  <p>{trip.expenses.length} expense{trip.expenses.length !== 1 && 's'}</p>
                  <p>{trip.payments.length} payment{trip.payments.length !== 1 && 's'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenTrip(trip)}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                  >
                    Open
                  </button>
                  {userProfile?.isAdmin && (
                    <button
                      onClick={() => handleDeleteTrip(trip)}
                      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          {trips.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-500">
              {userProfile?.isAdmin 
                ? "No trips yet. Create your first trip above!"
                : "No trips available. Ask an admin to add you to a trip."}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderTripDetail = () => {
    if (!selectedTrip) return null;

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          {/* Header */}
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <button
              onClick={() => setSelectedTrip(null)}
              className="text-blue-600 hover:underline mb-2"
            >
              ← Back to trips
            </button>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">{selectedTrip.name}</h1>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedTrip.participants.length} participants • 
                  {expenses.length} expenses • 
                  {allPayments.length} payments
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition-colors text-sm"
              >
                Log out
              </button>
            </div>
          </div>

          {/* Participants */}
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <h2 className="text-lg font-semibold mb-4">Participants</h2>
            
            {/* Add Participant (Admin) */}
            {userProfile?.isAdmin && (
              <div className="mb-4 p-3 bg-gray-50 rounded">
                <div className="grid md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Add registered user</label>
                    <select
                      value={selectedUserIdToAdd}
                      onChange={(e) => setSelectedUserIdToAdd(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="">Select a user...</option>
                      {allUsers
                        .filter(u => !selectedTrip.participants.some(p => p.userId === u.uid))
                        .map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName} ({u.email})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Or add custom name</label>
                    <input
                      type="text"
                      value={customParticipantName}
                      onChange={(e) => setCustomParticipantName(e.target.value)}
                      placeholder="e.g., Alex R"
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleAddParticipant}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                    >
                      Add Participant
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Participant List */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {people.map((person) => {
                const participant = selectedTrip.participants.find(p => p.id === person.id);
                const isRegistered = participant?.isRegistered || false;
                
                return (
                  <div key={person.id} className="flex items-center justify-between p-3 border rounded">
                    {editingPersonId === person.id ? (
                      <input
                        type="text"
                        value={editPersonName}
                        onChange={(e) => setEditPersonName(e.target.value)}
                        onBlur={() => handleEditPersonName(person.id, editPersonName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleEditPersonName(person.id, editPersonName);
                          if (e.key === 'Escape') {
                            setEditingPersonId(null);
                            setEditPersonName('');
                          }
                        }}
                        className="flex-1 p-1 border rounded"
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`flex-1 ${!isRegistered && userProfile?.isAdmin ? 'cursor-pointer hover:text-blue-600' : ''}`}
                        onClick={() => {
                          if (!isRegistered && userProfile?.isAdmin) {
                            setEditingPersonId(person.id);
                            setEditPersonName(person.name);
                          }
                        }}
                      >
                        {person.name}
                        {isRegistered && (
                          <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">User</span>
                        )}
                      </span>
                    )}
                    {userProfile?.isAdmin && (
                      <button
                        onClick={() => handleRemoveParticipant(person.id)}
                        className="ml-2 text-red-600 hover:text-red-800"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Expense Form */}
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <h2 className="text-lg font-semibold mb-4">
              {editingExpenseId ? 'Edit Expense' : 'Add Expense'}
            </h2>
            
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={newExpense.category}
                  onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                  className="w-full p-2 border border-gray-300 rounded"
                >
                  {EXPENSE_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({...newExpense, description: e.target.value})}
                  placeholder="What was this expense for?"
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={newExpense.totalAmount}
                  onChange={(e) => setNewExpense({...newExpense, totalAmount: e.target.value})}
                  placeholder="0.00"
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Split Type</label>
                <select
                  value={newExpense.splitType}
                  onChange={(e) => setNewExpense({
                    ...newExpense, 
                    splitType: e.target.value as 'even' | 'manual',
                    manualSplit: {}
                  })}
                  className="w-full p-2 border border-gray-300 rounded"
                >
                  <option value="even">Split Evenly</option>
                  <option value="manual">Manual Split</option>
                </select>
              </div>
            </div>

            {/* Who Paid */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Who Paid?</label>
              <div className="grid md:grid-cols-3 gap-2">
                {people.map(person => (
                  <div key={person.id} className="flex items-center gap-2">
                    <span className="flex-1">{person.name}:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={newExpense.paidBy[person.id] || ''}
                      onChange={(e) => setNewExpense({
                        ...newExpense,
                        paidBy: {...newExpense.paidBy, [person.id]: e.target.value}
                      })}
                      placeholder="0.00"
                      className="w-24 p-1 border border-gray-300 rounded"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Split Between */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Split Between</label>
              <div className="grid md:grid-cols-3 gap-2">
                {people.map(person => (
                  <label key={person.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newExpense.splitParticipants.includes(person.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewExpense({
                            ...newExpense,
                            splitParticipants: [...newExpense.splitParticipants, person.id]
                          });
                        } else {
                          setNewExpense({
                            ...newExpense,
                            splitParticipants: newExpense.splitParticipants.filter(id => id !== person.id),
                            manualSplit: Object.fromEntries(
                              Object.entries(newExpense.manualSplit).filter(([k]) => k !== person.id)
                            )
                          });
                        }
                      }}
                    />
                    <span>{person.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Manual Split Details */}
            {newExpense.splitType === 'manual' && newExpense.splitParticipants.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Manual Split Details</label>
                <div className="space-y-2">
                  {newExpense.splitParticipants.map(personId => {
                    const person = people.find(p => p.id === personId);
                    if (!person) return null;
                    
                    const split = newExpense.manualSplit[personId] || { type: 'amount', value: '' };
                    
                    return (
                      <div key={personId} className="flex items-center gap-2">
                        <span className="w-32">{person.name}:</span>
                        <select
                          value={split.type}
                          onChange={(e) => setNewExpense({
                            ...newExpense,
                            manualSplit: {
                              ...newExpense.manualSplit,
                              [personId]: { ...split, type: e.target.value as 'percent' | 'amount' }
                            }
                          })}
                          className="p-1 border border-gray-300 rounded"
                        >
                          <option value="amount">Amount</option>
                          <option value="percent">Percent</option>
                        </select>
                        <input
                          type="number"
                          step={split.type === 'percent' ? '1' : '0.01'}
                          value={split.value}
                          onChange={(e) => setNewExpense({
                            ...newExpense,
                            manualSplit: {
                              ...newExpense.manualSplit,
                              [personId]: { ...split, value: e.target.value }
                            }
                          })}
                          placeholder={split.type === 'percent' ? '0' : '0.00'}
                          className="w-24 p-1 border border-gray-300 rounded"
                        />
                        <span>{split.type === 'percent' ? '%' : CURRENCY_SYMBOL}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleAddExpense}
                className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 transition-colors"
              >
                {editingExpenseId ? 'Update Expense' : 'Add Expense'}
              </button>
              {editingExpenseId && (
                <button
                  onClick={() => {
                    setEditingExpenseId(null);
                    setNewExpense({
                      category: EXPENSE_CATEGORIES[0],
                      description: '',
                      totalAmount: '',
                      paidBy: {},
                      splitType: 'even',
                      splitParticipants: [],
                      manualSplit: {}
                    });
                  }}
                  className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Expenses List */}
          {expenses.length > 0 && (
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <h2 className="text-lg font-semibold mb-4">Expenses</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Category</th>
                      <th className="text-left py-2">Description</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-left py-2">Paid By</th>
                      <th className="text-left py-2">Split</th>
                      <th className="text-right py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(expense => (
                      <tr key={expense.id} className="border-b">
                        <td className="py-2">{expense.category}</td>
                        <td className="py-2">{expense.description}</td>
                        <td className="py-2 text-right">{CURRENCY_SYMBOL}{expense.totalAmount.toFixed(2)}</td>
                        <td className="py-2">
                          {Object.entries(expense.paidBy).map(([personId, amount]) => {
                            const person = people.find(p => p.id === personId);
                            return (
                              <div key={personId}>
                                {person?.name}: {CURRENCY_SYMBOL}{amount.toFixed(2)}
                              </div>
                            );
                          })}
                        </td>
                        <td className="py-2">
                          {expense.splitType === 'even' ? 'Even' : 'Manual'} between {expense.splitParticipants.length} people
                        </td>
                        <td className="py-2 text-right">
                          {canEditExpense(expense) && (
                            <>
                              <button
                                onClick={() => handleEditExpense(expense)}
                                className="text-blue-600 hover:text-blue-800 mr-2"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setConfirmDelete({ type: 'expense', id: expense.id })}
                                className="text-red-600 hover:text-red-800"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Balance Summary */}
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <h2 className="text-lg font-semibold mb-4">Balance Summary</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {calculateBalances.map(balance => (
                <div key={balance.personId} className="border rounded p-3">
                  <h3 className="font-medium mb-2">{balance.name}</h3>
                  <div className="space-y-1 text-sm">
                    <p>Paid: {CURRENCY_SYMBOL}{balance.totalPaid.toFixed(2)}</p>
                    <p>Should have paid: {CURRENCY_SYMBOL}{balance.shouldHavePaid.toFixed(2)}</p>
                    <p className={`font-semibold ${balance.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {balance.balance >= 0 ? 'Is owed' : 'Owes'}: {CURRENCY_SYMBOL}{Math.abs(balance.balance).toFixed(2)}
                    </p>
                  </div>
                  
                  {/* Payment Form */}
                  <div className="mt-3 pt-3 border-t">
                    <div className="text-xs text-gray-600 mb-1">Record payment from {balance.name}:</div>
                    <div className="flex gap-1">
                      <select
                        value={paymentForms[balance.personId]?.payeeId || ''}
                        onChange={(e) => setPaymentForms(prev => ({
                          ...prev,
                          [balance.personId]: {
                            ...prev[balance.personId],
                            id: '',
                            payerId: balance.personId,
                            payeeId: e.target.value,
                            date: new Date().toISOString().split('T')[0],
                            description: 'Direct payment',
                            amount: prev[balance.personId]?.amount || 0
                          }
                        }))}
                        className="flex-1 p-1 text-sm border rounded"
                      >
                        <option value="">To...</option>
                        {people.filter(p => p.id !== balance.personId).map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={paymentForms[balance.personId]?.amount || ''}
                        onChange={(e) => setPaymentForms(prev => ({
                          ...prev,
                          [balance.personId]: {
                            ...prev[balance.personId],
                            amount: parseFloat(e.target.value) || 0
                          }
                        }))}
                        placeholder="0.00"
                        className="w-20 p-1 text-sm border rounded"
                      />
                      <button
                        onClick={() => handleAddPayment(balance.personId)}
                        className="px-2 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settlement Suggestions */}
          {calculateSettlements.length > 0 && (
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <h2 className="text-lg font-semibold mb-4">Suggested Settlements</h2>
              <div className="space-y-2">
                {calculateSettlements.map((settlement, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-lg">
                    <span className="font-medium">{settlement.from}</span>
                    <span>→</span>
                    <span className="font-medium">{settlement.to}</span>
                    <span className="text-green-600 font-semibold">
                      {CURRENCY_SYMBOL}{settlement.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment History */}
          {allPayments.length > 0 && (
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <h2 className="text-lg font-semibold mb-4">Payment History</h2>
              <div className="space-y-2">
                {allPayments.map(payment => {
                  const payer = people.find(p => p.id === payment.payerId);
                  const payee = people.find(p => p.id === payment.payeeId);
                  
                  return (
                    <div key={payment.id} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <span className="font-medium">{payer?.name}</span>
                        <span> paid </span>
                        <span className="font-medium">{payee?.name}</span>
                        <span className="text-green-600 font-semibold ml-2">
                          {CURRENCY_SYMBOL}{payment.amount.toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-sm ml-2">({payment.date})</span>
                        {payment.description && (
                          <span className="text-gray-600 text-sm ml-2">- {payment.description}</span>
                        )}
                      </div>
                      {canEditPayment(payment) && (
                        <button
                          onClick={() => setConfirmDelete({ type: 'payment', id: payment.id })}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Audit Log (Admin) */}
          {userProfile?.isAdmin && (
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Audit Log</h2>
                <button
                  onClick={() => setShowAuditLog(!showAuditLog)}
                  className="text-blue-600 hover:underline text-sm"
                >
                  {showAuditLog ? 'Hide' : 'Show'} Audit Log
                </button>
              </div>
              
              {showAuditLog && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {auditEntries.length === 0 ? (
                    <p className="text-gray-500 text-sm">No audit entries yet.</p>
                  ) : (
                    auditEntries.map((entry) => (
                      <div key={entry.id} className="p-2 border rounded text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">{entry.type.replace(/_/g, ' ')}</span>
                          <span className="text-gray-500">
                            {entry.ts ? new Date((entry.ts as any).seconds * 1000).toLocaleString() : 'Unknown time'}
                          </span>
                        </div>
                        <div className="text-gray-600">
                          by {entry.actorEmail || entry.actorUid || 'unknown'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full">
              <h3 className="text-lg font-semibold mb-4">Confirm Delete</h3>
              <p className="mb-6">Are you sure you want to delete this {confirmDelete.type}?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (confirmDelete.type === 'expense') {
                      handleDeleteExpense(confirmDelete.id);
                    } else if (confirmDelete.type === 'payment') {
                      handleDeletePayment(confirmDelete.id);
                    }
                  }}
                  className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 bg-gray-300 text-gray-800 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ===============================
  // MAIN RENDER
  // ===============================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (showAuth) return renderAuthForm();
  if (selectedTrip) return renderTripDetail();
  return renderTripList();
}