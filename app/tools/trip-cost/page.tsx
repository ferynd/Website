/*
 * Trip Cost Tool – Next.js Page Component
 *
 * This component implements authentication, trip management and a scaffold for
 * the multi‑user Trip Cost calculator.  Users must sign up or log in via
 * Firebase Auth before they can view their trips.  Trips are persisted to
 * Cloud Firestore under the `tripCostApp/trips` collection.  Each trip
 * document contains a list of participants, expenses and payments.  Admin
 * users (defined by the ADMIN_EMAIL constant in firebaseConfig.ts) can
 * create and delete trips and manage participants.  Regular users can view
 * and contribute to trips they are part of.
 *
 * NOTE: This file currently scaffolds the authentication flow and trip
 * dashboard.  The detailed expense calculator UI from the original
 * trip‑cost‑client has not yet been integrated.  A future revision will
 * embed the calculator component and synchronize its state with Firestore.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import type { Timestamp } from 'firebase/firestore';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { firebaseConfig, ADMIN_EMAIL } from './firebaseConfig';

// Initialize Firebase app, auth and firestore once per module.
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ---- Type Definitions ----

// Basic person used by the calculator UI.  Separate from TripParticipant; this
// type only includes id and name for display.
interface Person {
  id: string;
  name: string;
}

// User profile stored under tripCostApp/users/{uid}.  Each document holds
// metadata about a user and whether they are an admin.
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastInitial: string;
  isAdmin: boolean;
  createdAt?: Timestamp;
}

// Participant entry stored in trip documents.  If the participant is a
// registered user, userId holds their UID and isRegistered is true.
interface TripParticipant {
  id: string;
  name: string;
  userId?: string;
  isRegistered: boolean;
  addedBy: string;
}

// Expense record within a trip.  paidBy is a map of participantId to amount
// contributed.  manualSplit holds per‑participant split overrides when
// splitType is 'manual'.  createdBy indicates the UID of the creator.
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

// Payment record between two participants.  createdBy indicates the UID of
// whoever recorded the payment.
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

// Trip document stored in Firestore.  participantIds is a derived array of
// registered participants' UIDs used for efficient queries.
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

// ---- Main Page Component ----

export default function TripCostPage() {
  // --- Authentication state ---
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // --- Auth form state ---
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  // --- Data collections ---
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);

  // --- Dashboard & participant add form state ---
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState('');
  const [customParticipantName, setCustomParticipantName] = useState('');
  const [newTripName, setNewTripName] = useState('');

  // --- Debounced saving timer ---
  const [saveTimer, setSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Listen for Firebase auth state changes and load the user's profile.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        // Fetch the user profile from Firestore
        const profileRef = doc(db, 'tripCostApp/users', firebaseUser.uid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const data = profileSnap.data() as Omit<UserProfile, 'uid'>;
          setUserProfile({ uid: profileSnap.id, ...data });
        } else {
          setUserProfile(null);
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

  // Load all registered users when the current user is an admin.
  useEffect(() => {
    if (!userProfile?.isAdmin) return;
    const loadUsers = async () => {
      const snap = await getDocs(collection(db, 'tripCostApp/users'));
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<UserProfile, 'uid'>;
        list.push({ uid: d.id, ...data });
      });
      setAllUsers(list);
    };
    loadUsers().catch(() => {
      // ignore errors; they will surface in UI when used
    });
  }, [userProfile]);

  // Subscribe to trips collection for the current user.  Admins see all trips;
  // regular users only see trips where their UID appears in participantIds.
  useEffect(() => {
    if (!user) return;
    const tripsRef = collection(db, 'tripCostApp/trips');
    const q = userProfile?.isAdmin
      ? tripsRef
      : query(tripsRef, where('participantIds', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list: Trip[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<Trip, 'id'>;
        list.push({ id: d.id, ...data });
      });
      setTrips(list);
    });
    return () => unsub();
  }, [user, userProfile]);

  // Listen for changes on the currently selected trip to enable live updates.
  useEffect(() => {
    if (!selectedTrip) return;
    const ref = doc(db, 'tripCostApp/trips', selectedTrip.id);
    const unsub = onSnapshot(ref, (d) => {
      if (!d.exists()) return;
      const data = d.data() as Omit<Trip, 'id'>;
      setSelectedTrip({ id: d.id, ...data });
      setPeople((data.participants || []).map((p) => ({ id: p.id, name: p.name })));
      setExpenses(data.expenses || []);
      setAllPayments(data.payments || []);
    });
    return () => unsub();
  }, [selectedTrip]);

  // Debounce saving the current trip when its local data changes.
  const saveTrip = useCallback(async () => {
    if (!selectedTrip || !user) return;
    // Derive participantIds from participants with userId
    const participantIds = Array.from(
      new Set((selectedTrip.participants || [])
        .map((p) => p.userId)
        .filter(Boolean) as string[]),
    );
    const updated: Trip = {
      ...selectedTrip,
      expenses: expenses,
      payments: allPayments,
      participantIds: participantIds,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };
    try {
      await setDoc(doc(db, 'tripCostApp/trips', selectedTrip.id), updated, { merge: true });
    } catch (err: unknown) {
      console.error('Failed to save trip', err);
    }
  }, [selectedTrip, expenses, allPayments, user]);

  // Persist local changes to Firestore after a short debounce.  We disable
  // exhaustive-deps here because saveTimer is intentionally omitted to avoid
  // infinite loops.
  useEffect(() => {
    if (!selectedTrip) return;
    if (saveTimer) clearTimeout(saveTimer);
    const timer = setTimeout(() => {
      saveTrip();
    }, 1500);
    setSaveTimer(timer);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, expenses, allPayments, selectedTrip, saveTrip]);

  // Handle signup/login form submission
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      // Log in
      try {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        setAuthError('');
      } catch (err: unknown) {
        const msg = err instanceof Error && err.message ? err.message : 'Failed to sign in.';
        setAuthError(msg);
      }
    } else {
      // Sign up
      if (!firstName.trim() || !lastInitial.trim()) {
        setAuthError('Please provide your first name and last initial.');
        return;
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const uid = cred.user.uid;
        const displayName = `${firstName.trim()} ${lastInitial.trim().toUpperCase()}`;
        await setDoc(doc(db, 'tripCostApp/users', uid), {
          email: authEmail.toLowerCase(),
          firstName: firstName.trim(),
          lastInitial: lastInitial.trim().toUpperCase(),
          displayName,
          isAdmin: authEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
          createdAt: serverTimestamp() as unknown as Timestamp,
        });
        setAuthError('');
      } catch (err: unknown) {
        const msg = err instanceof Error && err.message ? err.message : 'Failed to create account.';
        setAuthError(msg);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // Create a new trip (admin only)
  const handleCreateTrip = async () => {
    const name = newTripName.trim();
    if (!name || !user || !userProfile?.isAdmin) return;
    const tripId = crypto.randomUUID();
    const newTrip: Omit<Trip, 'id'> = {
      name,
      createdBy: user.uid,
      createdAt: serverTimestamp() as unknown as Timestamp,
      updatedAt: serverTimestamp() as unknown as Timestamp,
      participants: [],
      participantIds: [],
      expenses: [],
      payments: [],
    };
    try {
      await setDoc(doc(db, 'tripCostApp/trips', tripId), newTrip);
      setNewTripName('');
    } catch (err: unknown) {
      console.error('Failed to create trip', err);
    }
  };

  // Delete a trip (admin only)
  const handleDeleteTrip = async (trip: Trip) => {
    if (!userProfile?.isAdmin) return;
    if (!window.confirm(`Are you sure you want to delete the trip "${trip.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'tripCostApp/trips', trip.id));
      // If the current trip was deleted, return to dashboard
      if (selectedTrip?.id === trip.id) setSelectedTrip(null);
    } catch (err: unknown) {
      console.error('Failed to delete trip', err);
    }
  };

  // Open a trip and load its data into local state
  const handleOpenTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    setPeople((trip.participants || []).map((p) => ({ id: p.id, name: p.name })));
    setExpenses(trip.expenses || []);
    setAllPayments(trip.payments || []);
  };

  // Add a participant to the current trip (admin only)
  const handleAddParticipant = () => {
    if (!userProfile?.isAdmin || !user || !selectedTrip) return;
    let participant: TripParticipant | null = null;
    if (selectedUserIdToAdd) {
      const u = allUsers.find((u) => u.uid === selectedUserIdToAdd);
      if (!u) return;
      participant = {
        id: crypto.randomUUID(),
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
    // Update local people list
    setPeople((prev) => [...prev, { id: participant!.id, name: participant!.name }]);
    // Update trip participants and participantIds in memory; auto‑save effect will persist
    setSelectedTrip((prev) =>
      prev
        ? {
            ...prev,
            participants: [...prev.participants, participant!],
            participantIds: [
              ...new Set([
                ...prev.participantIds,
                ...(participant!.userId ? [participant!.userId] : []),
              ]),
            ],
          }
        : prev,
    );
    // Reset form
    setSelectedUserIdToAdd('');
    setCustomParticipantName('');
  };

  // Render the login/signup form
  const renderAuthForm = () => (
    <div className="flex justify-center items-center mt-10">
      <div className="w-full max-w-md bg-white p-6 border rounded shadow">
        <h2 className="text-xl font-semibold mb-4 text-center">
          {isLogin ? 'Log in to Trip Cost' : 'Create a Trip Cost account'}
        </h2>
        {authError && <p className="text-red-600 text-sm mb-2">{authError}</p>}
        <form onSubmit={handleAuthSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          {!isLogin && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full p-2 border rounded"
                  required
                />
              </div>
              <div className="w-24">
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial</label>
                <input
                  type="text"
                  value={lastInitial}
                  onChange={(e) => setLastInitial(e.target.value)}
                  className="w-full p-2 border rounded"
                  maxLength={1}
                  required
                />
              </div>
            </div>
          )}
          <button
            type="submit"
            className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
          >
            {isLogin ? 'Log In' : 'Sign Up'}
          </button>
        </form>
        <div className="mt-4 text-sm text-center">
          {isLogin ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                onClick={() => {
                  setIsLogin(false);
                  setAuthError('');
                }}
                className="text-purple-600 hover:underline"
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
                className="text-purple-600 hover:underline"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Render the list of trips for the logged in user
  const renderTripList = () => (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">My Trips</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">{userProfile?.displayName}</span>
          <button
            onClick={handleLogout}
            className="bg-gray-200 px-3 py-1 rounded text-sm hover:bg-gray-300"
          >
            Log out
          </button>
        </div>
      </div>
      {userProfile?.isAdmin && (
        <div className="mb-6 flex items-end gap-2">
          <input
            type="text"
            value={newTripName}
            onChange={(e) => setNewTripName(e.target.value)}
            placeholder="New trip name"
            className="flex-1 p-2 border rounded"
          />
          <button
            onClick={handleCreateTrip}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Create Trip
          </button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {trips.map((trip) => (
          <div
            key={trip.id}
            className="p-4 border rounded shadow flex flex-col justify-between"
          >
            <div>
              <h2 className="text-lg font-semibold mb-1">{trip.name}</h2>
              <p className="text-sm text-gray-600">
                {trip.participants.length} participant{trip.participants.length === 1 ? '' : 's'}
              </p>
              <p className="text-sm text-gray-600">
                {trip.expenses.length} expense{trip.expenses.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => handleOpenTrip(trip)}
                className="flex-1 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"
              >
                Open
              </button>
              {userProfile?.isAdmin && (
                <button
                  onClick={() => handleDeleteTrip(trip)}
                  className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 text-sm"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {trips.length === 0 && (
          <p className="text-gray-600">No trips yet.</p>
        )}
      </div>
    </div>
  );

  // Render the trip detail view.  This is a placeholder while the calculator
  // integration is implemented.
  const renderTripDetail = () => (
    <div className="max-w-4xl mx-auto p-4">
      <button
        onClick={() => setSelectedTrip(null)}
        className="mb-4 text-blue-600 hover:underline"
      >
        ← Back to trips
      </button>
      <h1 className="text-2xl font-bold mb-2">{selectedTrip?.name}</h1>
      <p className="mb-4 text-sm text-gray-600">
        Participants: {selectedTrip?.participants.length}
      </p>
      {userProfile?.isAdmin && (
        <div className="mb-6 border p-4 rounded">
          <h2 className="font-semibold mb-2">Add Participant</h2>
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">
                Registered user
              </label>
              <select
                value={selectedUserIdToAdd}
                onChange={(e) => setSelectedUserIdToAdd(e.target.value)}
                className="w-full p-2 border rounded"
              >
                <option value="">— Select a user —</option>
                {allUsers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Custom name</label>
              <input
                type="text"
                value={customParticipantName}
                onChange={(e) => setCustomParticipantName(e.target.value)}
                placeholder="e.g., Alex R"
                className="w-full p-2 border rounded"
              />
            </div>
            <button
              onClick={handleAddParticipant}
              className="bg-blue-600 text-white px-4 py-2 rounded"
            >
              Add
            </button>
          </div>
        </div>
      )}
      {/* Placeholder for calculator UI */}
      <div className="p-6 border rounded bg-gray-50 text-gray-600">
        <p className="mb-2">Trip calculator coming soon.</p>
        <p className="text-sm">The full expense and payment editor will live here.</p>
      </div>
    </div>
  );

  if (authLoading) {
    return <div className="p-8 text-center">Loading…</div>;
  }

  // Render auth form if no user is logged in
  if (showAuth) {
    return renderAuthForm();
  }

  // If a trip is selected, render its details; otherwise, show the list
  return selectedTrip ? renderTripDetail() : renderTripList();
}