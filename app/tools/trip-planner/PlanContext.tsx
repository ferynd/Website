"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: context defaults & upload path segments       */
/* ------------------------------------------------------------ */
const UPLOAD_ROOT = 'artifacts/trip-planner/uploads';

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
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  deleteField,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type FieldValue,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  uploadBytes,
  type StorageReference,
} from 'firebase/storage';
import type { CreatePlannerInput, CostTrackerSeed } from './lib/db';
import {
  addEvent,
  addIdea,
  createAndLinkCostTracker,
  createPlanner,
  deleteIdea,
  getAdminTripsList as fetchAdminTripsList,
  linkCostTracker as linkCostTrackerHelper,
  plannerDoc,
  plannerEventDoc,
  plannerEventsCol,
  stripUndefined,
  watchEvents,
  watchIdeas,
  watchPlanner,
  updateIdea,
  appendChangelogEntry,
} from './lib/db';
import { auth, db, isAdmin as isAdminUser, storage } from './lib/firebase';
import { compressFile, type PreparedImage } from './lib/image';
import type {
  DaySchedule,
  Idea,
  Planner,
  PlannerEvent,
  PlannerParticipant,
  PlannerSettings,
  TravelMode,
} from './lib/types';

const EVENT_ICON_BY_TYPE: Record<PlannerEvent['type'], string> = {
  block: 'CalendarClock',
  travel: 'Plane',
  activity: 'Mountain',
};
const TRAVEL_ICON_BY_MODE: Partial<Record<TravelMode, string>> = {
  flight: 'Plane',
  taxi: 'Car',
  rideshare: 'Car',
  bus: 'Bus',
  train: 'Train',
  car: 'Car',
  boat: 'Ship',
  subway: 'Train',
  tram: 'TramFront',
  bike: 'Bike',
  walk: 'Footprints',
  other: 'Route',
};
const EVENT_COLOR_BY_TYPE: Record<PlannerEvent['type'], string> = {
  block: 'bg-surface-2/80 border border-border text-text',
  travel: 'bg-accent/10 border border-accent/40 text-accent',
  activity: 'bg-purple/10 border border-purple/40 text-purple',
};

type PlannerEventRecord = PlannerEvent & {
  plannerId: string;
  startISO: string;
  endISO: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  images: string[];
};

