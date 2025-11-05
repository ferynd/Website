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
  getDoc,
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
import type { Idea, Planner, PlannerEvent, PlannerSettings } from './types';

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

export const stripUndefined = <T extends Record<string, unknown>>(input: T): T => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
};

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

interface MutationAuthor {
  uid: string;
  email?: string | null;
}

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
  const q = query(plannerEventsCol(plannerId), orderBy('startISO', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const events = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const startISO = typeof data.startISO === 'string' ? data.startISO : (typeof data.start === 'string' ? data.start : '');
        const endISO = typeof data.endISO === 'string' ? data.endISO : (typeof data.end === 'string' ? data.end : '');
        const rawType = data.type;
        const type: PlannerEvent['type'] = rawType === 'travel' || rawType === 'activity' ? (rawType as PlannerEvent['type']) : 'block';
        const { id: _ignoredId, ...rest } = (data as unknown as PlannerEvent) ?? {};
        void _ignoredId;
        return {
          ...(rest as unknown as PlannerEvent),
          id: docSnap.id,
          plannerId,
          type,
          start: startISO,
          end: endISO,
          startISO,
          endISO,
          images: ensureStringArray(data.images),
          createdBy: typeof data.createdBy === 'string' ? (data.createdBy as string) : 'unknown',
          createdAt: data.createdAt ?? startISO,
          updatedAt: data.updatedAt ?? endISO,
        } as unknown as PlannerEvent;
      });
      onData(events);
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
      const ideas = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const { id: _ignoredId, ...rest } = (data as unknown as Idea) ?? {};
        void _ignoredId;
        return {
          ...(rest as unknown as Idea),
          id: docSnap.id,
          plannerId,
          tags: ensureStringArray(data.tags),
          images: ensureStringArray(data.images),
          createdBy: typeof data.createdBy === 'string' ? (data.createdBy as string) : 'unknown',
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? data.createdAt ?? null,
        } as unknown as Idea;
      });
      onData(ideas);
    },
    (error) => onData([], error),
  );

export const addEvent = async (
  plannerId: string,
  event: PlannerEvent,
  author: MutationAuthor,
): Promise<string> => {
  const eventId = event.id || crypto.randomUUID();
  const startISO = (event as unknown as Record<string, unknown>).startISO ?? event.start;
  const endISO = (event as unknown as Record<string, unknown>).endISO ?? event.end;
  if (typeof startISO !== 'string' || typeof endISO !== 'string') {
    throw new Error('Events must include start and end timestamps');
  }
  const payload = stripUndefined({
    ...event,
    id: undefined,
    plannerId,
    start: startISO,
    end: endISO,
    startISO,
    endISO,
    images: ensureStringArray((event as unknown as Record<string, unknown>).images),
    createdBy: author.uid,
    createdByEmail: author.email ?? undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(plannerEventDoc(plannerId, eventId), payload);
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
  return eventId;
};

export const updateEvent = async (
  plannerId: string,
  eventId: string,
  patch: Partial<PlannerEvent>,
): Promise<void> => {
  const sanitized = stripUndefined({ ...patch });
  delete (sanitized as unknown as Record<string, unknown>).id;
  delete (sanitized as unknown as Record<string, unknown>).plannerId;
  delete (sanitized as unknown as Record<string, unknown>).createdAt;
  delete (sanitized as unknown as Record<string, unknown>).createdBy;

  const startValue = (patch as unknown as Record<string, unknown>).startISO ?? patch.start;
  if (typeof startValue === 'string') {
    (sanitized as unknown as Record<string, unknown>).start = startValue;
    (sanitized as unknown as Record<string, unknown>).startISO = startValue;
  }
  const endValue = (patch as unknown as Record<string, unknown>).endISO ?? patch.end;
  if (typeof endValue === 'string') {
    (sanitized as unknown as Record<string, unknown>).end = endValue;
    (sanitized as unknown as Record<string, unknown>).endISO = endValue;
  }
  if ('images' in sanitized) {
    (sanitized as unknown as Record<string, unknown>).images = ensureStringArray(
      (sanitized as unknown as Record<string, unknown>).images,
    );
  }
  await updateDoc(plannerEventDoc(plannerId, eventId), {
    ...sanitized,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const deleteEvent = async (plannerId: string, eventId: string): Promise<void> => {
  await deleteDoc(plannerEventDoc(plannerId, eventId));
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const addIdea = async (
  plannerId: string,
  idea: Idea,
  author: MutationAuthor,
): Promise<string> => {
  const ideaId = idea.id || crypto.randomUUID();
  const payload = stripUndefined({
    ...idea,
    id: undefined,
    plannerId,
    tags: ensureStringArray((idea as unknown as Record<string, unknown>).tags),
    images: ensureStringArray((idea as unknown as Record<string, unknown>).images),
    createdBy: author.uid,
    createdByEmail: author.email ?? undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(plannerIdeaDoc(plannerId, ideaId), payload);
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
  return ideaId;
};

export const updateIdea = async (
  plannerId: string,
  ideaId: string,
  patch: Partial<Idea>,
): Promise<void> => {
  const sanitized = stripUndefined({ ...patch });
  delete (sanitized as unknown as Record<string, unknown>).id;
  delete (sanitized as unknown as Record<string, unknown>).plannerId;
  delete (sanitized as unknown as Record<string, unknown>).createdAt;
  delete (sanitized as unknown as Record<string, unknown>).createdBy;
  if ('tags' in sanitized) {
    (sanitized as unknown as Record<string, unknown>).tags = ensureStringArray(
      (sanitized as unknown as Record<string, unknown>).tags,
    );
  }
  if ('images' in sanitized) {
    (sanitized as unknown as Record<string, unknown>).images = ensureStringArray(
      (sanitized as unknown as Record<string, unknown>).images,
    );
  }
  await updateDoc(plannerIdeaDoc(plannerId, ideaId), {
    ...sanitized,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const deleteIdea = async (plannerId: string, ideaId: string): Promise<void> => {
  await deleteDoc(plannerIdeaDoc(plannerId, ideaId));
  await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
};

export const linkCostTracker = async (plannerId: string, costTrackerId: string): Promise<void> => {
  const actor = auth.currentUser;
  if (!actor) {
    throw new Error('Authentication required to link a cost tracker');
  }

  const plannerRef = plannerDoc(plannerId);
  const plannerSnap = await getDoc(plannerRef);
  if (!plannerSnap.exists()) {
    throw new Error('Planner not found');
  }

  const data = plannerSnap.data() as { ownerUid?: string };
  const ownerUid = data.ownerUid;
  const isOwner = typeof ownerUid === 'string' && ownerUid === actor.uid;
  if (!isOwner && !isAdmin(actor)) {
    throw new Error('Only the planner owner or an admin can link a cost tracker');
  }

  await updateDoc(plannerRef, {
    ...stripUndefined({ costTrackerId }),
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
  const participants = (seed.participants ?? []).map((participant) => {
    const sanitized: { id: string; name: string; userId?: string } = {
      id: participant.id,
      name: participant.name,
    };
    if (participant.userId) {
      sanitized.userId = participant.userId;
    }
    return sanitized;
  });
  const participantIds = participants
    .map((participant) => participant.userId ?? participant.id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

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

export const appendChangelogEntry = async (
  plannerId: string,
  entry: {
    type: string;
    actorUid: string;
    actorEmail?: string | null;
    details?: Record<string, unknown>;
    ts?: unknown;
  },
): Promise<void> => {
  const payload = stripUndefined({
    ...entry,
    ts: entry.ts ?? serverTimestamp(),
  });
  await addDoc(plannerChangelogCol(plannerId), payload);
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

