"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, isAdmin as isAdminUser } from './lib/firebase';
import {
  addCustomTag,
  claimPersonB,
  createConflict,
  createTracker,
  deleteConflict,
  fetchKnownUsers,
  saveReflectionDraft,
  setResolved,
  submitReflection,
  updateConflict,
  updateConflictShared,
  watchConflicts,
  watchReflections,
  watchTracker,
  watchUserTrackers,
  type KnownUser,
} from './lib/db';
import { userDoc } from '../trip-cost/db';
import { ADMIN_EMAIL } from '../trip-cost/firebaseConfig';
import type { Conflict, Reflection, Tracker } from './lib/types';

interface ConflictContextValue {
  user: User | null;
  authLoading: boolean;
  isAdmin: boolean;
  trackers: Tracker[];
  activeTracker: Tracker | null;
  conflicts: Conflict[];
  activeConflict: Conflict | null;
  reflections: Reflection[];
  trackerLoading: boolean;
  conflictsLoading: boolean;
  selectTracker: (id: string | null) => void;
  selectConflict: (id: string | null) => void;
  createNewTracker: (input: {
    name: string;
    personAName: string;
    personBEmail: string | null;
    personBName: string;
  }) => Promise<string>;
  claimSide: (trackerId: string) => Promise<void>;
  addConflict: (input: {
    title: string;
    date: string;
    severity: Conflict['severity'];
    tags: string[];
    summary?: string;
  }) => Promise<string>;
  editConflict: (
    conflictId: string,
    patch: Partial<Pick<Conflict, 'title' | 'date' | 'severity' | 'tags' | 'summary'>>,
  ) => Promise<void>;
  removeConflict: (conflictId: string) => Promise<void>;
  updateShared: (
    conflictId: string,
    patch: Partial<Pick<Conflict, 'sharedClarification' | 'personARealMeaning' | 'personBRealMeaning'>>,
  ) => Promise<void>;
  markResolved: (conflictId: string, side: 'personA' | 'personB', resolved: boolean) => Promise<void>;
  saveDraft: (
    conflictId: string,
    side: 'personA' | 'personB',
    data: Omit<Reflection, 'id' | 'conflictId' | 'submittedAt' | 'createdAt' | 'updatedAt'>,
  ) => Promise<void>;
  submitReflectionFn: (
    conflictId: string,
    side: 'personA' | 'personB',
    data: Omit<Reflection, 'id' | 'conflictId' | 'submittedAt' | 'createdAt' | 'updatedAt'>,
  ) => Promise<void>;
  addTrackerCustomTag: (tag: string) => Promise<void>;
  knownUsers: KnownUser[];
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const ConflictContext = createContext<ConflictContextValue | undefined>(undefined);

export const ConflictProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(!auth.currentUser);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [activeTrackerId, setActiveTrackerId] = useState<string | null>(null);
  const [activeTracker, setActiveTracker] = useState<Tracker | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!mountedRef.current) return;
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Load known users once after sign-in
  useEffect(() => {
    if (!user) { setKnownUsers([]); return; }
    fetchKnownUsers().then((users) => {
      if (mountedRef.current) setKnownUsers(users);
    }).catch(() => { /* non-critical */ });
  }, [user]);

  // Watch all trackers the user belongs to
  useEffect(() => {
    if (!user) { setTrackers([]); return; }
    const unsub = watchUserTrackers(user.uid, (list) => {
      if (mountedRef.current) setTrackers(list);
    });
    return () => unsub();
  }, [user]);

  // Watch active tracker
  useEffect(() => {
    if (!activeTrackerId) { setActiveTracker(null); return; }
    setTrackerLoading(true);
    const unsub = watchTracker(activeTrackerId, (tracker) => {
      if (!mountedRef.current) return;
      setActiveTracker(tracker);
      setTrackerLoading(false);
    });
    return () => unsub();
  }, [activeTrackerId]);

  // Watch conflicts for active tracker
  useEffect(() => {
    if (!activeTrackerId) { setConflicts([]); return; }
    setConflictsLoading(true);
    const unsub = watchConflicts(activeTrackerId, (list) => {
      if (!mountedRef.current) return;
      setConflicts(list);
      setConflictsLoading(false);
    });
    return () => unsub();
  }, [activeTrackerId]);

  // Watch reflections for active conflict
  useEffect(() => {
    if (!activeTrackerId || !activeConflictId) { setReflections([]); return; }
    const unsub = watchReflections(activeTrackerId, activeConflictId, (list) => {
      if (mountedRef.current) setReflections(list);
    });
    return () => unsub();
  }, [activeTrackerId, activeConflictId]);

  const activeConflict = useMemo(
    () => conflicts.find((c) => c.id === activeConflictId) ?? null,
    [conflicts, activeConflictId],
  );

  const requireUser = useCallback(() => {
    if (!user) throw new Error('Must be signed in');
    return user;
  }, [user]);

  const requireTracker = useCallback(() => {
    if (!activeTrackerId) throw new Error('No tracker selected');
    return activeTrackerId;
  }, [activeTrackerId]);

  const selectTracker = useCallback((id: string | null) => {
    setActiveTrackerId(id);
    setActiveConflictId(null);
  }, []);

  const selectConflict = useCallback((id: string | null) => {
    setActiveConflictId(id);
  }, []);

  const createNewTracker = useCallback(async (input: {
    name: string;
    personAName: string;
    personBEmail: string | null;
    personBName: string;
  }) => {
    const actor = requireUser();
    const id = await createTracker({
      name: input.name,
      personAUid: actor.uid,
      personAName: input.personAName || actor.displayName || actor.email || 'Person A',
      personBEmail: input.personBEmail,
      personBName: input.personBName || 'Person B',
    });
    setActiveTrackerId(id);
    return id;
  }, [requireUser]);

  const claimSide = useCallback(async (trackerId: string) => {
    const actor = requireUser();
    await claimPersonB(trackerId, actor.uid);
  }, [requireUser]);

  const addConflict = useCallback(async (input: {
    title: string;
    date: string;
    severity: Conflict['severity'];
    tags: string[];
    summary?: string;
  }) => {
    const actor = requireUser();
    const tid = requireTracker();
    return createConflict(tid, { ...input, createdBy: actor.uid });
  }, [requireUser, requireTracker]);

  const editConflict = useCallback(async (
    conflictId: string,
    patch: Partial<Pick<Conflict, 'title' | 'date' | 'severity' | 'tags' | 'summary'>>,
  ) => {
    const tid = requireTracker();
    await updateConflict(tid, conflictId, patch);
  }, [requireTracker]);

  const removeConflict = useCallback(async (conflictId: string) => {
    const tid = requireTracker();
    await deleteConflict(tid, conflictId);
    if (activeConflictId === conflictId) setActiveConflictId(null);
  }, [requireTracker, activeConflictId]);

  const updateShared = useCallback(async (
    conflictId: string,
    patch: Partial<Pick<Conflict, 'sharedClarification' | 'personARealMeaning' | 'personBRealMeaning'>>,
  ) => {
    const tid = requireTracker();
    await updateConflictShared(tid, conflictId, patch);
  }, [requireTracker]);

  const markResolved = useCallback(async (
    conflictId: string,
    side: 'personA' | 'personB',
    resolved: boolean,
  ) => {
    const tid = requireTracker();
    await setResolved(tid, conflictId, side, resolved);
  }, [requireTracker]);

  const saveDraft = useCallback(async (
    conflictId: string,
    side: 'personA' | 'personB',
    data: Omit<Reflection, 'id' | 'conflictId' | 'submittedAt' | 'createdAt' | 'updatedAt'>,
  ) => {
    const tid = requireTracker();
    await saveReflectionDraft(tid, conflictId, side, data);
  }, [requireTracker]);

  const submitReflectionFn = useCallback(async (
    conflictId: string,
    side: 'personA' | 'personB',
    data: Omit<Reflection, 'id' | 'conflictId' | 'submittedAt' | 'createdAt' | 'updatedAt'>,
  ) => {
    const tid = requireTracker();
    await submitReflection(tid, conflictId, side, data);
  }, [requireTracker]);

  const addTrackerCustomTag = useCallback(async (tag: string) => {
    const tid = requireTracker();
    await addCustomTag(tid, tag);
  }, [requireTracker]);

  const signInHandler = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUpHandler = useCallback(async (email: string, password: string, displayName?: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(credential.user, { displayName });
    }
    await setDoc(
      userDoc(credential.user.uid),
      {
        uid: credential.user.uid,
        email,
        displayName: displayName ?? email,
        isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, []);

  const signOutHandler = useCallback(async () => {
    await signOut(auth);
    setActiveTrackerId(null);
    setActiveConflictId(null);
  }, []);

  const value = useMemo<ConflictContextValue>(() => ({
    user,
    authLoading,
    isAdmin: isAdminUser(user),
    trackers,
    activeTracker,
    conflicts,
    activeConflict,
    reflections,
    trackerLoading,
    conflictsLoading,
    selectTracker,
    selectConflict,
    createNewTracker,
    claimSide,
    addConflict,
    editConflict,
    removeConflict,
    updateShared,
    markResolved,
    saveDraft,
    submitReflectionFn,
    addTrackerCustomTag,
    knownUsers,
    signIn: signInHandler,
    signUp: signUpHandler,
    signOut: signOutHandler,
  }), [
    user, authLoading, trackers, activeTracker, conflicts, activeConflict,
    reflections, trackerLoading, conflictsLoading,
    selectTracker, selectConflict, createNewTracker, claimSide,
    addConflict, editConflict, removeConflict, updateShared, markResolved,
    saveDraft, submitReflectionFn, addTrackerCustomTag, knownUsers,
    signInHandler, signUpHandler, signOutHandler,
  ]);

  return <ConflictContext.Provider value={value}>{children}</ConflictContext.Provider>;
};

export const useConflict = (): ConflictContextValue => {
  const ctx = useContext(ConflictContext);
  if (!ctx) throw new Error('useConflict must be used within ConflictProvider');
  return ctx;
};