type IdeaRecord = Idea & {
  plannerId?: string;
  tags: string[];
  images: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

interface PlanContextValue {
  user: User | null;
  authLoading: boolean;
  plannerId: string | null;
  planner: Planner | null;
  events: PlannerEventRecord[];
  activityIdeas: IdeaRecord[];
  daySchedules: DaySchedule[];
  isAdmin: boolean;
  selectPlanner: (id: string | null) => void;
  createPlannerAndSelect: (input: CreatePlannerInput) => Promise<string>;
  addParticipant: (name: string, authorUid?: string, userId?: string) => Promise<void>;
  updateParticipant: (uid: string, name: string) => Promise<void>;
  deleteParticipant: (uid: string) => Promise<void>;
  addActivity: (event: PlannerEvent) => Promise<string>;
  updateEvent: (
    eventId: string,
    patch: Partial<PlannerEvent>,
    options?: { applyToSeries?: boolean; groupId?: string; detachFromSeries?: boolean },
  ) => Promise<void>;
  updateActivity: (eventId: string, patch: Partial<PlannerEvent>) => Promise<void>;
  deleteEvent: (eventId: string, options?: { applyToSeries?: boolean; groupId?: string }) => Promise<void>;
  deleteActivity: (eventId: string) => Promise<void>;
  addBlock: (event: PlannerEvent) => Promise<string>;
  addTravel: (event: PlannerEvent & { travelMode: TravelMode }) => Promise<string>;
  addActivityIdea: (idea: Idea) => Promise<string>;
  updateActivityIdea: (id: string, patch: Partial<Idea>) => Promise<void>;
  deleteActivityIdea: (id: string) => Promise<void>;
  updatePlanSettings: (patch: Partial<PlannerSettings>) => Promise<void>;
  updatePlanDates: (startISO: string, endISO: string) => Promise<void>;
  linkCostTracker: (trackerId: string) => Promise<void>;
  createLinkedCostTracker: (seed: CostTrackerSeed) => Promise<string>;
  uploadImage: (input: File | PreparedImage) => Promise<string>;
  compressOldImages: () => Promise<void>;
  appendAudit: (entry: { type: string; details?: Record<string, unknown> }) => Promise<void>;
  getDayActivities: (dateISO: string) => PlannerEventRecord[];
  getActivityIcon: (type: PlannerEvent['type'], travelMode?: TravelMode) => string;
  getActivityColor: (type: PlannerEvent['type']) => string;
  getAdminTripsList: () => Promise<{ id: string; name: string }[]>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

const normalizeTimestamp = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
};

const ensureString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const buildEventPatch = (patch: Partial<PlannerEvent>): Record<string, unknown> => {
  const sanitized = stripUndefined({ ...patch });
  delete (sanitized as Record<string, unknown>).id;
  delete (sanitized as Record<string, unknown>).plannerId;
  delete (sanitized as Record<string, unknown>).createdAt;
  delete (sanitized as Record<string, unknown>).createdBy;

  const startValue = (patch as Record<string, unknown>).startISO ?? patch.start;
  if (typeof startValue === 'string') {
    (sanitized as Record<string, unknown>).start = startValue;
    (sanitized as Record<string, unknown>).startISO = startValue;
  }
  const endValue = (patch as Record<string, unknown>).endISO ?? patch.end;
  if (typeof endValue === 'string') {
    (sanitized as Record<string, unknown>).end = endValue;
    (sanitized as Record<string, unknown>).endISO = endValue;
  }
  if ('images' in sanitized) {
    (sanitized as Record<string, unknown>).images = ensureStringArray(
      (sanitized as Record<string, unknown>).images,
    );
  }

  return sanitized as Record<string, unknown>;
};

const toastError = (message: string) => {
  console.error(message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('planner-toast', { detail: { message, variant: 'error' as const } }),
    );
  }
};

const buildSchedules = (planner: Planner | null, events: PlannerEventRecord[]): DaySchedule[] => {
  if (!planner) return [];
  const grouped = new Map<string, PlannerEventRecord[]>();
  for (const event of events) {
    if (!grouped.has(event.dayId)) {
      grouped.set(event.dayId, []);
    }
    grouped.get(event.dayId)!.push(event);
  }
  const sortEvents = (list: PlannerEventRecord[]) =>
    list.sort(
      (a, b) => new Date(a.startISO ?? a.start).getTime() - new Date(b.startISO ?? b.start).getTime(),
    );

  const result: DaySchedule[] = [];
  if (planner.dayOrder && planner.dayOrder.length > 0) {
    for (const dayId of planner.dayOrder) {
      const day = planner.days?.[dayId];
      const evts = grouped.get(dayId) ?? [];
      sortEvents(evts);
      if (day) {
        result.push({ dayId, date: day.date, events: evts });
      }
    }
  } else {
    const items = Array.from(grouped.entries());
    items.sort((a, b) => a[1][0]?.start.localeCompare(b[1][0]?.start ?? '') ?? 0);
    for (const [dayId, evts] of items) {
      sortEvents(evts);
      const firstStart = evts[0]?.startISO ?? evts[0]?.start ?? planner.startDate;
      const date = firstStart.slice(0, 10);
      result.push({ dayId, date, events: evts });
    }
  }
  return result;
};

