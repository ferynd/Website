"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firestore root + collection naming            */
/* ------------------------------------------------------------ */
export const ROOT_COLLECTION = 'artifacts';
export const APP_ID = 'trip-planner';

import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore';
import { auth, db, isAdmin } from './firebase';
import type {
  ChangeLogEntry,
  Idea,
  Planner,
  PlannerEvent,
  PlannerSettings,
} from './types';

type FirestoreUnsubscribe = () => void;

const plannersCol = (): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'planners');

const plannerDoc = (plannerId: string): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId);

const plannerEventsCol = (plannerId: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId, 'events');

const plannerEventDoc = (plannerId: string, eventId: string): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId, 'events', eventId);

const plannerIdeasCol = (plannerId: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId, 'activityIdeas');

const plannerIdeaDoc = (plannerId: string, ideaId: string): DocumentReference =>
  doc(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId, 'activityIdeas', ideaId);

const plannerChangelogCol = (plannerId: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'planners', plannerId, 'changelog');

const tripCostTripsCol = (): CollectionReference =>
  collection(db, ROOT_COLLECTION, 'trip-cost', 'trips');

const cleanData = <T extends Record<string, unknown>>(input: T): T => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
};

export interface CreatePlannerInput {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  ownerUid: string;
  settings?: Partial<PlannerSettings>;
}

export const createPlanner = async ({
  name,
  startDate,
  endDate,
  timezone,
  ownerUid,
  settings,
}: CreatePlannerInput): Promise<DocumentReference> => {
  const ref = doc(plannersCol());
  const initialSettings: PlannerSettings = {
    incrementMinutes: settings?.incrementMinutes ?? 30,
    visibleHours: settings?.visibleHours ?? { start: 6, end: 22 },
    timezone: settings?.timezone ?? timezone,
  };

  await setDoc(ref, {
    name,
    ownerUid,
    participantUids: [ownerUid],
    startDate,
    endDate,
    timezone,
    settings: initialSettings,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref;
};

export const watchPlanner = (
  plannerId: string,
  onData: (planner: Planner | null, error?: FirestoreError) => void,
): FirestoreUnsubscribe =>
  onSnapshot(
    plannerDoc(plannerId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      const data = snapshot.data() as Omit<Planner, 'id'>;
      onData({ id: snapshot.id, ...data });
    },
    (error) => onData(null, error),
  );

export const watchEvents = (
  plannerId: string,
  onData: (events: PlannerEvent[], error?: FirestoreError) => void,
): FirestoreUnsubscribe => {
  const q = query(plannerEventsCol(plannerId), orderBy('start', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<PlannerEvent, 'id'>) })));
    },
    (error) => onData([], error),
  );
};

export const watchIdeas = (
  plannerId: string,
  onData: (ideas: Idea[], error?: FirestoreError) => void,
): FirestoreUnsubscribe =>
  onSnapshot(
    plannerIdeasCol(plannerId),
    (snap) => {
      onData(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Idea, 'id'>) })));
    },
    (error) => onData([], error),
  );

export const addEvent = async (plannerId: string, event: PlannerEvent): Promise<string> => {
  const eventId = event.id || crypto.randomUUID();
  await setDoc(plannerEventDoc(plannerId, eventId), {
    ...cleanData({ ...event, id: undefined }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
  return eventId;
};

export const updateEvent = async (
  plannerId: string,
  eventId: string,
  patch: Partial<PlannerEvent>,
): Promise<void> => {
  await updateDoc(plannerEventDoc(plannerId, eventId), {
    ...cleanData(patch),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const deleteEvent = async (plannerId: string, eventId: string): Promise<void> => {
  await deleteDoc(plannerEventDoc(plannerId, eventId));
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const addIdea = async (plannerId: string, idea: Idea): Promise<string> => {
  const ideaId = idea.id || crypto.randomUUID();
  await setDoc(plannerIdeaDoc(plannerId, ideaId), {
    ...cleanData({ ...idea, id: undefined }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
  return ideaId;
};

export const updateIdea = async (
  plannerId: string,
  ideaId: string,
  patch: Partial<Idea>,
): Promise<void> => {
  await updateDoc(plannerIdeaDoc(plannerId, ideaId), {
    ...cleanData(patch),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const deleteIdea = async (plannerId: string, ideaId: string): Promise<void> => {
  await deleteDoc(plannerIdeaDoc(plannerId, ideaId));
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const linkCostTracker = async (plannerId: string, costTrackerId: string): Promise<void> => {
  await updateDoc(plannerDoc(plannerId), {
    costTrackerId,
    updatedAt: serverTimestamp(),
  });
};

export interface CostTrackerSeed {
  name: string;
  ownerUid: string;
  participants?: { id: string; name: string; userId?: string }[];
  currency?: string;
}

export const createAndLinkCostTracker = async (
  plannerId: string,
  seed: CostTrackerSeed,
): Promise<string> => {
  const tripRef = doc(tripCostTripsCol());
  const participants = seed.participants ?? [];
  const participantIds = participants.map((p) => p.userId ?? p.id);

  await setDoc(tripRef, {
    name: seed.name,
    ownerUid: seed.ownerUid,
    participants,
    participantIds,
    expenses: [],
    payments: [],
    currency: seed.currency ?? 'USD',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(plannerDoc(plannerId), {
    costTrackerId: tripRef.id,
    updatedAt: serverTimestamp(),
  });

  return tripRef.id;
};

export const watchChangelog = (
  plannerId: string,
  onData: (entries: ChangeLogEntry[], error?: FirestoreError) => void,
): FirestoreUnsubscribe => {
  const q = query(plannerChangelogCol(plannerId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) =>
      onData(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ChangeLogEntry, 'id'>) }))),
    (error) => onData([], error),
  );
};

export const appendChangelogEntry = async (
  plannerId: string,
  entry: Omit<ChangeLogEntry, 'id' | 'createdAt'>,
): Promise<void> => {
  await addDoc(plannerChangelogCol(plannerId), {
    ...entry,
    createdAt: serverTimestamp(),
  });
};

export const addParticipantUid = async (
  plannerId: string,
  uid: string,
): Promise<void> => {
  await updateDoc(plannerDoc(plannerId), {
    participantUids: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
};

export const getAdminTripsList = async (): Promise<{ id: string; name: string }[]> => {
  if (!isAdmin(auth.currentUser)) {
    return [];
  }
  const snapshot = await getDocs(tripCostTripsCol());
  return snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data() as { name?: string };
      return { id: docSnap.id, name: data.name?.trim() || 'Unnamed Trip' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export {
  plannersCol,
  plannerDoc,
  plannerEventsCol,
  plannerEventDoc,
  plannerIdeasCol,
  plannerIdeaDoc,
  plannerChangelogCol,
};

