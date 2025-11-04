'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CalendarClock, Settings, Plus } from 'lucide-react';
import { serverTimestamp, setDoc } from 'firebase/firestore';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
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
import { auth } from './lib/firebase';

/* ------------------------------------------------------------ */
/* CONFIGURATION: timeline defaults mirrored for toolbar        */
/* ------------------------------------------------------------ */
export { INCREMENTS, DEFAULT_INCREMENT, DEFAULT_VISIBLE_HOURS };

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

const TripPlannerShell = () => {
  const {
    user,
    authLoading,
    planner,
    events,
    activityIdeas,
    daySchedules,
    isAdmin,
    addActivity,
    addBlock,
    addTravel,
    updateActivity,
    updatePlanSettings,
    linkCostTracker,
    getDayActivities,
    signIn,
    signUp,
    signOut,
    getAdminTripsList,
    createLinkedCostTracker,
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
  const [prefillIdea, setPrefillIdea] = useState<Idea | undefined>(undefined);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [adminTrips, setAdminTrips] = useState<{ id: string; name: string }[]>([]);
  const [adminTripsLoading, setAdminTripsLoading] = useState(false);

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

  useEffect(() => {
    let active = true;
    if (!isAdmin) {
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
  }, [getAdminTripsList, isAdmin]);

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
    setPrefillIdea(idea);
    setAddModalOpen(true);
  }, []);

  const deriveRecurrenceEvents = useCallback(
    (draft: PlannerEventDraft): PlannerEvent[] => {
      if (!plannerWithDays?.dayOrder?.length) {
        return [buildEventFromDraft(draft)];
      }
      const eventsToPersist: PlannerEvent[] = [];
      const baseEvent = buildEventFromDraft(draft);
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
        eventsToPersist.push(buildEventFromDraft(recurringDraft));
      }
      return eventsToPersist;
    },
    [plannerWithDays],
  );

  const handleAddItemSubmit = useCallback(
    async (draft: PlannerEventDraft) => {
      try {
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
        setAddModalOpen(false);
        setPrefillIdea(undefined);
      }
    },
    [addActivity, addBlock, addTravel, deriveRecurrenceEvents],
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

      const toDate = (hour: number, minute: number) =>
        new Date(`${dayMeta.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
      const clampToIncrement = (value: Date, roundUp = false) => {
        const minutes = value.getMinutes();
        const remainder = minutes % increment;
        if (remainder === 0) return value;
        const adjustment = roundUp ? increment - remainder : -remainder;
        value.setMinutes(minutes + adjustment);
        return value;
      };

      let cursor = clampToIncrement(toDate(visibleStart, 0));
      const limit = toDate(visibleEnd, 0);
      const sortedEvents = [...getDayActivities(dayMeta.date)].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      );

      for (const existing of sortedEvents) {
        const existingStart = new Date(existing.start);
        const existingEnd = new Date(existing.end);
        if (existingEnd <= cursor) {
          continue;
        }
        if (existingStart > cursor) {
          const gapMinutes = (existingStart.getTime() - cursor.getTime()) / 60000;
          if (gapMinutes >= durationMinutes) {
            break;
          }
        }
        cursor = clampToIncrement(new Date(existingEnd), true);
        if (cursor >= limit) {
          break;
        }
      }

      let startDate = cursor;
      let endDate = new Date(startDate.getTime() + durationMinutes * 60000);
      if (endDate > limit) {
        endDate = clampToIncrement(new Date(limit.getTime()), false);
        startDate = new Date(endDate.getTime() - durationMinutes * 60000);
        if (startDate < toDate(visibleStart, 0)) {
          startDate = clampToIncrement(toDate(visibleStart, 0));
          endDate = new Date(startDate.getTime() + durationMinutes * 60000);
        }
      }

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
          <p className="text-center text-text-2">No planner selected yet.</p>
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
            {isAdmin && (
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
              onEdit={(event) => console.log('Edit event placeholder', event.id)}
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
        incrementMinutes={settings.incrementMinutes}
        timezone={settings.timezone}
        onClose={() => {
          setAddModalOpen(false);
          setPrefillIdea(undefined);
        }}
        onSubmit={handleAddItemSubmit}
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
