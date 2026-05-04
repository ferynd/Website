"use client";

export const ROOT_COLLECTION = 'artifacts';
export const APP_ID = 'conflict-tracker';

import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Conflict, Reflection, ReflectionInput, SharedSectionPatch, Tracker } from './types';

type Unsub = () => void;

// ── Collection helpers ──────────────────────────────────────────────────────

const trackersCol = (): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'trackers');

const trackerDoc = (trackerId: string): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'trackers', trackerId);

const conflictsCol = (trackerId: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'trackers', trackerId, 'conflicts');

const conflictDoc = (trackerId: string, conflictId: string): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'trackers', trackerId, 'conflicts', conflictId);

const reflectionsCol = (trackerId: string, conflictId: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'trackers', trackerId, 'conflicts', conflictId, 'reflections');

const reflectionDoc = (
  trackerId: string,
  conflictId: string,
  side: 'personA' | 'personB',
): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'trackers', trackerId, 'conflicts', conflictId, 'reflections', side);

// ── Utilities ───────────────────────────────────────────────────────────────

export const stripUndefined = <T extends Record<string, unknown>>(input: T): T => {
  const entries = Object.entries(input).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
};

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const computeStatus = (
  personAResolved: boolean,
  personBResolved: boolean,
): Conflict['status'] => {
  if (personAResolved && personBResolved) return 'resolved';
  if (personAResolved || personBResolved) return 'partially_resolved';
  return 'open';
};

// ── Tracker CRUD ────────────────────────────────────────────────────────────

export const createTracker = async (input: {
  name: string;
  personAUid: string;
  personAName: string;
  personBEmail: string | null;
  personBName: string;
}): Promise<string> => {
  const ref = doc(trackersCol());
  const normalizedEmail = input.personBEmail ? input.personBEmail.toLowerCase().trim() : null;
  const memberEmails = normalizedEmail ? [normalizedEmail] : [];
  await setDoc(ref, {
    name: input.name,
    personAUid: input.personAUid,
    personAName: input.personAName,
    personBUid: null,
    personBEmail: normalizedEmail,
    personBName: input.personBName,
    memberUids: [input.personAUid],
    memberEmails,
    customTags: [],
    createdBy: input.personAUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

/**
 * Claim the Person B role for the given user.
 * Rejected if:
 *  - personBUid is already set (by a different user)
 *  - the user email doesn't match personBEmail and they are not admin
 */
export const claimPersonBSide = async (
  trackerId: string,
  uid: string,
  userEmail: string | null,
  isAdmin: boolean,
): Promise<void> => {
  const snap = await getDoc(trackerDoc(trackerId));
  if (!snap.exists()) throw new Error('Tracker not found.');

  const data = snap.data() as Tracker;

  if (data.personBUid) {
    if (data.personBUid === uid) return; // already claimed by this user — no-op
    throw new Error('Person B has already been claimed by another user.');
  }

  const emailMatches =
    userEmail && data.personBEmail
      ? userEmail.toLowerCase() === data.personBEmail.toLowerCase()
      : false;

  if (!emailMatches && !isAdmin) {
    throw new Error(
      'You can only claim Person B if your email matches the invitation, or you are an admin.',
    );
  }

  await updateDoc(trackerDoc(trackerId), {
    personBUid: uid,
    memberUids: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
};

export const addCustomTag = async (
  trackerId: string,
  tag: string,
): Promise<void> => {
  const snap = await getDoc(trackerDoc(trackerId));
  if (!snap.exists()) return;
  const existing = ensureStringArray((snap.data() as Record<string, unknown>).customTags);
  if (existing.includes(tag)) return;
  await updateDoc(trackerDoc(trackerId), {
    customTags: [...existing, tag],
    updatedAt: serverTimestamp(),
  });
};

export const watchTracker = (
  trackerId: string,
  onData: (tracker: Tracker | null, error?: FirestoreError) => void,
): Unsub =>
  onSnapshot(
    trackerDoc(trackerId),
    (snap) => {
      if (!snap.exists()) { onData(null); return; }
      const d = snap.data() as Omit<Tracker, 'id'>;
      onData({ id: snap.id, ...d });
    },
    (err) => onData(null, err),
  );

/**
 * Watch all trackers this user belongs to.
 * Runs two parallel listeners:
 *  1. memberUids array-contains uid  (accounts for UID-based membership)
 *  2. memberEmails array-contains email  (accounts for invited-but-unclaimed)
 * Results are merged and de-duplicated.
 */
export const watchUserTrackers = (
  uid: string,
  email: string | null,
  onData: (trackers: Tracker[], error?: FirestoreError) => void,
): Unsub => {
  let uidList: Tracker[] = [];
  let emailList: Tracker[] = [];
  const initialized = { uid: false, email: false };

  const merge = () => {
    const seen = new Set<string>();
    const merged: Tracker[] = [];
    for (const t of [...uidList, ...emailList]) {
      if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
    }
    onData(merged);
  };

  const qUid = query(trackersCol(), where('memberUids', 'array-contains', uid));
  const unsubUid = onSnapshot(
    qUid,
    (snap) => {
      uidList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tracker, 'id'>) }));
      initialized.uid = true;
      if (initialized.email) merge();
    },
    (err) => onData([], err),
  );

  if (email) {
    const qEmail = query(trackersCol(), where('memberEmails', 'array-contains', email));
    const unsubEmail = onSnapshot(
      qEmail,
      (snap) => {
        emailList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tracker, 'id'>) }));
        initialized.email = true;
        if (initialized.uid) merge();
      },
      (err) => onData([], err),
    );
    return () => { unsubUid(); unsubEmail(); };
  }

  // No email — resolve immediately once uid listener fires
  initialized.email = true;
  return () => unsubUid();
};

