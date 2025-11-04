'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  CalendarClock,
  GripVertical,
  Hand,
  LucideIcon,
  Mountain,
  Plane,
  Train,
} from 'lucide-react';
import Button from '@/components/Button';
import type { AddItemMode, Planner, PlannerDay, PlannerEvent } from '../lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: layout metrics & keyboard movement semantics   */
/* ------------------------------------------------------------ */
const SIDEBAR_WIDTH = 112;
const COLUMN_MIN_WIDTH = 288;
const BASE_SLOT_HEIGHT = 40; // 60-minute slot height in pixels
const MIN_SLOT_HEIGHT = 12; // minimum pixel size per increment for tiny cadences
const KEYBOARD_NUDGE_MULTIPLIER = 1; // arrows move one increment at a time

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

interface DragState {
  eventId: string;
  mode: 'move' | 'resize-end';
  pointerId: number;
  originY: number;
  originalStart: string;
  originalEnd: string;
  lastAppliedDelta: number;
}

interface PlannerTimelineProps {
  planner: Planner;
  events: PlannerEvent[];
  onAddItem: (dayId: string, mode: AddItemMode) => void;
  onEdit: (event: PlannerEvent) => void;
  onResize: (eventId: string, newEnd: string) => void;
  onMove: (eventId: string, newStart: string, newEnd: string) => void;
  incrementMinutes: number;
  visibleHours: { start: number; end: number };
  timezone: string;
}

type PlannerDayMeta = PlannerDay & { headline?: string };

type DayDescriptor = {
  id: string;
  day: PlannerDayMeta;
};

const buildDate = (value: string) => new Date(value);

const toIso = (date: Date) => date.toISOString();

