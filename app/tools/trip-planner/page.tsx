'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CalendarClock, Settings, Plus } from 'lucide-react';
import { getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import AuthForm from '../trip-cost/components/AuthForm';
import { ADMIN_EMAIL } from '../trip-cost/firebaseConfig';
import { userDoc } from '../trip-cost/db';
import PlannerTimeline from './components/PlannerTimeline';
import PlannerSettingsPanel from './components/PlannerSettings';
import ActivityIdeasPanel from './components/ActivityIdeasPanel';
import MapPanel from './components/MapPanel';
import AddItemModal from './components/AddItemModal';
import { PlanProvider, usePlan } from './PlanContext';
import type {
  AddItemMode,
  Idea,
  Planner,
  PlannerDay,
  PlannerEvent,
  PlannerEventDraft,
  PlannerSettings,
  TravelMode,
} from './lib/types';
import {
  DEFAULT_INCREMENT,
  DEFAULT_VISIBLE_HOURS,
  DEFAULT_TIMEZONE,
  INCREMENTS,
} from './lib/config';
import { auth, isAdmin as isAdminUser } from './lib/firebase';
import { computeIdeaSlot } from './lib/scheduling';
import { plannerChangelogCol } from './lib/db';

/* ------------------------------------------------------------ */
/* CONFIGURATION: changelog fetch behavior                      */
/* ------------------------------------------------------------ */

const CHANGELOG_FETCH_LIMIT = 75;

/* ------------------------------------------------------------ */
/* CONFIGURATION: timeline defaults mirrored for toolbar        */
/* ------------------------------------------------------------ */

const buildEventFromDraft = (draft: PlannerEventDraft): PlannerEvent => {
  const base = {
    id: draft.id ?? crypto.randomUUID(),
    dayId: draft.dayId,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    timezone: draft.timezone,
    notes: draft.notes,
    images: draft.images,
  };

  if (draft.type === 'travel') {
    const metadata = draft.metadata ?? {};
    const travelMode = (metadata.travelMode as TravelMode) ?? 'other';
    return {
      ...base,
      type: 'travel',
      travelMode,
      companyName: metadata.companyName as string | undefined,
      confirmationCode: metadata.confirmationCode as string | undefined,
      companyPhone: metadata.companyPhone as string | undefined,
    };
  }

  if (draft.type === 'activity') {
    const metadata = draft.metadata ?? {};
    return {
      ...base,
      type: 'activity',
      address: metadata.address as string | undefined,
      tags: (metadata.tags as string[]) ?? undefined,
      companyName: metadata.companyName as string | undefined,
      contact: metadata.contact as string | undefined,
    };
  }

  return {
    ...base,
    type: 'block',
  };
};

interface PlannerChangelogEntry {
  id: string;
  type: string;
  actorUid: string;
  actorEmail?: string;
  details?: Record<string, unknown>;
  timestampISO: string;
}

interface PlannerChangelogModalProps {
  plannerId: string;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

const normalizeChangelogTimestamp = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in (value as Record<string, unknown>)) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch (error) {
      console.error('Failed to normalize changelog timestamp', error);
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
};

const PlannerChangelogModal = ({ plannerId, open, onClose, isAdmin }: PlannerChangelogModalProps) => {
  const [entries, setEntries] = useState<PlannerChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!open) {
      return () => {
        active = false;
      };
    }

    if (!plannerId || !isAdmin) {
      setEntries([]);
      setError(
        isAdmin
          ? 'A planner must be selected to view changelog entries.'
          : 'Only administrators can view the changelog.',
      );
      return () => {
        active = false;
      };
    }

    const fetchEntries = async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query(plannerChangelogCol(plannerId), orderBy('ts', 'desc'), limit(CHANGELOG_FETCH_LIMIT));
        const snapshot = await getDocs(q);
        if (!active) {
          return;
        }
        const mapped: PlannerChangelogEntry[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            type: typeof data.type === 'string' ? data.type : 'unknown',
            actorUid: typeof data.actorUid === 'string' ? data.actorUid : 'unknown',
            actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : undefined,
            details: (data.details as Record<string, unknown> | undefined) ?? undefined,
            timestampISO: normalizeChangelogTimestamp(data.ts),
          };
        });
        setEntries(mapped);
      } catch (fetchError) {
        if (!active) {
          return;
        }
        console.error('Failed to load planner changelog', fetchError);
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load changelog entries.');
        setEntries([]);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchEntries();

    return () => {
      active = false;
    };
  }, [open, plannerId, isAdmin]);

  if (!open) {
    return null;
  }

  const renderDetails = (details?: Record<string, unknown>) => {
    if (!details || Object.keys(details).length === 0) {
      return <span className="text-text-3">No additional details</span>;
    }
    return (
      <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2/70 p-3 text-sm text-text-2 shadow-inner">
        {JSON.stringify(details, null, 2)}
      </pre>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl3 border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold">Planner changelog</h2>
            <p className="text-sm text-text-2">Chronological actions across the planner, newest first.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="max-h-[28rem] overflow-y-auto px-6 py-6">
          {!isAdmin && (
            <p className="text-sm text-error">You do not have permission to view the changelog.</p>
          )}
          {isAdmin && loading && (
            <p className="text-sm text-text-2">Loading changelog entries…</p>
          )}
          {isAdmin && !loading && error && (
            <p className="text-sm text-error">{error}</p>
          )}
          {isAdmin && !loading && !error && entries.length === 0 && (
            <p className="text-sm text-text-2">No changelog entries have been recorded yet.</p>
          )}
          {isAdmin && !loading && !error && entries.length > 0 && (
            <ul className="space-y-4">
              {entries.map((entry) => {
                const timestamp = entry.timestampISO
                  ? new Date(entry.timestampISO).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'Unknown time';
                return (
                  <li key={entry.id} className="rounded-xl2 border border-border/60 bg-surface-2/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
                      <span className="font-medium text-text">{timestamp}</span>
                      <span aria-hidden="true">•</span>
                      <span>{entry.actorEmail ?? 'Unknown actor'}</span>
                      <span aria-hidden="true">•</span>
                      <span className="uppercase tracking-wide text-xs text-text-3">{entry.type}</span>
                    </div>
                    {renderDetails(entry.details)}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const TripPlannerShell = () => {
  const {
    user,
    authLoading,
    planner,
    events,
    activityIdeas,
    daySchedules,
    addActivity,
    addBlock,
    addTravel,
    updateEvent,
    updateActivity,
    deleteEvent,
    updatePlanSettings,
    linkCostTracker,
    getDayActivities,
    signIn,
    signUp,
    signOut,
    getAdminTripsList,
    createLinkedCostTracker,
    createPlannerAndSelect,
  } = usePlan();

  const [showAuth, setShowAuth] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalMode, setAddModalMode] = useState<AddItemMode>('block');
  const [modalDayId, setModalDayId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<PlannerEvent | null>(null);
  const [prefillIdea, setPrefillIdea] = useState<Idea | undefined>(undefined);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [adminTrips, setAdminTrips] = useState<{ id: string; name: string }[]>([]);
  const [adminTripsLoading, setAdminTripsLoading] = useState(false);
  const [showCreatePlanner, setShowCreatePlanner] = useState(false);
  const [plannerName, setPlannerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showAuditLog, setShowAuditLog] = useState(false);

  useEffect(() => {
    if (!planner) {
      setActiveDayId(null);
      return;
    }
    if (activeDayId) return;
    const firstDay = planner.dayOrder?.[0] ?? daySchedules[0]?.dayId ?? null;
    if (firstDay) {
      setActiveDayId(firstDay);
    }
  }, [planner, daySchedules, activeDayId]);

  const isAdminUserFlag = user ? isAdminUser(user) : false;

  useEffect(() => {
    let active = true;
    if (!isAdminUserFlag) {
      setAdminTrips([]);
      setAdminTripsLoading(false);
      return () => {
        active = false;
      };
    }

    setAdminTripsLoading(true);
    getAdminTripsList()
      .then((trips) => {
        if (active) {
          setAdminTrips(trips);
        }
      })
      .catch((error) => {
        if (active) {
          console.error('Failed to load Trip Cost trips for admin linking', error);
        }
      })
      .finally(() => {
        if (active) {
          setAdminTripsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [getAdminTripsList, isAdminUserFlag]);

  const plannerWithDays: Planner | null = useMemo(() => {
    if (!planner) return null;
    const derivedDayOrder =
      planner.dayOrder && planner.dayOrder.length > 0
        ? planner.dayOrder
        : daySchedules.map((schedule) => schedule.dayId);
    const derivedDays: Record<string, PlannerDay> = { ...(planner.days ?? {}) };
    for (const schedule of daySchedules) {
      if (!derivedDays[schedule.dayId]) {
        derivedDays[schedule.dayId] = {
          id: schedule.dayId,
          date: schedule.date,
        };
      }
    }
    return { ...planner, dayOrder: derivedDayOrder, days: derivedDays };
  }, [planner, daySchedules]);

  const settings: PlannerSettings = useMemo(() => {
    if (plannerWithDays?.settings) return plannerWithDays.settings;
    return {
      incrementMinutes: DEFAULT_INCREMENT,
      visibleHours: DEFAULT_VISIBLE_HOURS,
      timezone: plannerWithDays?.timezone ?? DEFAULT_TIMEZONE,
    };
  }, [plannerWithDays]);

  const filteredEvents = useMemo(() => {
    if (!activeDayId) return events;
    return events.filter((event) => event.dayId === activeDayId);
  }, [events, activeDayId]);

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signIn(authEmail, authPassword);
      } else {
        await signUp(authEmail, authPassword, `${firstName} ${lastInitial}`.trim());
        if (auth.currentUser) {
          await setDoc(
            userDoc(auth.currentUser.uid),
            {
              uid: auth.currentUser.uid,
              email: authEmail,
              displayName: `${firstName} ${lastInitial}`.trim(),
              firstName,
              lastInitial,
              isAdmin: authEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
      setShowAuth(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed');
    }
  };

  const handleSignOut = useCallback(async () => {
    await signOut();
    setActiveDayId(null);
  }, [signOut]);

  const openAddItemModal = useCallback((dayId: string, mode: AddItemMode, idea?: Idea) => {
    setModalDayId(dayId);
    setAddModalMode(mode);
    setEditingEvent(null);
    setPrefillIdea(idea);
    setAddModalOpen(true);
  }, []);

  const closeAddItemModal = useCallback(() => {
    setAddModalOpen(false);
    setPrefillIdea(undefined);
    setEditingEvent(null);
  }, []);

  const deriveRecurrenceEvents = useCallback(
    (draft: PlannerEventDraft): PlannerEvent[] => {
      if (!plannerWithDays?.dayOrder?.length) {
        return [buildEventFromDraft(draft)];
      }
      const eventsToPersist: PlannerEvent[] = [];
      const shouldApplyGroup = draft.recurrence.mode !== 'none';
      const groupId = shouldApplyGroup ? crypto.randomUUID() : undefined;
      const baseEvent = groupId ? { ...buildEventFromDraft(draft), groupId } : buildEventFromDraft(draft);
      eventsToPersist.push(baseEvent);
      const startIndex = plannerWithDays.dayOrder.findIndex((dayId) => dayId === draft.dayId);
      if (startIndex < 0) {
        return eventsToPersist;
      }
      if (draft.recurrence.mode === 'none') {
        return eventsToPersist;
      }
      const timePortionStart = draft.start.split('T')[1] ?? '';
      const timePortionEnd = draft.end.split('T')[1] ?? '';
      const totalRepeats =
        draft.recurrence.mode === 'daily-count'
          ? draft.recurrence.count
          : plannerWithDays.dayOrder.length - startIndex;
      for (let offset = 1; offset < totalRepeats; offset++) {
        const dayRef = plannerWithDays.dayOrder[startIndex + offset];
        if (!dayRef) break;
        const dayMeta = plannerWithDays.days?.[dayRef];
        if (!dayMeta) continue;
        const startIso = new Date(`${dayMeta.date}T${timePortionStart || '00:00'}`).toISOString();
        const endIso = new Date(`${dayMeta.date}T${timePortionEnd || '00:00'}`).toISOString();
        const recurringDraft: PlannerEventDraft = {
          ...draft,
          dayId: dayRef,
          start: startIso,
          end: endIso,
        };
        const recurringEvent = groupId
          ? { ...buildEventFromDraft(recurringDraft), groupId }
          : buildEventFromDraft(recurringDraft);
        eventsToPersist.push(recurringEvent);
      }
      return eventsToPersist;
    },
    [plannerWithDays],
  );

  const handleEditEvent = useCallback((event: PlannerEvent) => {
    setModalDayId(event.dayId);
    setAddModalMode(event.type);
    setEditingEvent(event);
    setAddModalOpen(true);
  }, []);

  const handleAddItemSubmit = useCallback(
    async (draft: PlannerEventDraft, options?: { applyToSeries?: boolean }) => {
      try {
        if (editingEvent) {
          const metadata = draft.metadata ?? {};
          const basePatch: Partial<PlannerEvent> = {
            type: draft.type,
            dayId: draft.dayId,
            title: draft.title,
            notes: draft.notes,
            start: draft.start,
            end: draft.end,
            timezone: draft.timezone,
            images: draft.images,
          };

          if (draft.type === 'travel') {
            basePatch.travelMode = (metadata.travelMode as TravelMode) ?? 'other';
            basePatch.companyName = metadata.companyName as string | undefined;
            basePatch.confirmationCode = metadata.confirmationCode as string | undefined;
            basePatch.companyPhone = metadata.companyPhone as string | undefined;
          } else if (draft.type === 'activity') {
            basePatch.address = metadata.address as string | undefined;
            basePatch.tags = (metadata.tags as string[]) ?? undefined;
            basePatch.companyName = metadata.companyName as string | undefined;
            basePatch.contact = metadata.contact as string | undefined;
          }

          const applySeries = Boolean(options?.applyToSeries && editingEvent.groupId);
          const detachFromSeries = Boolean(editingEvent.groupId && !applySeries);

          const patchPayload: Partial<PlannerEvent> = { ...basePatch };
          if (applySeries) {
            delete (patchPayload as Record<string, unknown>).dayId;
            delete (patchPayload as Record<string, unknown>).start;
            delete (patchPayload as Record<string, unknown>).end;
          }

          await updateEvent(editingEvent.id, patchPayload, {
            applyToSeries: applySeries,
            groupId: editingEvent.groupId,
            detachFromSeries,
          });
          return;
        }

        const eventsToSave = deriveRecurrenceEvents(draft).map((event) =>
          event.type === 'activity' && draft.images?.length
            ? { ...event, images: [...(event.images ?? []), ...draft.images] }
            : event,
        );

        for (const event of eventsToSave) {
          if (event.type === 'activity') {
            await addActivity(event);
          } else if (event.type === 'travel') {
            await addTravel(event);
          } else {
            await addBlock(event);
          }
        }
      } finally {
        closeAddItemModal();
      }
    },
    [
      addActivity,
      addBlock,
      addTravel,
      closeAddItemModal,
      deriveRecurrenceEvents,
      editingEvent,
      updateEvent,
    ],
  );

  const handleDeleteEvent = useCallback(
    async (applySeries?: boolean) => {
      if (!editingEvent) return;
      try {
        await deleteEvent(editingEvent.id, {
          applyToSeries: Boolean(applySeries && editingEvent.groupId),
          groupId: editingEvent.groupId,
        });
      } finally {
        closeAddItemModal();
      }
    },
    [closeAddItemModal, deleteEvent, editingEvent],
  );

  const handleCreateOrLink = useCallback(async () => {
    if (!plannerWithDays) return;
    try {
      if (plannerWithDays.costTrackerId) {
        const url = `/tools/trip-cost?tripId=${plannerWithDays.costTrackerId}`;
        window.open(url, '_blank', 'noopener');
        return;
      }
      const trackerId = await createLinkedCostTracker({
        name: plannerWithDays.name,
        ownerUid: plannerWithDays.ownerUid,
        participants: (plannerWithDays.participants ?? []).map((participant) => ({
          id: participant.uid,
          name: participant.displayName,
          userId: participant.uid,
        })),
      });
      const url = `/tools/trip-cost?tripId=${trackerId}`;
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      console.error('Link cost tracker failed', error);
    }
  }, [createLinkedCostTracker, plannerWithDays]);

  const handleAdminLinkChange = useCallback(
    async (event: ChangeEvent<HTMLSelectElement>) => {
      if (!plannerWithDays) return;
      const selectedId = event.target.value;
      if (!selectedId || selectedId === plannerWithDays.costTrackerId) {
        return;
      }
      try {
        await linkCostTracker(selectedId);
      } catch (error) {
        console.error('Admin assignment of cost tracker failed', error);
      }
    },
    [linkCostTracker, plannerWithDays],
  );

  const scheduleIdeaDirectly = useCallback(
    async (dayId: string, idea: Idea) => {
      if (!plannerWithDays?.days?.[dayId]) return;
      const dayMeta = plannerWithDays.days[dayId];
      const visibleStart = settings.visibleHours.start;
      const visibleEnd = settings.visibleHours.end;
      const increment = settings.incrementMinutes;
      const durationMinutes = idea.suggestedDurationMinutes ?? increment * 2;

      const { start: startDate, end: endDate } = computeIdeaSlot({
        dayDate: dayMeta.date,
        visibleStartHour: visibleStart,
        visibleEndHour: visibleEnd,
        incrementMinutes: increment,
        durationMinutes,
        existingEvents: getDayActivities(dayMeta.date).map((event) => ({
          start: event.start,
          end: event.end,
        })),
      });

      const event: PlannerEvent = {
        id: crypto.randomUUID(),
        type: 'activity',
        dayId,
        title: idea.title,
        notes: idea.description,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone: settings.timezone,
        address: idea.address,
        tags: idea.tags,
        images: idea.images,
      };

      await addActivity(event);
    },
    [
      addActivity,
      getDayActivities,
      plannerWithDays,
      settings.incrementMinutes,
      settings.timezone,
      settings.visibleHours.end,
      settings.visibleHours.start,
    ],
  );

  const handleCreatePlannerSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!user) {
        return;
      }
      const trimmedName = plannerName.trim();
      if (!trimmedName) {
        return;
      }
      try {
        await createPlannerAndSelect({
          name: trimmedName,
          startDate,
          endDate,
          timezone: DEFAULT_TIMEZONE,
          ownerUid: user.uid,
        });
        setPlannerName('');
        setStartDate('');
        setEndDate('');
        setActiveDayId(null);
        setShowCreatePlanner(false);
      } catch (error) {
        console.error('Failed to create planner', error);
      }
    },
    [
      createPlannerAndSelect,
      endDate,
      plannerName,
      setActiveDayId,
      startDate,
      user,
    ],
  );

  const handleCancelCreatePlanner = useCallback(() => {
    setShowCreatePlanner(false);
    setPlannerName('');
    setStartDate('');
    setEndDate('');
  }, []);

  if (authLoading) {
    return (
      <main className="bg-bg text-text min-h-dvh">
        <Nav />
        <section className="container-tight py-16 sm:py-24">
          <p className="text-center text-text-2">Checking authentication…</p>
        </section>
      </main>
    );
  }

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
          setIsLogin((prev) => !prev);
          setAuthError('');
        }}
      />
    );
  }

  if (!plannerWithDays) {
    return (
      <main className="bg-bg text-text min-h-dvh">
        <Nav />
        <section className="container-tight py-16 sm:py-24">
          {!showCreatePlanner ? (
            <div className="mx-auto max-w-xl rounded-xl3 border border-border bg-surface-1/80 p-10 text-center shadow-xl">
              <h1 className="text-3xl font-semibold">Let&rsquo;s start a new planner</h1>
              <p className="mt-4 text-text-2">
                Create your first collaborative itinerary to unlock the timeline, saved ideas, and map view.
              </p>
              <Button
                type="button"
                className="mt-8"
                onClick={() => setShowCreatePlanner(true)}
              >
                Start planning
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-xl">
              <form
                onSubmit={handleCreatePlannerSubmit}
                className="space-y-8 rounded-xl3 border border-border bg-surface-1/80 p-10 shadow-xl"
              >
                <div className="space-y-3 text-center">
                  <h1 className="text-3xl font-semibold">New Trip Planner</h1>
                  <p className="text-text-2">
                    Give your planner a name and choose the travel window to begin organizing your trip.
                  </p>
                </div>
                <Input
                  label="Planner name"
                  value={plannerName}
                  onChange={(event) => setPlannerName(event.target.value)}
                  placeholder="Summer in Kyoto"
                  required
                />
                <div className="grid gap-6 sm:grid-cols-2">
                  <Input
                    label="Start date"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    required
                  />
                  <Input
                    label="End date"
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:justify-end">
                  <Button type="submit" variant="primary" className="w-full sm:w-auto">
                    Create Planner
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={handleCancelCreatePlanner}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-16 sm:py-24 space-y-12">
        <header className="space-y-6 text-center sm:text-left">
          <div className="inline-flex items-center gap-3 rounded-xl3 border border-border bg-surface-1/80 px-4 py-2 text-sm text-text-3 shadow-glow">
            <CalendarClock size={18} className="text-accent" />
            <span>
              {plannerWithDays.costTrackerId
                ? `Linked to Trip Cost ID: ${plannerWithDays.costTrackerId}`
                : 'Not yet linked to Trip Cost'}
            </span>
          </div>
          <div>
            <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">
              Trip Planner
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-text-2">
              Craft a collaborative itinerary with timeline precision, saved ideas, and a shared map overview.
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-4 rounded-xl3 border border-border bg-surface-1/80 p-4 shadow-md">
          <Button variant="primary" onClick={handleCreateOrLink} className="inline-flex items-center gap-2">
            <Plus size={16} />
            {plannerWithDays.costTrackerId ? 'Open cost tracker' : 'Create cost tracker'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setShowSettingsPanel(true)}
            className="inline-flex items-center gap-2"
          >
            <Settings size={16} />
            Settings
          </Button>
          <div className="ml-auto flex items-center gap-3">
            {isAdminUserFlag && (
              <div className="flex items-center gap-3">
                <Select
                  value={plannerWithDays.costTrackerId ?? ''}
                  onChange={handleAdminLinkChange}
                  aria-label="Assign to cost tracker"
                  disabled={adminTripsLoading}
                >
                  <option value="">
                    {adminTripsLoading ? 'Loading Trip Cost trips…' : 'Assign to cost tracker'}
                  </option>
                  {adminTrips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => setShowAuditLog(true)}>
                  View changelog
                </Button>
              </div>
            )}
            <Select
              value={String(settings.incrementMinutes)}
              onChange={(event) => updatePlanSettings({ incrementMinutes: Number(event.target.value) })}
              aria-label="Timeline increment"
            >
              {INCREMENTS.map((value) => (
                <option key={value} value={value}>
                  {value} min increments
                </option>
              ))}
            </Select>
            <Button variant="ghost" onClick={() => setShowAuth(true)}>
              Account
            </Button>
            <Button variant="ghost" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <PlannerTimeline
              planner={plannerWithDays}
              events={events}
              onAddItem={(dayId, mode) => openAddItemModal(dayId, mode)}
              onEdit={handleEditEvent}
              onResize={(eventId, newEnd) => updateActivity(eventId, { end: newEnd })}
              onMove={(eventId, newStart, newEnd) => updateActivity(eventId, { start: newStart, end: newEnd })}
              incrementMinutes={settings.incrementMinutes}
              visibleHours={settings.visibleHours}
              timezone={settings.timezone}
            />
            <MapPanel
              planner={plannerWithDays}
              events={filteredEvents}
              activeDayId={activeDayId}
              onSelectDay={setActiveDayId}
            />
          </div>
          <div className="space-y-6">
            <ActivityIdeasPanel
              ideas={activityIdeas}
              planner={plannerWithDays}
              activeDayId={activeDayId}
              onSelectDay={setActiveDayId}
              onScheduleIdea={(dayId, idea) => scheduleIdeaDirectly(dayId, idea)}
            />
            <PlannerSettingsPanel settings={settings} onChange={updatePlanSettings} />
          </div>
        </div>
      </section>

      {showSettingsPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
          <div className="w-full max-w-3xl rounded-xl3 border border-border bg-surface-1 shadow-2xl">
            <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <h2 className="text-xl font-semibold">Planner settings</h2>
              <Button variant="ghost" onClick={() => setShowSettingsPanel(false)}>
                Close
              </Button>
            </header>
            <div className="px-6 py-6">
              <PlannerSettingsPanel settings={settings} onChange={updatePlanSettings} />
            </div>
          </div>
        </div>
      )}

      <AddItemModal
        open={addModalOpen}
        mode={addModalMode}
        day={modalDayId ? plannerWithDays.days?.[modalDayId] : undefined}
        idea={prefillIdea}
        initialData={editingEvent ?? undefined}
        incrementMinutes={settings.incrementMinutes}
        timezone={settings.timezone}
        onClose={closeAddItemModal}
        onSubmit={handleAddItemSubmit}
        onDelete={handleDeleteEvent}
      />
      <PlannerChangelogModal
        plannerId={plannerWithDays.id}
        open={showAuditLog}
        onClose={() => setShowAuditLog(false)}
        isAdmin={isAdminUserFlag}
      />
    </main>
  );
};

export default function TripPlannerPage() {
  return (
    <PlanProvider>
      <TripPlannerShell />
    </PlanProvider>
  );
}
