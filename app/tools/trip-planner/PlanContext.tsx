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
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  uploadBytes,
} from 'firebase/storage';
import type { CreatePlannerInput, CostTrackerSeed } from './lib/db';
import {
  addEvent,
  addIdea,
  appendChangelogEntry,
  createAndLinkCostTracker,
  createPlanner,
  deleteEvent,
  deleteIdea,
  getAdminTripsList,
  linkCostTracker as linkCostTrackerHelper,
  plannerDoc,
  watchChangelog,
  watchEvents,
  watchIdeas,
  watchPlanner,
  updateEvent,
  updateIdea,
} from './lib/db';
import { auth, isAdmin as isAdminUser, storage } from './lib/firebase';
import { compressFile } from './lib/image';
import type {
  ChangeLogEntry,
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

interface PlanContextValue {
  user: User | null;
  authLoading: boolean;
  plannerId: string | null;
  planner: Planner | null;
  events: PlannerEvent[];
  activityIdeas: Idea[];
  auditEntries: ChangeLogEntry[];
  daySchedules: DaySchedule[];
  isAdmin: boolean;
  selectPlanner: (id: string | null) => void;
  createPlannerAndSelect: (input: CreatePlannerInput) => Promise<string>;
  addParticipant: (name: string, authorUid: string, userId?: string) => Promise<void>;
  updateParticipant: (uid: string, name: string) => Promise<void>;
  deleteParticipant: (uid: string) => Promise<void>;
  addActivity: (event: PlannerEvent) => Promise<string>;
  updateActivity: (eventId: string, patch: Partial<PlannerEvent>) => Promise<void>;
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
  uploadImage: (file: File, options?: { alreadyCompressed?: boolean }) => Promise<string>;
  compressOldImages: () => Promise<void>;
  appendAudit: (entry: Omit<ChangeLogEntry, 'id' | 'createdAt'>) => Promise<void>;
  getDayActivities: (dateISO: string) => PlannerEvent[];
  getActivityIcon: (type: PlannerEvent['type'], travelMode?: TravelMode) => string;
  getActivityColor: (type: PlannerEvent['type']) => string;
  getAdminTripsList: typeof getAdminTripsList;
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

const buildSchedules = (planner: Planner | null, events: PlannerEvent[]): DaySchedule[] => {
  if (!planner) return [];
  const grouped = new Map<string, PlannerEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.dayId)) {
      grouped.set(event.dayId, []);
    }
    grouped.get(event.dayId)!.push(event);
  }
  const sortEvents = (list: PlannerEvent[]) =>
    list.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

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
      const date = evts[0]?.start.slice(0, 10) ?? planner.startDate;
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
  const [events, setEvents] = useState<PlannerEvent[]>([]);
  const [activityIdeas, setActivityIdeas] = useState<Idea[]>([]);
  const [auditEntries, setAuditEntries] = useState<ChangeLogEntry[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
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
      setPlanner(null);
      return undefined;
    }
    const unsubscribe = watchPlanner(activePlannerId, (plannerData) => {
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
  }, [activePlannerId]);

  useEffect(() => {
    if (!activePlannerId) {
      setEvents([]);
      return undefined;
    }
    const unsubscribe = watchEvents(activePlannerId, (eventList) => {
      setEvents(eventList);
    });
    return () => unsubscribe();
  }, [activePlannerId]);

  useEffect(() => {
    if (!activePlannerId) {
      setActivityIdeas([]);
      return undefined;
    }
    const unsubscribe = watchIdeas(activePlannerId, (ideasList) => {
      setActivityIdeas(ideasList);
    });
    return () => unsubscribe();
  }, [activePlannerId]);

  useEffect(() => {
    if (!activePlannerId || !user || !isAdminUser(user)) {
      setAuditEntries([]);
      return undefined;
    }
    const unsubscribe = watchChangelog(activePlannerId, (entries) => {
      setAuditEntries(entries);
    });
    return () => unsubscribe();
  }, [activePlannerId, user]);

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

  const addParticipant = useCallback(
    async (name: string, authorUid: string, userId?: string) => {
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
        lastModifiedBy: authorUid,
      });
      await appendChangelogEntry(activePlannerId, {
        actorUid: authorUid,
        actorEmail: user?.email,
        action: 'create',
        details: { target: 'participant', uid: participant.uid, name: participant.displayName },
      });
    },
    [activePlannerId, planner, user?.email],
  );

  const updateParticipant = useCallback(
    async (uid: string, name: string) => {
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
      await appendChangelogEntry(activePlannerId, {
        actorUid: user?.uid ?? 'unknown',
        actorEmail: user?.email,
        action: 'update',
        details: { target: 'participant', uid, name: trimmed },
      });
    },
    [activePlannerId, planner?.participants, user?.email, user?.uid],
  );

  const deleteParticipant = useCallback(
    async (uid: string) => {
      if (!activePlannerId || !planner) {
        throw new Error('No planner selected');
      }
      const participants = (planner.participants ?? []).filter((p) => p.uid !== uid);
      await updateDoc(plannerDoc(activePlannerId), {
        participants,
        participantUids: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      });
      await appendChangelogEntry(activePlannerId, {
        actorUid: user?.uid ?? 'unknown',
        actorEmail: user?.email,
        action: 'delete',
        details: { target: 'participant', uid },
      });
    },
    [activePlannerId, planner, user?.email, user?.uid],
  );

  const ensurePlannerId = useCallback(() => {
    if (!activePlannerId) {
      throw new Error('No planner selected');
    }
    return activePlannerId;
  }, [activePlannerId]);

  const addActivity = useCallback(
    async (event: PlannerEvent) => addEvent(ensurePlannerId(), event),
    [ensurePlannerId],
  );

  const updateActivity = useCallback(
    async (eventId: string, patch: Partial<PlannerEvent>) =>
      updateEvent(ensurePlannerId(), eventId, patch),
    [ensurePlannerId],
  );

  const deleteActivity = useCallback(
    async (eventId: string) => deleteEvent(ensurePlannerId(), eventId),
    [ensurePlannerId],
  );

  const addBlock = useCallback(
    async (event: PlannerEvent) => addEvent(ensurePlannerId(), event),
    [ensurePlannerId],
  );

  const addTravel = useCallback(
    async (event: PlannerEvent & { travelMode: TravelMode }) => addEvent(ensurePlannerId(), event),
    [ensurePlannerId],
  );

  const addActivityIdea = useCallback(
    async (idea: Idea) => addIdea(ensurePlannerId(), idea),
    [ensurePlannerId],
  );

  const updateActivityIdea = useCallback(
    async (id: string, patch: Partial<Idea>) => updateIdea(ensurePlannerId(), id, patch),
    [ensurePlannerId],
  );

  const deleteActivityIdea = useCallback(
    async (id: string) => deleteIdea(ensurePlannerId(), id),
    [ensurePlannerId],
  );

  const updatePlanSettings = useCallback(
    async (patch: Partial<PlannerSettings>) => {
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
      await updateDoc(plannerDoc(plannerRef), updates);
    },
    [ensurePlannerId],
  );

  const updatePlanDates = useCallback(
    async (startISO: string, endISO: string) => {
      if (new Date(startISO) > new Date(endISO)) {
        throw new Error('Start date must be before end date');
      }
      const plannerRef = ensurePlannerId();
      await updateDoc(plannerDoc(plannerRef), {
        startDate: startISO,
        endDate: endISO,
        updatedAt: serverTimestamp(),
      });
    },
    [ensurePlannerId],
  );

  const linkCostTracker = useCallback(
    async (trackerId: string) => linkCostTrackerHelper(ensurePlannerId(), trackerId),
    [ensurePlannerId],
  );

  const createLinkedCostTracker = useCallback(
    async (seed: CostTrackerSeed) => createAndLinkCostTracker(ensurePlannerId(), seed),
    [ensurePlannerId],
  );

  const uploadImage = useCallback(
    async (file: File, options?: { alreadyCompressed?: boolean }) => {
      const plannerRef = ensurePlannerId();
      const userId = user?.uid ?? 'anonymous';
      const now = new Date();
      const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      let payload = file;
      if (!options?.alreadyCompressed) {
        const compressed = await compressFile(file);
        const normalized = file.name.replace(/\.[^/.]+$/, '') || 'upload';
        payload = new File([compressed], `${normalized}.jpg`, { type: 'image/jpeg' });
      } else if (file.type !== 'image/jpeg') {
        const normalized = file.name.replace(/\.[^/.]+$/, '') || 'upload';
        payload = new File([file], `${normalized}.jpg`, { type: 'image/jpeg' });
      }
      const fileId = crypto.randomUUID();
      const storageRef = ref(storage, `${UPLOAD_ROOT}/${plannerRef}/${userId}/${folder}/${fileId}.jpg`);
      await uploadBytes(storageRef, payload, {
        contentType: 'image/jpeg',
      });
      return getDownloadURL(storageRef);
    },
    [ensurePlannerId, user?.uid],
  );

  const compressOldImages = useCallback(async () => {
    const plannerRef = ensurePlannerId();
    const rootRef = ref(storage, `${UPLOAD_ROOT}/${plannerRef}`);
    const list = await listAll(rootRef);
    const endDate = planner?.endDate ? new Date(planner.endDate) : null;
    const now = new Date();
    for (const userFolder of list.prefixes) {
      const monthListing = await listAll(userFolder);
      for (const monthFolder of monthListing.prefixes) {
        const files = await listAll(monthFolder);
        for (const item of files.items) {
          const metadata = await getMetadata(item);
          const uploadedAt = metadata.timeCreated ? new Date(metadata.timeCreated) : null;
          if (endDate && uploadedAt && endDate.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
            const download = await getDownloadURL(item);
            const response = await fetch(download);
            if (!response.ok) {
              continue;
            }
            const blob = await response.blob();
            const compressed = await compressFile(new File([blob], item.name, { type: blob.type }), 1600, 0.6);
            await uploadBytes(item, compressed, { contentType: 'image/jpeg' });
          }
          if (uploadedAt && uploadedAt.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
            await deleteObject(item);
          }
        }
      }
    }
  }, [ensurePlannerId, planner?.endDate]);

  const appendAudit = useCallback(
    async (entry: Omit<ChangeLogEntry, 'id' | 'createdAt'>) => {
      await appendChangelogEntry(ensurePlannerId(), entry);
    },
    [ensurePlannerId],
  );

  const getDayActivities = useCallback(
    (dateISO: string) => {
      const targetDate = dateISO.slice(0, 10);
      return events
        .filter((event) => {
          const dayDate = planner?.days?.[event.dayId]?.date?.slice(0, 10);
          if (dayDate) {
            return dayDate === targetDate;
          }
          return event.start.slice(0, 10) === targetDate;
        })
        .slice()
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
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
      auditEntries,
      daySchedules,
      isAdmin: isAdminUser(user),
      selectPlanner,
      createPlannerAndSelect,
      addParticipant,
      updateParticipant,
      deleteParticipant,
      addActivity,
      updateActivity,
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
      auditEntries,
      daySchedules,
      selectPlanner,
      createPlannerAndSelect,
      addParticipant,
      updateParticipant,
      deleteParticipant,
      addActivity,
      updateActivity,
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