export const PlanProvider = ({
  plannerId,
  children,
}: {
  plannerId?: string | null;
  children: React.ReactNode;
}) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(!auth.currentUser);
  const [activePlannerId, setActivePlannerId] = useState<string | null>(plannerId ?? null);
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [events, setEvents] = useState<PlannerEventRecord[]>([]);
  const [activityIdeas, setActivityIdeas] = useState<IdeaRecord[]>([]);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!mountedRef.current) return;
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (plannerId) {
      setActivePlannerId(plannerId);
    }
  }, [plannerId]);

  useEffect(() => {
    if (!activePlannerId) {
      if (mountedRef.current) {
        setPlanner(null);
      }
      return undefined;
    }
    const unsubscribe = watchPlanner(activePlannerId, (plannerData) => {
      if (!mountedRef.current) {
        return;
      }
      if (!plannerData) {
        setPlanner(null);
        return;
      }
      setPlanner({
        ...plannerData,
        createdAt: normalizeTimestamp(plannerData.createdAt),
        updatedAt: normalizeTimestamp(plannerData.updatedAt),
      });
    });
    return () => unsubscribe();
  }, [activePlannerId, mountedRef]);

  useEffect(() => {
    if (!activePlannerId) {
      if (mountedRef.current) {
        setEvents([]);
      }
      return undefined;
    }
    const unsubscribe = watchEvents(activePlannerId, (eventList) => {
      if (!mountedRef.current) {
        return;
      }
      const normalizedEvents: PlannerEventRecord[] = eventList.map((event) => {
        const raw = event as unknown as Record<string, unknown>;
        const startISO = ensureString('startISO' in raw ? raw.startISO : event.start);
        const endISO = ensureString('endISO' in raw ? raw.endISO : event.end);
        const plannerIdValue = ensureString(raw.plannerId, activePlannerId ?? '');
        return {
          ...event,
          plannerId: plannerIdValue,
          start: startISO,
          end: endISO,
          startISO,
          endISO,
          images: ensureStringArray(raw.images ?? event.images),
          createdBy: ensureString(raw.createdBy, 'unknown'),
          createdAt: normalizeTimestamp(raw.createdAt),
          updatedAt: normalizeTimestamp(raw.updatedAt),
        };
      });
      setEvents(normalizedEvents);
    });
    return () => unsubscribe();
  }, [activePlannerId, mountedRef]);

  useEffect(() => {
    if (!activePlannerId) {
      if (mountedRef.current) {
        setActivityIdeas([]);
      }
      return undefined;
    }
    const unsubscribe = watchIdeas(activePlannerId, (ideasList) => {
      if (!mountedRef.current) {
        return;
      }
      const normalizedIdeas: IdeaRecord[] = ideasList.map((idea) => {
        const raw = idea as unknown as Record<string, unknown>;
        const plannerIdValue = ensureString(raw.plannerId);
        return {
          ...idea,
          plannerId: plannerIdValue || undefined,
          tags: ensureStringArray(raw.tags ?? idea.tags),
          images: ensureStringArray(raw.images ?? idea.images),
          createdBy: ensureString(raw.createdBy, 'unknown'),
          createdAt: normalizeTimestamp(raw.createdAt),
          updatedAt: normalizeTimestamp(raw.updatedAt),
        };
      });
      setActivityIdeas(normalizedIdeas);
    });
    return () => unsubscribe();
  }, [activePlannerId, mountedRef]);

  const daySchedules = useMemo(
    () => buildSchedules(planner, events),
    [planner, events],
  );

  const selectPlanner = useCallback((id: string | null) => {
    setActivePlannerId(id);
  }, []);

  const createPlannerAndSelect = useCallback(
    async (input: CreatePlannerInput) => {
      const ref = await createPlanner(input);
      setActivePlannerId(ref.id);
      return ref.id;
    },
    [],
  );

  const requireActor = useCallback(() => {
    if (!user) {
      const message = 'You must be signed in to make planner changes';
      toastError(message);
      throw new Error(message);
    }
    return user;
  }, [user]);

  const assertOwnerOrAdmin = useCallback(() => {
    const actor = requireActor();
    if (!planner) {
      throw new Error('No planner selected');
    }
    if (!isAdminUser(actor) && planner.ownerUid !== actor.uid) {
      const message = 'Only the planner owner or admin can manage participants or linked tools';
      toastError(message);
      throw new Error(message);
    }
    return actor;
  }, [planner, requireActor]);

  const ensurePlannerId = useCallback(() => {
    if (!activePlannerId) {
      throw new Error('No planner selected');
    }
    return activePlannerId;
  }, [activePlannerId]);

  const appendAudit = useCallback(
    async ({ type, details }: { type: string; details?: Record<string, unknown> }) => {
      const actor = requireActor();
      const plannerRef = ensurePlannerId();
      await appendChangelogEntry(plannerRef, {
        type,
        actorUid: actor.uid,
        actorEmail: actor.email ?? undefined,
        details,
        ts: serverTimestamp(),
      });
    },
    [ensurePlannerId, requireActor],
  );

  const addParticipant = useCallback(
    async (name: string, _authorUid?: string, userId?: string) => {
      const actor = assertOwnerOrAdmin();
      if (!activePlannerId || !planner) {
        throw new Error('No planner selected');
      }
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error('Participant name is required');
      }
      const participant: PlannerParticipant = {
        uid: userId ?? crypto.randomUUID(),
        displayName: trimmed,
        role: userId ? 'editor' : 'viewer',
      };
      const participants = [...(planner.participants ?? []), participant];
      await updateDoc(plannerDoc(activePlannerId), {
        participants,
        participantUids: arrayUnion(participant.uid),
        updatedAt: serverTimestamp(),
        lastModifiedBy: actor.uid,
      });
      await appendAudit({
        type: 'planner.participant.add',
        details: { uid: participant.uid, name: participant.displayName },
      });
    },
    [activePlannerId, appendAudit, planner, assertOwnerOrAdmin],
  );

  const updateParticipant = useCallback(
    async (uid: string, name: string) => {
      assertOwnerOrAdmin();
      if (!activePlannerId || !planner?.participants) {
        throw new Error('No planner participant list available');
      }
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error('Participant name is required');
      }
      const participants = planner.participants.map((participant) =>
        participant.uid === uid ? { ...participant, displayName: trimmed } : participant,
      );
      await updateDoc(plannerDoc(activePlannerId), {
        participants,
        updatedAt: serverTimestamp(),
      });
      await appendAudit({
        type: 'planner.participant.update',
        details: { uid, name: trimmed },
      });
    },
    [activePlannerId, appendAudit, assertOwnerOrAdmin, planner?.participants],
  );

  const deleteParticipant = useCallback(
    async (uid: string) => {
      assertOwnerOrAdmin();
      if (!activePlannerId || !planner) {
        throw new Error('No planner selected');
      }
      const participants = (planner.participants ?? []).filter((p) => p.uid !== uid);
      await updateDoc(plannerDoc(activePlannerId), {
        participants,
        participantUids: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      });
      await appendAudit({
        type: 'planner.participant.remove',
        details: { uid },
      });
    },
    [activePlannerId, appendAudit, assertOwnerOrAdmin, planner],
  );

  const createPlannerEvent = useCallback(
    async (event: PlannerEvent) => {
      const actor = requireActor();
      const plannerRef = ensurePlannerId();
      const eventId = await addEvent(plannerRef, event, {
        uid: actor.uid,
        email: actor.email ?? undefined,
      });
      await appendAudit({
        type: `planner.event.${event.type}.create`,
        details: { eventId, dayId: event.dayId },
      });
      return eventId;
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const addActivity = useCallback(
    async (event: PlannerEvent) => createPlannerEvent(event),
    [createPlannerEvent],
  );

  const updateEvent = useCallback(
    async (
      eventId: string,
      patch: Partial<PlannerEvent>,
      options?: { applyToSeries?: boolean; groupId?: string; detachFromSeries?: boolean },
    ) => {
      requireActor();
      const plannerId = ensurePlannerId();
      const targetGroupId = options?.groupId;
      const applyToSeries = Boolean(options?.applyToSeries && targetGroupId);
      const detachFromSeries = Boolean(options?.detachFromSeries);

      const patchData = buildEventPatch(patch);
      const updatePayload: Record<string, unknown> = {
        ...patchData,
        updatedAt: serverTimestamp(),
        ...(detachFromSeries ? { groupId: deleteField() } : {}),
      };

      if (applyToSeries) {
        const seriesQuery = query(plannerEventsCol(plannerId), where('groupId', '==', targetGroupId));
        const snapshot = await getDocs(seriesQuery);
        const batch = writeBatch(db);
        snapshot.docs.forEach((docSnap) => {
          batch.update(docSnap.ref, updatePayload);
        });
        await batch.commit();
      } else {
        await updateDoc(plannerEventDoc(plannerId, eventId), updatePayload);
      }

      await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
      await appendAudit({
        type: applyToSeries ? 'planner.event.series.update' : 'planner.event.update',
        details: {
          eventId,
          groupId: targetGroupId,
          applyToSeries,
          detachFromSeries,
          fields: Object.keys(patch ?? {}),
        },
      });
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const updateActivity = useCallback(
    async (eventId: string, patch: Partial<PlannerEvent>) => updateEvent(eventId, patch),
    [updateEvent],
  );

  const deleteEvent = useCallback(
    async (eventId: string, options?: { applyToSeries?: boolean; groupId?: string }) => {
      requireActor();
      const plannerId = ensurePlannerId();
      const targetGroupId = options?.groupId;
      const applyToSeries = Boolean(options?.applyToSeries && targetGroupId);

      if (applyToSeries) {
        const seriesQuery = query(plannerEventsCol(plannerId), where('groupId', '==', targetGroupId));
        const snapshot = await getDocs(seriesQuery);
        const batch = writeBatch(db);
        snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
      } else {
        await deleteDoc(plannerEventDoc(plannerId, eventId));
      }

      await updateDoc(plannerDoc(plannerId), { updatedAt: serverTimestamp() });
      await appendAudit({
        type: applyToSeries ? 'planner.event.series.delete' : 'planner.event.remove',
        details: { eventId, groupId: targetGroupId, applyToSeries },
      });
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const deleteActivity = useCallback(
    async (eventId: string) => deleteEvent(eventId),
    [deleteEvent],
  );

  const addBlock = useCallback(
    async (event: PlannerEvent) => createPlannerEvent(event),
    [createPlannerEvent],
  );

  const addTravel = useCallback(
    async (event: PlannerEvent & { travelMode: TravelMode }) => createPlannerEvent(event),
    [createPlannerEvent],
  );

  const addActivityIdea = useCallback(
    async (idea: Idea) => {
      const actor = requireActor();
      const plannerRef = ensurePlannerId();
      const ideaId = await addIdea(plannerRef, idea, {
        uid: actor.uid,
        email: actor.email ?? undefined,
      });
      await appendAudit({
        type: 'planner.idea.create',
        details: { ideaId, title: idea.title },
      });
      return ideaId;
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const updateActivityIdea = useCallback(
    async (id: string, patch: Partial<Idea>) => {
      requireActor();
      const plannerRef = ensurePlannerId();
      await updateIdea(plannerRef, id, patch);
      await appendAudit({
        type: 'planner.idea.update',
        details: { ideaId: id, fields: Object.keys(patch ?? {}) },
      });
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const deleteActivityIdea = useCallback(
    async (id: string) => {
      requireActor();
      const plannerRef = ensurePlannerId();
      await deleteIdea(plannerRef, id);
      await appendAudit({
        type: 'planner.idea.remove',
        details: { ideaId: id },
      });
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const getAdminTripsList = useCallback(async () => {
    const actor = requireActor();
    if (!isAdminUser(actor)) {
      const message = 'Admin privileges required to load Trip Cost trips';
      toastError(message);
      throw new Error(message);
    }
    return fetchAdminTripsList();
  }, [requireActor]);

  const updatePlanSettings = useCallback(
    async (patch: Partial<PlannerSettings>) => {
      requireActor();
      const plannerRef = ensurePlannerId();
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (typeof patch.incrementMinutes === 'number') {
        updates['settings.incrementMinutes'] = patch.incrementMinutes;
      }
      if (patch.visibleHours) {
        if (typeof patch.visibleHours.start === 'number') {
          updates['settings.visibleHours.start'] = patch.visibleHours.start;
        }
        if (typeof patch.visibleHours.end === 'number') {
          updates['settings.visibleHours.end'] = patch.visibleHours.end;
        }
      }
      if (typeof patch.timezone === 'string') {
        updates['settings.timezone'] = patch.timezone;
      }
      await updateDoc(
        plannerDoc(plannerRef),
        updates as unknown as Record<string, FieldValue | Partial<unknown> | undefined>,
      );
      await appendAudit({
        type: 'planner.settings.update',
        details: { fields: Object.keys(patch ?? {}) },
      });
    },
    [appendAudit, ensurePlannerId, requireActor],
  );

  const updatePlanDates = useCallback(
    async (startISO: string, endISO: string) => {
      assertOwnerOrAdmin();
      if (new Date(startISO) > new Date(endISO)) {
        throw new Error('Start date must be before end date');
      }
      const plannerRef = ensurePlannerId();
      await updateDoc(plannerDoc(plannerRef), {
        startDate: startISO,
        endDate: endISO,
        updatedAt: serverTimestamp(),
      });
      await appendAudit({
        type: 'planner.dates.update',
        details: { startISO, endISO },
      });
    },
    [appendAudit, assertOwnerOrAdmin, ensurePlannerId],
  );

  const linkCostTracker = useCallback(
    async (trackerId: string) => {
      assertOwnerOrAdmin();
      const plannerRef = ensurePlannerId();
      await linkCostTrackerHelper(plannerRef, trackerId);
      await appendAudit({
        type: 'planner.costTracker.linked',
        details: { trackerId },
      });
    },
    [appendAudit, assertOwnerOrAdmin, ensurePlannerId],
  );

  const createLinkedCostTracker = useCallback(
    async (seed: CostTrackerSeed) => {
      assertOwnerOrAdmin();
      const plannerRef = ensurePlannerId();
      const trackerId = await createAndLinkCostTracker(plannerRef, seed);
      await appendAudit({
        type: 'planner.costTracker.created',
        details: { trackerId },
      });
      return trackerId;
    },
    [appendAudit, assertOwnerOrAdmin, ensurePlannerId],
  );

  const uploadImage = useCallback(
    async (input: File | PreparedImage) => {
      const actor = requireActor();
      const plannerRef = ensurePlannerId();

      const prepared = input instanceof File ? await compressFile(input) : input;
      const fileKey = `${prepared.normalizedName}-${prepared.hash}.${prepared.extension}`;
      const storageRef = ref(storage, `${UPLOAD_ROOT}/${plannerRef}/dedupe/${fileKey}`);

      try {
        const existingUrl = await getDownloadURL(storageRef);
        if (existingUrl) {
          return existingUrl;
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code && code !== 'storage/object-not-found') {
          throw error;
        }
      }

      await uploadBytes(storageRef, prepared.blob, {
        contentType: prepared.contentType,
        customMetadata: {
          hash: prepared.hash,
          normalizedName: prepared.normalizedName,
          originalName: prepared.originalName,
          uploadedBy: actor.uid,
          width: String(prepared.width),
          height: String(prepared.height),
          size: String(prepared.size),
        },
      });

      return getDownloadURL(storageRef);
    },
    [ensurePlannerId, requireActor],
  );

  const compressOldImages = useCallback(async () => {
    const plannerRef = ensurePlannerId();
    const rootRef = ref(storage, `${UPLOAD_ROOT}/${plannerRef}`);
    const endDate = planner?.endDate ? new Date(planner.endDate) : null;
    const now = new Date();

    const visitFolder = async (folder: StorageReference): Promise<void> => {
      const listing = await listAll(folder);
      for (const item of listing.items) {
        const metadata = await getMetadata(item);
        const uploadedAt = metadata.timeCreated ? new Date(metadata.timeCreated) : null;
        if (endDate && uploadedAt && endDate.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
          const download = await getDownloadURL(item);
          const response = await fetch(download);
          if (response.ok) {
            const blob = await response.blob();
            const prepared = await compressFile(new File([blob], item.name, { type: blob.type }), 1600, 0.8);
            await uploadBytes(item, prepared.blob, {
              contentType: prepared.contentType,
              customMetadata: {
                hash: prepared.hash,
                normalizedName: prepared.normalizedName,
                originalName: prepared.originalName,
                width: String(prepared.width),
                height: String(prepared.height),
                size: String(prepared.size),
              },
            });
          }
        }
        if (uploadedAt && uploadedAt.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
          await deleteObject(item);
        }
      }
      for (const child of listing.prefixes) {
        await visitFolder(child);
      }
    };

    await visitFolder(rootRef);
  }, [ensurePlannerId, planner?.endDate]);

  const getDayActivities = useCallback(
    (dateISO: string) => {
      const targetDate = dateISO.slice(0, 10);
      return events
        .filter((event) => {
          const dayDate = planner?.days?.[event.dayId]?.date?.slice(0, 10);
          if (dayDate) {
            return dayDate === targetDate;
          }
          const startValue = event.startISO ?? event.start;
          return startValue.slice(0, 10) === targetDate;
        })
        .slice()
        .sort(
          (a, b) =>
            new Date((a.startISO ?? a.start) || '').getTime() - new Date((b.startISO ?? b.start) || '').getTime(),
        );
    },
    [events, planner?.days],
  );

  const getActivityIcon = useCallback(
    (type: PlannerEvent['type'], travelMode?: TravelMode) => {
      if (type === 'travel' && travelMode) {
        return TRAVEL_ICON_BY_MODE[travelMode] ?? EVENT_ICON_BY_TYPE.travel;
      }
      return EVENT_ICON_BY_TYPE[type] ?? EVENT_ICON_BY_TYPE.block;
    },
    [],
  );

  const getActivityColor = useCallback(
    (type: PlannerEvent['type']) => EVENT_COLOR_BY_TYPE[type] ?? EVENT_COLOR_BY_TYPE.block,
    [],
  );

  const signInHandler = useCallback(
    async (email: string, password: string) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    [],
  );

  const signUpHandler = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }
    },
    [],
  );

  const signOutHandler = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = useMemo<PlanContextValue>(
    () => ({
      user,
      authLoading,
      plannerId: activePlannerId,
      planner,
      events,
      activityIdeas,
      daySchedules,
      isAdmin: isAdminUser(user),
      selectPlanner,
      createPlannerAndSelect,
      addParticipant,
      updateParticipant,
      deleteParticipant,
      addActivity,
      updateEvent,
      updateActivity,
      deleteEvent,
      deleteActivity,
      addBlock,
      addTravel,
      addActivityIdea,
      updateActivityIdea,
      deleteActivityIdea,
      updatePlanSettings,
      updatePlanDates,
      linkCostTracker,
      createLinkedCostTracker,
      uploadImage,
      compressOldImages,
      appendAudit,
      getDayActivities,
      getActivityIcon,
      getActivityColor,
      getAdminTripsList,
      signIn: signInHandler,
      signUp: signUpHandler,
      signOut: signOutHandler,
    }),
    [
      user,
      authLoading,
      activePlannerId,
      planner,
      events,
      activityIdeas,
      daySchedules,
      selectPlanner,
      createPlannerAndSelect,
      addParticipant,
      updateParticipant,
      deleteParticipant,
      addActivity,
      updateEvent,
      updateActivity,
      deleteEvent,
      deleteActivity,
      addBlock,
      addTravel,
      addActivityIdea,
      updateActivityIdea,
      deleteActivityIdea,
      updatePlanSettings,
      updatePlanDates,
      linkCostTracker,
      createLinkedCostTracker,
      uploadImage,
      compressOldImages,
      appendAudit,
      getDayActivities,
      getActivityIcon,
      getActivityColor,
      getAdminTripsList,
      signInHandler,
      signUpHandler,
      signOutHandler,
    ],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
};

export const usePlan = (): PlanContextValue => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used within a PlanProvider');
  }
  return context;
};

