'use client';

// ===============================
// CONFIGURATION
// ===============================
// None

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
  deleteDoc,
  getDoc,
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
  userDoc,
  tripsCol,
  tripDoc,
} from './db';
import ConfirmDeleteModal from './components/TripDetail/ConfirmDeleteModal';
import type {
  UserProfile,
  Trip,
} from './pageTypes';
import AuthForm from './components/AuthForm';
import TripList from './components/TripList';
import TripDetail from './components/TripDetail/TripDetail';
import { TripProvider } from './TripContext';

export default function TripCostPage() {
  // auth state
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // auth form state
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  // trips
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [newTripName, setNewTripName] = useState('');

  // load auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        const profileRef = userDoc(firebaseUser.uid);
        const snap = await getDoc(profileRef);
        if (snap.exists()) {
          const data = snap.data() as Omit<UserProfile, 'uid'>;
          setUserProfile({ uid: snap.id, ...data });
        }
      } else {
        setUser(null);
        setUserProfile(null);
        setTrips([]);
        setSelectedTripId(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // load trips
  useEffect(() => {
    if (!user || !userProfile) {
      setTrips([]);
      return;
    }
    const q = userProfile.isAdmin
      ? query(tripsCol(), orderBy('createdAt', 'asc'))
      : query(
          tripsCol(),
          where('participantIds', 'array-contains', user.uid),
          orderBy('createdAt', 'asc')
        );
    const unsub = onSnapshot(q, (snap) => {
      setTrips(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Trip, 'id'>) }))
      );
    });
    return () => unsub();
  }, [user, userProfile]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        const cred = await createUserWithEmailAndPassword(
          auth,
          authEmail,
          authPassword
        );
        await setDoc(userDoc(cred.user.uid), {
          uid: cred.user.uid,
          email: authEmail,
          displayName: `${firstName} ${lastInitial}`,
          firstName,
          lastInitial,
          isAdmin: authEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
          createdAt: serverTimestamp() as Timestamp,
        });
      }
      setShowAuth(false);
    } catch (err: unknown) {
      if (err instanceof Error) setAuthError(err.message);
    }
  };

  const handleLogout = useCallback(async () => {
    await signOut(auth);
    setSelectedTripId(null);
  }, []);

  const handleCreateTrip = async () => {
    if (!userProfile || !newTripName.trim()) return;
    await addDoc(tripsCol(), {
      name: newTripName,
      createdBy: userProfile.uid,
      createdAt: serverTimestamp(),
      participants: [],
      participantIds: [],
      expenses: [],
      payments: [],
    });
    setNewTripName('');
  };

  const [confirmDeleteTrip, setConfirmDeleteTrip] = useState<Trip | null>(
    null
  );
  const handleDeleteTrip = (trip: Trip) => {
    setConfirmDeleteTrip(trip);
  };
  const confirmTripDeletion = async () => {
    if (!confirmDeleteTrip) return;
    await deleteDoc(tripDoc(confirmDeleteTrip.id));
    if (selectedTripId === confirmDeleteTrip.id) setSelectedTripId(null);
    setConfirmDeleteTrip(null);
  };

  if (authLoading) return <p>Loading...</p>;

  if (!user || showAuth) {
    return (
      <AuthForm
        isLogin={isLogin}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        firstName={firstName}
        setFirstName={setFirstName}
        lastInitial={lastInitial}
        setLastInitial={setLastInitial}
        authError={authError}
        onSubmit={handleAuthSubmit}
        toggleMode={() => {
          setIsLogin(!isLogin);
          setAuthError('');
        }}
      />
    );
  }

  if (selectedTripId) {
    return (
      <TripProvider selectedTripId={selectedTripId} userProfile={userProfile}>
        <TripDetail
          onBack={() => setSelectedTripId(null)}
          userProfile={userProfile}
        />
      </TripProvider>
    );
  }

  return (
    <>
      <TripList
        userProfile={userProfile}
        trips={trips}
        newTripName={newTripName}
        setNewTripName={setNewTripName}
        onCreateTrip={handleCreateTrip}
        onOpenTrip={(trip) => setSelectedTripId(trip.id)}
        onDeleteTrip={handleDeleteTrip}
        onLogout={handleLogout}
      />
      {confirmDeleteTrip && (
        <ConfirmDeleteModal
          itemType={`trip "${confirmDeleteTrip.name}"`}
          onConfirm={confirmTripDeletion}
          onCancel={() => setConfirmDeleteTrip(null)}
        />
      )}
    </>
  );
}
