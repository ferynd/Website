'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  collection,
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

/*
 * Trip Cost Tool – Next.js Client Page
 *
 * Namespaced data model (isolated from your Calorie Tracker):
 *   artifacts/trip-cost/users/{uid}
 *   artifacts/trip-cost/trips/{tripId}
 *   artifacts/trip-cost/trips/{tripId}/audit/{logId}
 *
 * This replaces the previous ad-hoc paths like 'tripCostApp/users' and
 * 'tripCostApp/trips', which caused invalid segment errors. :contentReference[oaicite:2]{index=2}
 */

// ---- Type Definitions ----

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

// ---- Page Component ----

export default function TripCostPage() {
  // Authentication
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // Auth form
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  // Data
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // UI state
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState('');
  const [customParticipantName, setCustomParticipantName] = useState('');
  const [newTripName, setNewTripName] = useState('');

  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);


  // Listen for auth and load profile
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const profileSnap = await getDoc(userDoc(firebaseUser.uid));
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

  // Admin: load all registered users
  useEffect(() => {
    if (!userProfile?.isAdmin) return;
    const load = async () => {
      const snap = await getDocs(usersCol());
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<UserProfile, 'uid'>;
        list.push({ uid: d.id, ...data });
      });
      setAllUsers(list);
    };
    load().catch(() => {});
  }, [userProfile]);

  // Trips for current user
  useEffect(() => {
    if (!user) return;
    const base = tripsCol();
    const q = userProfile?.isAdmin ? base : query(base, where('participantIds', 'array-contains', user.uid));
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

  // Active trip snapshot
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

  // Admin-only: audit log for the active trip
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

  // Audit helper
  const writeAudit = useCallback(
    async (tripId: string, type: string, details?: unknown) => {
      try {
        await addDoc(tripAuditCol(tripId), {
          type,
          details: details ?? null,
          actorUid: user?.uid ?? null,
          actorEmail: user?.email ?? null,
          ts: serverTimestamp(),
        });
      } catch (e) {
        console.error('audit write failed', e);
      }
    },
    [user]
  );

  // Admin save for trip
  const saveTrip = useCallback(async () => {
    if (!selectedTrip || !user || !userProfile?.isAdmin) return;
    const participantIds = Array.from(
      new Set((selectedTrip.participants || []).map((p) => p.userId).filter(Boolean) as string[])
    );
    const updated: Trip = {
      ...selectedTrip,
      expenses,
      payments: allPayments,
      participantIds,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };
    try {
      await setDoc(tripDoc(selectedTrip.id), updated, { merge: true });
      await writeAudit(selectedTrip.id, 'trip_autosave', {
        participants: updated.participants.length,
        expenses: updated.expenses.length,
        payments: updated.payments.length,
      });
    } catch (err: unknown) {
      console.error('Failed to save trip', err);
    }
  }, [selectedTrip, expenses, allPayments, user, userProfile, writeAudit]);

  // Debounced autosave (admin only)
  useEffect(() => {
    if (!selectedTrip || !userProfile?.isAdmin) return;
    if (saveTimer) clearTimeout(saveTimer);
    const timer = setTimeout(() => saveTrip(), 1500);
    setSaveTimer(timer);
    return () => clearTimeout(timer);
  }, [people, expenses, allPayments, selectedTrip, userProfile, saveTrip, saveTimer]);

  // Auth submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      try {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        setAuthError('');
      } catch (err: unknown) {
        const msg = err instanceof Error && err.message ? err.message : 'Failed to sign in.';
        setAuthError(msg);
      }
    } else {
      if (!firstName.trim() || !lastInitial.trim()) {
        setAuthError('Please provide your first name and last initial.');
        return;
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const uid = cred.user.uid;
        const displayName = `${firstName.trim()} ${lastInitial.trim().toUpperCase()}`;
        await setDoc(userDoc(uid), {
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

  // Admin: create trip
  const handleCreateTrip = async () => {
    const name = newTripName.trim();
    if (!name || !user || !userProfile?.isAdmin) return;
    const tripId = crypto.randomUUID();
    const docData: Omit<Trip, 'id'> = {
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
      await setDoc(tripDoc(tripId), docData);
      await writeAudit(tripId, 'trip_created', { name });
      setNewTripName('');
    } catch (err: unknown) {
      console.error('Failed to create trip', err);
    }
  };

  // Admin: delete trip
  const handleDeleteTrip = async (trip: Trip) => {
    if (!userProfile?.isAdmin) return;
    if (!window.confirm(`Delete the trip "${trip.name}"? This cannot be undone.`)) return;
    try {
      await writeAudit(trip.id, 'trip_deleted', { name: trip.name });
      await deleteDoc(tripDoc(trip.id));
      if (selectedTrip?.id === trip.id) setSelectedTrip(null);
    } catch (err: unknown) {
      console.error('Failed to delete trip', err);
    }
  };

  // Admin: open trip and add participant
  const handleOpenTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    setPeople((trip.participants || []).map((p) => ({ id: p.id, name: p.name })));
    setExpenses(trip.expenses || []);
    setAllPayments(trip.payments || []);
  };

  const handleAddParticipant = async () => {
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

    // Update local state; autosave will persist
    setPeople((prev) => [...prev, { id: participant!.id, name: participant!.name }]);
    setSelectedTrip((prev) =>
      prev
        ? {
            ...prev,
            participants: [...prev.participants, participant!],
            participantIds: [
              ...new Set([...prev.participantIds, ...(participant!.userId ? [participant!.userId] : [])]),
            ],
          }
        : prev
    );
    setSelectedUserIdToAdd('');
    setCustomParticipantName('');
    await writeAudit(selectedTrip.id, 'participant_added', { participant });
  };

  // --- Renderers ---

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
          <button type="submit" className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700">
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

  const renderTripList = () => (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">My Trips</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">{userProfile?.displayName}</span>
          <button onClick={handleLogout} className="bg-gray-200 px-3 py-1 rounded text-sm hover:bg-gray-300">
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
          <button onClick={handleCreateTrip} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            Create Trip
          </button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {trips.map((trip) => (
          <div key={trip.id} className="p-4 border rounded shadow flex flex-col justify-between">
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
        {trips.length === 0 && <p className="text-gray-600">No trips yet.</p>}
      </div>
    </div>
  );

  const renderTripDetail = () => (
    <div className="max-w-4xl mx-auto p-4">
      <button onClick={() => setSelectedTrip(null)} className="mb-4 text-blue-600 hover:underline">
        ← Back to trips
      </button>
      <h1 className="text-2xl font-bold mb-2">{selectedTrip?.name}</h1>
      <p className="mb-4 text-sm text-gray-600">Participants: {selectedTrip?.participants.length}</p>

      {userProfile?.isAdmin && (
        <div className="mb-6 border p-4 rounded">
          <h2 className="font-semibold mb-2">Add Participant</h2>
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Registered user</label>
              <select
                value={selectedUserIdToAdd}
                onChange={(e) => setSelectedUserIdToAdd(e.target.value)}
                className="w-full p-2 border rounded"
              >
                <option value="">Select a user</option>
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
            <button onClick={handleAddParticipant} className="bg-blue-600 text-white px-4 py-2 rounded">
              Add
            </button>
          </div>
        </div>
      )}

      <div className="p-6 border rounded bg-gray-50 text-gray-600">
        <p className="mb-2">Trip calculator coming soon.</p>
        <p className="text-sm">The full expense and payment editor will live here.</p>
      </div>

      {userProfile?.isAdmin && (
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Audit Log</h3>
          {auditEntries.length === 0 ? (
            <p className="text-sm text-gray-600">No activity yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {auditEntries.map((a) => (
                <li key={a.id} className="border p-2 rounded bg-white">
                  <div className="flex justify-between">
                    <span className="font-medium">{a.type}</span>
                    <span className="text-gray-500">
                      {a.ts ? new Date((a.ts as unknown as { seconds: number }).seconds * 1000).toLocaleString() : ''}
                    </span>
                  </div>
                  <div className="text-gray-700">
                    by {a.actorEmail || a.actorUid || 'unknown'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  if (authLoading) return <div className="p-8 text-center">Loading…</div>;
  if (showAuth) return renderAuthForm();
  return selectedTrip ? renderTripDetail() : renderTripList();
}
