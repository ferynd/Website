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
  claimPersonBSide,
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
import type { Conflict, ReflectionInput, SharedSectionPatch, Tracker } from './lib/types';
import type { Reflection } from './lib/types';

// ── Side derivation ──────────────────────────────────────────────────────────

/** Returns the side this user occupies in a tracker, or null if unclaimed. */
export const deriveUserSide = (
  tracker: Tracker | null,
  uid: string,
): 'personA' | 'personB' | null => {
  if (!tracker) return null;
  if (tracker.personAUid === uid) return 'personA';
  if (tracker.personBUid === uid) return 'personB';
  return null;
};

// ── Context shape ────────────────────────────────────────────────────────────

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
  /** Current user's side in activeTracker, or null if unclaimed. */
  userSide: 'personA' | 'personB' | null;
  selectTracker: (id: string | null) => void;
  selectConflict: (id: string | null) => void;
  createNewTracker: (input: {
    name: string;
    personAName: string;
    personBEmail: string | null;
    personBName: string;
  }) => Promise<string>;
  /**
   * Claim the Person B role in a tracker.
   * Rejected if personBUid already set by another user, or the caller's email
   * doesn't match the invitation (unless admin).
   */
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
  /**
   * Update the shared section fields. Editable by the tracker creator (Person A)
   * or admin. Person B can view but not edit.
   */
  updateShared: (conflictId: string, patch: SharedSectionPatch) => Promise<void>;
  /**
   * Mark the current user's side as resolved / unresolved.
   * Normal users can only toggle their own side. Admins can override.
   */
  markResolved: (conflictId: string, resolved: boolean) => Promise<void>;
  /**
   * Save a reflection draft. Side is derived from the tracker; the user must
   * have claimed a side (or be admin). On first save for an unclaimed user the
   * claim is attempted automatically.
   */
  saveDraft: (conflictId: string, input: ReflectionInput) => Promise<void>;
  /**
   * Submit a reflection (locks it and triggers the reveal when partner also submits).
   * Same side-derivation rules as saveDraft.
   */
  submitReflectionFn: (conflictId: string, input: ReflectionInput) => Promise<void>;
  addTrackerCustomTag: (tag: string) => Promise<void>;
  knownUsers: KnownUser[];
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const ConflictContext = createContext<ConflictContextValue | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────

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

  // Auth listener — clears all derived state on sign-out
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!mountedRef.current) return;
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setTrackers([]);
        setActiveTrackerId(null);
        setActiveTracker(null);
        setConflicts([]);
        setActiveConflictId(null);
        setReflections([]);
        setKnownUsers([]);
      }
    });
    return () => unsub();
  }, []);

  // Load known users once after sign-in
  useEffect(() => {
    if (!user) return;
    fetchKnownUsers().then((users) => {
      if (mountedRef.current) setKnownUsers(users);
    }).catch(() => { /* non-critical */ });
  }, [user]);

  // Watch all trackers this user belongs to (by UID and email)
  useEffect(() => {
    if (!user) { setTrackers([]); return; }
    const unsub = watchUserTrackers(user.uid, user.email, (list) => {
      if (mountedRef.current) setTrackers(list);
    });
    return () => unsub();
  }, [user]);

  // Watch active tracker document
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

  const userSide = useMemo(
    () => (user ? deriveUserSide(activeTracker, user.uid) : null),
    [activeTracker, user],
  );

  // ── Guard helpers ──────────────────────────────────────────────────────────

  const requireUser = useCallback(() => {
    if (!user) throw new Error('Must be signed in.');
    return user;
  }, [user]);

  const requireTracker = useCallback(() => {
    if (!activeTrackerId) throw new Error('No tracker selected.');
    return activeTrackerId;
  }, [activeTrackerId]);

  /** Resolves the effective side for the current user, enforcing ownership. */
  const resolveSide = useCallback(
    (actor: ReturnType<typeof requireUser>): 'personA' | 'personB' => {
      if (isAdminUser(actor)) {
        // Admin can act on either side; derive from tracker if possible
        const derived = deriveUserSide(activeTracker, actor.uid);
        if (derived) return derived;
        // Admin with no claimed side defaults to personA for ops that need it
        return 'personA';
      }
      const side = deriveUserSide(activeTracker, actor.uid);
      if (!side) {
        throw new Error(
          'You have not claimed a side in this tracker. Save your reflection first to claim a side.',
        );
      }
      return side;
    },
    [activeTracker],
  );

  /** Asserts the caller can edit the shared section (creator / Person A / admin). */
  const assertSharedSectionEditor = useCallback(
    (actor: ReturnType<typeof requireUser>) => {
      if (!activeTracker) throw new Error('No tracker selected.');
      const isCreator = activeTracker.createdBy === actor.uid;
      const isPersonA = activeTracker.personAUid === actor.uid;
      if (!isCreator && !isPersonA && !isAdminUser(actor)) {
        throw new Error(
          'Only the tracker creator, Person A, or an admin can edit the shared section.',
        );
      }
    },
    [activeTracker],
  );

  // ── Public actions ─────────────────────────────────────────────────────────

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
    await claimPersonBSide(trackerId, actor.uid, actor.email, isAdminUser(actor));
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
    patch: SharedSectionPatch,
  ) => {
    const actor = requireUser();
    assertSharedSectionEditor(actor);
    const tid = requireTracker();
    await updateConflictShared(tid, conflictId, patch, actor.uid);
  }, [requireUser, assertSharedSectionEditor, requireTracker]);

  const markResolved = useCallback(async (
    conflictId: string,
    resolved: boolean,
  ) => {
    const actor = requireUser();
    const tid = requireTracker();
    const side = resolveSide(actor);
    await setResolved(tid, conflictId, side, resolved);
  }, [requireUser, requireTracker, resolveSide]);

  const saveDraft = useCallback(async (
    conflictId: string,
    input: ReflectionInput,
  ) => {
    const actor = requireUser();
    const tid = requireTracker();

    let side = deriveUserSide(activeTracker, actor.uid);

    // If this user hasn't claimed yet, attempt to claim Person B automatically
    // (admin can also claim any side that's open)
    if (!side) {
      if (!activeTracker) throw new Error('No tracker selected.');
      if (activeTracker.personBUid) {
        throw new Error(
          'Both sides are already claimed. You cannot add a reflection to this tracker.',
        );
      }
      // Claim Person B (validate email match or admin)
      await claimPersonBSide(tid, actor.uid, actor.email, isAdminUser(actor));
      side = 'personB';
    }

    await saveReflectionDraft(tid, conflictId, side, actor.uid, input);
  }, [requireUser, requireTracker, activeTracker]);

  const submitReflectionFn = useCallback(async (
    conflictId: string,
    input: ReflectionInput,
  ) => {
    const actor = requireUser();
    const tid = requireTracker();

    let side = deriveUserSide(activeTracker, actor.uid);

    if (!side) {
      if (!activeTracker) throw new Error('No tracker selected.');
      if (activeTracker.personBUid) {
        throw new Error(
          'Both sides are already claimed. You cannot add a reflection to this tracker.',
        );
      }
      await claimPersonBSide(tid, actor.uid, actor.email, isAdminUser(actor));
      side = 'personB';
    }

    await submitReflection(tid, conflictId, side, actor.uid, input);
  }, [requireUser, requireTracker, activeTracker]);

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
    // State cleared by the onAuthStateChanged listener above
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
    userSide,
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
    reflections, trackerLoading, conflictsLoading, userSide,
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