// ── Conflict CRUD ───────────────────────────────────────────────────────────

export const createConflict = async (
  trackerId: string,
  input: {
    title: string;
    date: string;
    severity: Conflict['severity'];
    tags: string[];
    summary?: string;
    createdBy: string;
  },
): Promise<string> => {
  const ref = doc(conflictsCol(trackerId));
  await setDoc(ref, stripUndefined({
    trackerId,
    title: input.title,
    date: input.date,
    severity: input.severity,
    tags: input.tags,
    summary: input.summary,
    personARealMeaning: undefined,
    personBRealMeaning: undefined,
    sharedClarification: undefined,
    sharedOwnershipNotes: undefined,
    sharedNextSteps: undefined,
    sharedUpdatedBy: undefined,
    sharedUpdatedAt: undefined,
    personAResolved: false,
    personBResolved: false,
    status: 'open' as Conflict['status'],
    hasReflectionA: false,
    hasReflectionB: false,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return ref.id;
};

export const updateConflict = async (
  trackerId: string,
  conflictId: string,
  patch: Partial<Pick<Conflict, 'title' | 'date' | 'severity' | 'tags' | 'summary'>>,
): Promise<void> => {
  await updateDoc(conflictDoc(trackerId, conflictId), {
    ...stripUndefined(patch as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
};

export const updateConflictShared = async (
  trackerId: string,
  conflictId: string,
  patch: SharedSectionPatch,
  updatedByUid: string,
): Promise<void> => {
  await updateDoc(conflictDoc(trackerId, conflictId), {
    ...stripUndefined(patch as Record<string, unknown>),
    sharedUpdatedBy: updatedByUid,
    sharedUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const setResolved = async (
  trackerId: string,
  conflictId: string,
  side: 'personA' | 'personB',
  resolved: boolean,
): Promise<void> => {
  const field = side === 'personA' ? 'personAResolved' : 'personBResolved';
  const snap = await getDoc(conflictDoc(trackerId, conflictId));
  const data = snap.exists() ? (snap.data() as Partial<Conflict>) : null;
  const aResolved = side === 'personA' ? resolved : !!(data?.personAResolved);
  const bResolved = side === 'personB' ? resolved : !!(data?.personBResolved);
  await updateDoc(conflictDoc(trackerId, conflictId), {
    [field]: resolved,
    status: computeStatus(aResolved, bResolved),
    updatedAt: serverTimestamp(),
  });
};

export const deleteConflict = async (
  trackerId: string,
  conflictId: string,
): Promise<void> => {
  const refsSnap = await getDocs(reflectionsCol(trackerId, conflictId));
  for (const r of refsSnap.docs) {
    await deleteDoc(r.ref);
  }
  await deleteDoc(conflictDoc(trackerId, conflictId));
};

export const watchConflicts = (
  trackerId: string,
  onData: (conflicts: Conflict[], error?: FirestoreError) => void,
): Unsub => {
  const q = query(conflictsCol(trackerId), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const conflicts = snap.docs.map((d) => {
        const data = d.data() as Omit<Conflict, 'id'>;
        return { id: d.id, ...data, tags: ensureStringArray(data.tags) };
      });
      onData(conflicts);
    },
    (err) => onData([], err),
  );
};

// ── Reflection CRUD ─────────────────────────────────────────────────────────

export const saveReflectionDraft = async (
  trackerId: string,
  conflictId: string,
  side: 'personA' | 'personB',
  authorUid: string,
  input: ReflectionInput,
): Promise<void> => {
  const ref = reflectionDoc(trackerId, conflictId, side);
  await setDoc(
    ref,
    stripUndefined({
      ...input,
      id: side,
      person: side,
      conflictId,
      authorUid,
      submittedAt: null,
      tags: ensureStringArray(input.tags),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true },
  );
  const flag = side === 'personA' ? 'hasReflectionA' : 'hasReflectionB';
  await updateDoc(conflictDoc(trackerId, conflictId), {
    [flag]: true,
    updatedAt: serverTimestamp(),
  });
};

export const submitReflection = async (
  trackerId: string,
  conflictId: string,
  side: 'personA' | 'personB',
  authorUid: string,
  input: ReflectionInput,
): Promise<void> => {
  const ref = reflectionDoc(trackerId, conflictId, side);
  await setDoc(
    ref,
    stripUndefined({
      ...input,
      id: side,
      person: side,
      conflictId,
      authorUid,
      submittedAt: serverTimestamp(),
      tags: ensureStringArray(input.tags),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true },
  );
  const flag = side === 'personA' ? 'hasReflectionA' : 'hasReflectionB';
  await updateDoc(conflictDoc(trackerId, conflictId), {
    [flag]: true,
    updatedAt: serverTimestamp(),
  });
};

export const watchReflections = (
  trackerId: string,
  conflictId: string,
  onData: (reflections: Reflection[], error?: FirestoreError) => void,
): Unsub =>
  onSnapshot(
    reflectionsCol(trackerId, conflictId),
    (snap) => {
      const reflections = snap.docs.map((d) => {
        const data = d.data() as Omit<Reflection, 'id'>;
        return { id: d.id as 'personA' | 'personB', ...data, tags: ensureStringArray(data.tags) };
      });
      onData(reflections);
    },
    (err) => onData([], err),
  );

// ── User lookup ─────────────────────────────────────────────────────────────

export interface KnownUser {
  uid: string;
  email: string;
  displayName: string;
}

export const fetchKnownUsers = async (): Promise<KnownUser[]> => {
  try {
    const usersCol = collection(db, 'artifacts', 'trip-cost', 'users');
    const q = query(usersCol, limit(100));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        email: typeof data.email === 'string' ? data.email : '',
        displayName: typeof data.displayName === 'string' ? data.displayName : d.id,
      };
    }).filter((u) => u.email);
  } catch {
    return [];
  }
};

export {
  trackerDoc,
  conflictDoc,
  conflictsCol,
  reflectionDoc,
  reflectionsCol,
};
