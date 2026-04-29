'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addDoc,
  arrayUnion,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import AuthForm from '../trip-cost/components/AuthForm';
import { auth, isAdmin, storage } from './lib/firebase';
import {
  coupleDoc,
  dateDoc,
  datesCol,
  DEFAULT_POOL_ITEM,
  DEFAULT_SETTINGS,
  ensureDateNightDefaults,
  modifierDoc,
  modifiersCol,
  rollDoc,
  rollsCol,
  sanitizeRollForWrite,
  settingsDoc,
} from './lib/db';
import { compressFile } from './lib/image';
import type {
  DateNightCoupleDoc,
  DateNightPoolItem,
  DateNightReview,
  DateNightRoll,
  DateNightSettings,
  RollCandidate,
} from './lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: auth defaults + review slots                 */
/* ------------------------------------------------------------ */
const REVIEW_SLOTS: Array<'a' | 'b'> = ['a', 'b'];

interface DateNightContextValue {
  user: User | null;
  authLoading: boolean;
  isAdmin: boolean;
  couple: DateNightCoupleDoc | null;
  participantRows: Array<{ uid: string; displayName: string }>;
  reviewSlotNames: Record<'a' | 'b', string>;
  settings: DateNightSettings;
  dates: DateNightPoolItem[];
  modifiers: DateNightPoolItem[];
  rolls: DateNightRoll[];
  pendingRoll: DateNightRoll | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveItem: (kind: 'date' | 'modifier', payload: Partial<DateNightPoolItem>, id?: string) => Promise<void>;
  deleteItem: (kind: 'date' | 'modifier', id: string) => Promise<void>;
  acceptCandidate: (candidate: RollCandidate, vetoCount: number) => Promise<void>;
  recordVeto: (candidate: RollCandidate) => Promise<void>;
  archivePendingRollWithoutReview: (rollId: string) => Promise<void>;
  deleteRoll: (rollId: string) => Promise<void>;
  upsertReview: (rollId: string, slot: 'a' | 'b', review: Omit<DateNightReview, 'submittedAt'>) => Promise<void>;
  addPhoto: (rollId: string, file: File) => Promise<void>;
  markCompleted: (rollId: string) => Promise<void>;
  saveParticipant: (uid: string, displayName: string) => Promise<void>;
}

const DateNightContext = createContext<DateNightContextValue | undefined>(undefined);


const requireParticipantAccess = (user: User | null, couple: DateNightCoupleDoc | null) => {
  const isDateNightParticipant = Boolean(
    user && (isAdmin(user) || (couple?.participantUids ?? []).includes(user.uid)),
  );
  if (!isDateNightParticipant) {
    throw new Error('Only Date Night participants can perform this action.');
  }
};

const incrementCounters = async (
  kind: 'date' | 'modifier',
  id: string,
  patch: { pick?: boolean; accept?: boolean; veto?: boolean; lastAcceptedAt?: string },
) => {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (patch.pick) payload.timesPicked = increment(1);
  if (patch.accept) payload.timesAccepted = increment(1);
  if (patch.veto) payload.timesVetoed = increment(1);
  if (patch.lastAcceptedAt) payload.lastAcceptedAt = patch.lastAcceptedAt;

  await updateDoc(kind === 'date' ? dateDoc(id) : modifierDoc(id), payload);
};