const addMinutes = (iso: string, minutes: number) => {
  const date = buildDate(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return toIso(date);
};

const diffMinutes = (start: string, end: string) =>
  (buildDate(end).getTime() - buildDate(start).getTime()) / 60000;

const minutesFromVisibleStart = (iso: string, visibleStartHour: number) => {
  const date = buildDate(iso);
  const baseline = new Date(date);
  baseline.setHours(visibleStartHour, 0, 0, 0);
  return (date.getTime() - baseline.getTime()) / 60000;
};

const getEventIcon = (event: PlannerEvent): LucideIcon => {
  if (event.type === 'travel') {
    return event.travelMode === 'flight' ? Plane : Train;
  }
  if (event.type === 'activity') {
    return Mountain;
  }
  return CalendarClock;
};

const buildDayDescriptors = (planner: Planner, events: PlannerEvent[]): DayDescriptor[] => {
  const mappedDays: Record<string, PlannerDayMeta> = { ...(planner.days ?? {}) };
  const seen = new Set<string>();
  const descriptors: DayDescriptor[] = [];

  const pushDescriptor = (id: string) => {
    if (seen.has(id)) return;
    const stored = mappedDays[id];
    if (stored) {
      descriptors.push({ id, day: stored });
      seen.add(id);
      return;
    }
    const eventForDay = events.find((event) => event.dayId === id);
    if (eventForDay) {
      const date = eventForDay.start.slice(0, 10);
      descriptors.push({ id, day: { id, date } });
      seen.add(id);
    }
  };

  if (planner.dayOrder?.length) {
    for (const id of planner.dayOrder) {
      pushDescriptor(id);
    }
  }

  for (const event of events) {
    pushDescriptor(event.dayId);
  }

  if (!descriptors.length) {
    // Fall back to range between planner start/end
    const start = buildDate(planner.startDate);
    const end = buildDate(planner.endDate);
    const cursor = new Date(start);
    while (cursor <= end) {
      const id = cursor.toISOString().slice(0, 10);
      descriptors.push({ id, day: { id, date: id } });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return descriptors;
};

export default function PlannerTimeline({
  planner,
  events,
  onAddItem,
  onEdit,
  onResize,
  onMove,
  incrementMinutes,
  visibleHours,
  timezone,
}: PlannerTimelineProps) {
  const pixelsPerMinute = BASE_SLOT_HEIGHT / 60;
  const pixelsPerIncrement = Math.max(MIN_SLOT_HEIGHT, pixelsPerMinute * incrementMinutes);
  const timelineHeight = useMemo(() => {
    const totalHours = Math.max(0, visibleHours.end - visibleHours.start);
    const totalMinutes = totalHours * 60;
    return totalMinutes * pixelsPerMinute;
  }, [pixelsPerMinute, visibleHours.end, visibleHours.start]);

  const hours = useMemo(() => {
    const result: number[] = [];
    for (let hour = visibleHours.start; hour <= visibleHours.end; hour += 1) {
      result.push(hour);
    }
    return result;
  }, [visibleHours.end, visibleHours.start]);

  const dayDescriptors = useMemo(
    () => buildDayDescriptors(planner, events),
    [planner, events],
  );

  const dragState = useRef<DragState | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState.current || event.pointerId !== dragState.current.pointerId) return;
      const deltaPixels = event.clientY - dragState.current.originY;
      const deltaIncrements = Math.round(deltaPixels / pixelsPerIncrement);
      if (deltaIncrements === dragState.current.lastAppliedDelta) return;
      dragState.current.lastAppliedDelta = deltaIncrements;
      const deltaMinutes = deltaIncrements * incrementMinutes;
      if (dragState.current.mode === 'move') {
        onMove(
          dragState.current.eventId,
          addMinutes(dragState.current.originalStart, deltaMinutes),
          addMinutes(dragState.current.originalEnd, deltaMinutes),
        );
      } else {
        onResize(
          dragState.current.eventId,
          addMinutes(dragState.current.originalEnd, deltaMinutes),
        );
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!dragState.current || event.pointerId !== dragState.current.pointerId) return;
      dragState.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragState.current) return;
      event.preventDefault();
      if (dragState.current.mode === 'move') {
        onMove(
          dragState.current.eventId,
          dragState.current.originalStart,
          dragState.current.originalEnd,
        );
      } else {
        onResize(dragState.current.eventId, dragState.current.originalEnd);
      }
      dragState.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [incrementMinutes, onMove, onResize, pixelsPerIncrement]);

  return (
    <section className="overflow-hidden rounded-xl3 border border-border bg-surface-1/80 shadow-md">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold">Timeline</h2>
          <p className="text-sm text-text-3">Times shown in {timezone.replace('_', ' ')}.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-3">
          <Hand size={16} />
          <span>Drag to move, pull the handle to resize, Esc to cancel.</span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <div
          role="grid"
          className="grid"
          style={{
            gridTemplateColumns: `${SIDEBAR_WIDTH}px repeat(${dayDescriptors.length}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))`,
          }}
        >
          <div className="border-r border-border/60 bg-surface-2/60">
            <div
              className="sticky top-0 border-b border-border/60 bg-surface-2/80 px-4 py-4 text-sm text-text-3"
              style={{ height: 74 }}
            >
              Time
            </div>
            <div style={{ height: timelineHeight }} className="relative">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-b border-border/25"
                  style={{
                    top: ((hour - visibleHours.start) * 60 * pixelsPerMinute),
                    height: 60 * pixelsPerMinute,
                  }}
                >
                  <span className="pointer-events-none select-none px-4 text-xs text-text-3">
                    {hour.toString().padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>
          </div>
          {dayDescriptors.map(({ id: dayId, day }) => {
            const columnEvents = events.filter((event) => event.dayId === dayId);
            return (
              <div
                key={dayId}
                role="gridcell"
                tabIndex={0}
                aria-label={`Itinerary for ${day.date}`}
                className="relative border-r border-border/50 bg-surface-1"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAddItem(dayId, 'activity');
                  }
                }}
              >
                <div className="sticky top-0 z-10 border-b border-border/60 bg-surface-1/95 px-4 py-4 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-text-3">
                        {DATE_FORMAT.format(new Date(day.date))}
                      </p>
                      <h3 className="text-lg font-semibold text-text">
                        {day.headline ?? 'Untitled day'}
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => onAddItem(dayId, 'block')}>
                        Block
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onAddItem(dayId, 'travel')}>
                        Travel
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onAddItem(dayId, 'idea')}>
                        Activity from list
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => onAddItem(dayId, 'activity')}>
                        New activity
                      </Button>
                    </div>
                  </div>
                  {day.notes && <p className="mt-3 text-sm text-text-3">{day.notes}</p>}
                </div>
                <div style={{ height: timelineHeight }} className="relative">
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 border-b border-border/15"
                      style={{
                        top: ((hour - visibleHours.start) * 60 * pixelsPerMinute),
                        height: 60 * pixelsPerMinute,
                      }}
                    />
                  ))}
                  {columnEvents.map((event) => {
                    const Icon = getEventIcon(event);
                    const offsetMinutes = minutesFromVisibleStart(event.start, visibleHours.start);
                    const duration = diffMinutes(event.start, event.end);
                    const top = Math.max(0, (offsetMinutes / incrementMinutes) * pixelsPerIncrement);
                    const height = Math.max((duration / incrementMinutes) * pixelsPerIncrement, MIN_SLOT_HEIGHT * 1.5);
                    return (
                      <article
                        key={event.id}
                        tabIndex={0}
                        aria-label={`${event.title} ${new Date(event.start).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}`}
                        className="group absolute left-4 right-4 cursor-grab rounded-xl border border-border bg-surface-2/95 p-4 shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ top, height }}
                        onClick={() => onEdit(event)}
                        onKeyDown={(keyboardEvent) => {
                          if (keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown') {
                            keyboardEvent.preventDefault();
                            const direction = keyboardEvent.key === 'ArrowUp' ? -1 : 1;
                            const delta = direction * KEYBOARD_NUDGE_MULTIPLIER * incrementMinutes;
                            onMove(event.id, addMinutes(event.start, delta), addMinutes(event.end, delta));
                          }
                        }}
                        onPointerDown={(pointerEvent) => {
                          if ((pointerEvent.target as HTMLElement).dataset.handle) return;
                          pointerEvent.preventDefault();
                          pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
                          dragState.current = {
                            eventId: event.id,
                            mode: 'move',
                            pointerId: pointerEvent.pointerId,
                            originY: pointerEvent.clientY,
                            originalStart: event.start,
                            originalEnd: event.end,
                            lastAppliedDelta: 0,
                          };
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-text-3">
                            <GripVertical size={16} />
                            <span>
                              {new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} –
                              {new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                          <button
                            type="button"
                            data-handle="resize"
                            aria-label="Resize item"
                            className="cursor-ns-resize rounded-md bg-surface-3/80 p-1 text-text-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                            onPointerDown={(pointerEvent) => {
                              pointerEvent.preventDefault();
                              pointerEvent.stopPropagation();
                              pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
                              dragState.current = {
                                eventId: event.id,
                                mode: 'resize-end',
                                pointerId: pointerEvent.pointerId,
                                originY: pointerEvent.clientY,
                                originalStart: event.start,
                                originalEnd: event.end,
                                lastAppliedDelta: 0,
                              };
                            }}
                          >
                            <GripVertical size={14} />
                          </button>
                        </div>
                        <div className="mt-3 flex items-start gap-3">
                          <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-accent">
                            <Icon size={18} />
                          </span>
                          <div className="space-y-1">
                            <h4 className="font-semibold text-text">{event.title}</h4>
                            {event.notes && <p className="text-sm text-text-3">{event.notes}</p>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="sticky bottom-0 border-t border-border/50 bg-surface-1/95 px-4 py-3 backdrop-blur">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-3">
                    <span>Add item quickly:</span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => onAddItem(dayId, 'block')}>
                        Block
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onAddItem(dayId, 'travel')}>
                        Travel
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onAddItem(dayId, 'idea')}>
                        From ideas
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onAddItem(dayId, 'activity')}>
                        Activity
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