export function DateNightProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [couple, setCouple] = useState<DateNightCoupleDoc | null>(null);
  const [settings, setSettings] = useState<DateNightSettings>(DEFAULT_SETTINGS);
  const [dates, setDates] = useState<DateNightPoolItem[]>([]);
  const [modifiers, setModifiers] = useState<DateNightPoolItem[]>([]);
  const [rolls, setRolls] = useState<DateNightRoll[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser) {
        void ensureDateNightDefaults(nextUser);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setCouple(null);
      setDates([]);
      setModifiers([]);
      setRolls([]);
      return;
    }

    const unsubCouple = onSnapshot(coupleDoc(), (snap) => {
      if (snap.exists()) setCouple(snap.data() as DateNightCoupleDoc);
    });

    const unsubSettings = onSnapshot(settingsDoc(), (snap) => {
      if (snap.exists()) setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<DateNightSettings>) });
    });

    const unsubDates = onSnapshot(query(datesCol(), orderBy('createdAt', 'desc')), (snap) => {
      setDates(snap.docs.map((row) => ({ id: row.id, kind: 'date', ...(row.data() as Omit<DateNightPoolItem, 'id' | 'kind'>) })));
    });

    const unsubModifiers = onSnapshot(query(modifiersCol(), orderBy('createdAt', 'desc')), (snap) => {
      setModifiers(snap.docs.map((row) => ({ id: row.id, kind: 'modifier', ...(row.data() as Omit<DateNightPoolItem, 'id' | 'kind'>) })));
    });

    const unsubRolls = onSnapshot(query(rollsCol(), orderBy('createdAt', 'desc')), (snap) => {
      setRolls(
        snap.docs.map((row) => ({
          id: row.id,
          ...(row.data() as Omit<DateNightRoll, 'id'>),
          modifiers: (row.data().modifiers as DateNightRoll['modifiers']) ?? [],
          reviews: (row.data().reviews as DateNightRoll['reviews']) ?? {},
          photos: (row.data().photos as DateNightRoll['photos']) ?? [],
          vetoCount: Number(row.data().vetoCount ?? 0),
        })),
      );
    });

    return () => {
      unsubCouple();
      unsubSettings();
      unsubDates();
      unsubModifiers();
      unsubRolls();
    };
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
  }, []);

  const signOutHandler = useCallback(async () => {
    await signOut(auth);
  }, []);

  const saveItem = useCallback(async (kind: 'date' | 'modifier', payload: Partial<DateNightPoolItem>, id?: string) => {
    const editablePayload = {
      ...payload,
      baseWeight: Math.min(5, Math.max(0.1, Number(payload.baseWeight ?? 1))),
      updatedAt: serverTimestamp(),
    };

    if (kind === 'date') {
      if (id) await updateDoc(dateDoc(id), editablePayload);
      else await setDoc(doc(datesCol()), { ...DEFAULT_POOL_ITEM, ...editablePayload, createdAt: serverTimestamp() });
    } else if (id) await updateDoc(modifierDoc(id), editablePayload);
    else await setDoc(doc(modifiersCol()), { ...DEFAULT_POOL_ITEM, ...editablePayload, createdAt: serverTimestamp() });
  }, []);

  const deleteItem = useCallback(async (kind: 'date' | 'modifier', id: string) => {
    await deleteDoc(kind === 'date' ? dateDoc(id) : modifierDoc(id));
  }, []);

  const recordVeto = useCallback(async (candidate: RollCandidate) => {
    await incrementCounters('date', candidate.date.id, { veto: true });

    for (const modifier of candidate.modifiers) {
      await incrementCounters('modifier', modifier.id, { veto: true });
    }
  }, []);

  const acceptCandidate = useCallback(async (candidate: RollCandidate, vetoCount: number) => {
    const nowIso = new Date().toISOString();

    await incrementCounters('date', candidate.date.id, {
      pick: true,
      accept: true,
      lastAcceptedAt: nowIso,
    });

    for (const modifier of candidate.modifiers) {
      await incrementCounters('modifier', modifier.id, {
        pick: true,
        accept: true,
        lastAcceptedAt: nowIso,
      });
    }

    await addDoc(rollsCol(), {
      ...sanitizeRollForWrite({
        status: 'pending-review',
        date: { id: candidate.date.id, name: candidate.date.name, rarity: candidate.date.rarity },
        modifiers: candidate.modifiers.map((mod) => ({ id: mod.id, name: mod.name, rarity: mod.rarity })),
        photos: [],
        reviews: {},
        vetoCount,
      } as Omit<DateNightRoll, 'id' | 'createdAt' | 'updatedAt'>),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, []);

  const archivePendingRollWithoutReview = useCallback(async (rollId: string) => {
    requireParticipantAccess(user, couple);
    await updateDoc(rollDoc(rollId), { status: 'archived-no-review', updatedAt: serverTimestamp() });
  }, [couple, user]);

  const deleteRoll = useCallback(async (rollId: string) => {
    requireParticipantAccess(user, couple);
    await deleteDoc(rollDoc(rollId));
  }, [couple, user]);

  const upsertReview = useCallback(async (rollId: string, slot: 'a' | 'b', review: Omit<DateNightReview, 'submittedAt'>) => {
    requireParticipantAccess(user, couple);
    await updateDoc(rollDoc(rollId), {
      [`reviews.${slot}`]: { ...review, submittedAt: new Date().toISOString() },
      updatedAt: serverTimestamp(),
    });
  }, [couple, user]);

  const addPhoto = useCallback(async (rollId: string, file: File) => {
    requireParticipantAccess(user, couple);
    const prepared = await compressFile(file);
    const storagePath = `artifacts/date-night/uploads/${rollId}/${prepared.hash}.${prepared.extension}`;
    const objectRef = ref(storage, storagePath);
    await uploadBytes(objectRef, prepared.blob, { contentType: prepared.contentType });
    const url = await getDownloadURL(objectRef);

    await updateDoc(rollDoc(rollId), {
      photos: arrayUnion({ url, storagePath, uploadedAt: new Date().toISOString() }),
      updatedAt: serverTimestamp(),
    });
  }, [couple, user]);

  const markCompleted = useCallback(async (rollId: string) => {
    requireParticipantAccess(user, couple);
    await updateDoc(rollDoc(rollId), { status: 'completed', updatedAt: serverTimestamp() });
  }, [couple, user]);

  const saveParticipant = useCallback(async (uid: string, displayName: string) => {
    const current = couple ?? { participantUids: [], displayNames: {} };
    const mergedUids = current.participantUids.includes(uid)
      ? current.participantUids
      : [...current.participantUids, uid];

    await setDoc(coupleDoc(), {
      participantUids: mergedUids,
      displayNames: {
        ...current.displayNames,
        [uid]: displayName,
      },
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [couple]);

  const pendingRoll = useMemo(() => rolls.find((roll) => roll.status === 'pending-review') ?? null, [rolls]);

  const participantRows = useMemo(() => {
    const uids = couple?.participantUids ?? [];
    const displayMap = couple?.displayNames ?? {};
    return uids.map((uid) => ({ uid, displayName: displayMap[uid] ?? 'Unnamed participant' }));
  }, [couple]);

  const reviewSlotNames = useMemo(() => {
    const first = participantRows[0]?.displayName ?? 'Review A';
    const second = participantRows[1]?.displayName ?? 'Review B';
    return { a: first, b: second };
  }, [participantRows]);

  const value = useMemo<DateNightContextValue>(() => ({
    user,
    authLoading,
    isAdmin: isAdmin(user),
    couple,
    participantRows,
    reviewSlotNames,
    settings,
    dates,
    modifiers,
    rolls,
    pendingRoll,
    signIn,
    signUp,
    signOut: signOutHandler,
    saveItem,
    deleteItem,
    acceptCandidate,
    recordVeto,
    archivePendingRollWithoutReview,
    deleteRoll,
    upsertReview,
    addPhoto,
    markCompleted,
    saveParticipant,
  }), [
    user,
    authLoading,
    couple,
    participantRows,
    reviewSlotNames,
    settings,
    dates,
    modifiers,
    rolls,
    pendingRoll,
    signIn,
    signUp,
    signOutHandler,
    saveItem,
    deleteItem,
    acceptCandidate,
    recordVeto,
    archivePendingRollWithoutReview,
    deleteRoll,
    upsertReview,
    addPhoto,
    markCompleted,
    saveParticipant,
  ]);

  return <DateNightContext.Provider value={value}>{children}</DateNightContext.Provider>;
}

export const useDateNight = () => {
  const ctx = useContext(DateNightContext);
  if (!ctx) throw new Error('useDateNight must be used within DateNightProvider');
  return ctx;
};

export function DateNightAuthGate({ children }: { children: ReactNode }) {
  const { user, authLoading, signIn, signUp } = useDateNight();
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    try {
      if (isLogin) await signIn(authEmail, authPassword);
      else {
        const displayName = `${firstName || 'Jimi'} ${lastInitial}`.trim();
        await signUp(authEmail, authPassword, displayName);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
    }
  };

  if (authLoading) return <div className="container-tight py-20 text-center text-text-2">Checking authentication…</div>;

  if (!user) {
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
        toggleMode={() => setIsLogin((prev) => !prev)}
        onSubmit={handleSubmit}
      />
    );
  }

  return <>{children}</>;
}

export const REVIEW_SLOT_ORDER = REVIEW_SLOTS;
