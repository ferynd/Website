'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, Hand } from 'lucide-react';
import Button from '@/components/Button';
import type { AddItemMode, Planner, PlannerDay, PlannerEvent } from '../lib/types';
import { getEventIcon } from '../lib/icons';

/* ------------------------------------------------------------ */
/* CONFIGURATION: layout metrics & keyboard movement semantics   */
/* ------------------------------------------------------------ */
const SIDEBAR_WIDTH = 112;
const COLUMN_MIN_WIDTH = 288;
const BASE_SLOT_HEIGHT = 40; // 60-minute slot height in pixels
const MIN_SLOT_HEIGHT = 12; // minimum pixel size per increment for tiny cadences
const KEYBOARD_NUDGE_MULTIPLIER = 1; // arrows move one increment at a time
const CLIPPED_BADGE_LABEL = '⏰ clipped';
const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

interface DragState {
  dayId: string;
  eventId: string;
  mode: 'move' | 'resize-end';
  pointerId: number;
  pointerTarget: HTMLElement | null;
  originY: number;
  originalStart: string;
  originalEnd: string;
  pendingStart: string;
  pendingEnd: string;
  lastAppliedDelta: number;
  minimumDurationMinutes: number;
  applyPreview: (start: string, end: string) => void;
  clearPreview: () => void;
  commit: (start: string, end: string) => void;
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const TIMEZONE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

const OFFSET_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'shortOffset',
};

const getFormatterForZone = (timeZone: string) => {
  const existing = TIMEZONE_FORMATTER_CACHE.get(timeZone);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...OFFSET_FORMAT_OPTIONS,
    timeZone,
  });
  TIMEZONE_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const formatter = getFormatterForZone(timeZone);
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    if (part.type === 'timeZoneName') {
      const match = part.value.match(/GMT([+-])(\d{2})(?::(\d{2}))?/);
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const hours = parseInt(match[2] ?? '0', 10);
        const minutes = parseInt(match[3] ?? '0', 10);
        map.offset = sign * (hours * 60 + minutes);
      }
      continue;
    }
    map[part.type] = parseInt(part.value, 10);
  }
  const year = map.year ?? 1970;
  const month = (map.month ?? 1) - 1;
  const day = map.day ?? 1;
  const hour = map.hour ?? 0;
  const minute = map.minute ?? 0;
  const second = map.second ?? 0;
  const assumedUtc = Date.UTC(year, month, day, hour, minute, second);
  const actual = date.getTime();
  if (Number.isFinite(map.offset)) {
    return map.offset as number;
  }
  return Math.round((assumedUtc - actual) / 60000);
};

const snapISO = (iso: string, timeZone: string, incrementMinutes: number) => {
  const baseDate = buildDate(iso);
  if (Number.isNaN(baseDate.getTime()) || !Number.isFinite(incrementMinutes) || incrementMinutes <= 0) {
    return iso;
  }
  const incrementMs = incrementMinutes * 60000;
  let offsetMinutes = getTimeZoneOffsetMinutes(baseDate, timeZone);
  const localMs = baseDate.getTime() + offsetMinutes * 60000;
  const roundedLocal = Math.round(localMs / incrementMs) * incrementMs;
  let candidate = new Date(roundedLocal - offsetMinutes * 60000);
  for (let i = 0; i < 3; i += 1) {
    const refreshedOffset = getTimeZoneOffsetMinutes(candidate, timeZone);
    if (refreshedOffset === offsetMinutes) {
      break;
    }
    offsetMinutes = refreshedOffset;
    candidate = new Date(roundedLocal - offsetMinutes * 60000);
  }
  return candidate.toISOString();
};

const minutesFromVisibleStart = (iso: string, visibleStartHour: number) => {
  const date = buildDate(iso);
  const baseline = new Date(date);
  baseline.setHours(visibleStartHour, 0, 0, 0);
  return (date.getTime() - baseline.getTime()) / 60000;
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

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, PlannerEvent[]> = {};
    for (const descriptor of dayDescriptors) {
      grouped[descriptor.id] = [];
    }
    for (const event of events) {
      if (!grouped[event.dayId]) {
        grouped[event.dayId] = [];
      }
      grouped[event.dayId].push(event);
    }
    return grouped;
  }, [dayDescriptors, events]);

  const dragState = useRef<DragState | null>(null);
  const pendingPointerY = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pixelsPerIncrementRef = useRef(pixelsPerIncrement);
  const incrementMinutesRef = useRef(incrementMinutes);
  const timezoneRef = useRef(timezone);

  useEffect(() => {
    pixelsPerIncrementRef.current = pixelsPerIncrement;
  }, [pixelsPerIncrement]);

  useEffect(() => {
    incrementMinutesRef.current = incrementMinutes;
  }, [incrementMinutes]);

  useEffect(() => {
    timezoneRef.current = timezone;
  }, [timezone]);

  useEffect(() => {
    const finalizeDrag = (shouldCommit: boolean) => {
      const drag = dragState.current;
      if (!drag) return;
      drag.clearPreview();
      if (shouldCommit) {
        if (drag.mode === 'move') {
          drag.commit(drag.pendingStart, drag.pendingEnd);
        } else {
          drag.commit(drag.originalStart, drag.pendingEnd);
        }
      }
      if (drag.pointerTarget?.releasePointerCapture) {
        try {
          drag.pointerTarget.releasePointerCapture(drag.pointerId);
        } catch {
          // ignore if pointer capture already released
        }
      }
      dragState.current = null;
      pendingPointerY.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const processPointerMove = () => {
      rafIdRef.current = null;
      const drag = dragState.current;
      const latestY = pendingPointerY.current;
      pendingPointerY.current = null;
      if (!drag || latestY == null) return;
      const localPixelsPerIncrement = pixelsPerIncrementRef.current;
      const localIncrementMinutes = incrementMinutesRef.current;
      if (!localPixelsPerIncrement || !localIncrementMinutes) return;
      const deltaPixels = latestY - drag.originY;
      const deltaIncrements = Math.round(deltaPixels / localPixelsPerIncrement);
      if (deltaIncrements === drag.lastAppliedDelta) return;
      drag.lastAppliedDelta = deltaIncrements;
      const deltaMinutes = deltaIncrements * localIncrementMinutes;
      if (drag.mode === 'move') {
        const newStart = snapISO(
          addMinutes(drag.originalStart, deltaMinutes),
          timezoneRef.current,
          localIncrementMinutes,
        );
        const newEnd = snapISO(
          addMinutes(drag.originalEnd, deltaMinutes),
          timezoneRef.current,
          localIncrementMinutes,
        );
        drag.pendingStart = newStart;
        drag.pendingEnd = newEnd;
        drag.applyPreview(newStart, newEnd);
      } else {
        const rawEnd = addMinutes(drag.originalEnd, deltaMinutes);
        const snappedEnd = snapISO(rawEnd, timezoneRef.current, localIncrementMinutes);
        const minimumEndIso = addMinutes(
          drag.originalStart,
          Math.max(drag.minimumDurationMinutes, localIncrementMinutes),
        );
        const minimumEndDate = buildDate(minimumEndIso);
        const snappedEndDate = buildDate(snappedEnd);
        const safeEnd =
          snappedEndDate.getTime() <= minimumEndDate.getTime()
            ? snapISO(minimumEndIso, timezoneRef.current, localIncrementMinutes)
            : snappedEnd;
        drag.pendingStart = drag.originalStart;
        drag.pendingEnd = safeEnd;
        drag.applyPreview(drag.originalStart, safeEnd);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      pendingPointerY.current = event.clientY;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(processPointerMove);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      finalizeDrag(true);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragState.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      finalizeDrag(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragState.current) return;
      event.preventDefault();
      finalizeDrag(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const snapToIncrement = useCallback(
    (iso: string) => snapISO(iso, timezone, incrementMinutes),
    [timezone, incrementMinutes],
  );

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
                    top: (hour - visibleHours.start) * 60 * pixelsPerMinute,
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
          {dayDescriptors.map((descriptor) => (
            <DayColumn
              key={descriptor.id}
              descriptor={descriptor}
              events={eventsByDay[descriptor.id] ?? []}
              hours={hours}
              visibleHours={visibleHours}
              timelineHeight={timelineHeight}
              pixelsPerMinute={pixelsPerMinute}
              incrementMinutes={incrementMinutes}
              onAddItem={onAddItem}
              onEdit={onEdit}
              onMove={onMove}
              onResize={onResize}
              onStartDrag={(state) => {
                dragState.current = state;
              }}
              snapToIncrement={snapToIncrement}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface DraftRecord {
  start: string;
  end: string;
}

interface DayColumnProps {
  descriptor: DayDescriptor;
  events: PlannerEvent[];
  hours: number[];
  visibleHours: { start: number; end: number };
  timelineHeight: number;
  pixelsPerMinute: number;
  incrementMinutes: number;
  onAddItem: (dayId: string, mode: AddItemMode) => void;
  onEdit: (event: PlannerEvent) => void;
  onMove: (eventId: string, newStart: string, newEnd: string) => void;
  onResize: (eventId: string, newEnd: string) => void;
  onStartDrag: (state: DragState) => void;
  snapToIncrement: (iso: string) => string;
}

const DayColumn = memo(function DayColumn({
  descriptor,
  events,
  hours,
  visibleHours,
  timelineHeight,
  pixelsPerMinute,
  incrementMinutes,
  onAddItem,
  onEdit,
  onMove,
  onResize,
  onStartDrag,
  snapToIncrement,
}: DayColumnProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftRecord>>({});

  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!events.find((event) => event.id === key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [events]);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => buildDate(a.start).getTime() - buildDate(b.start).getTime()),
    [events],
  );

  const originalMap = useMemo(() => {
    const map = new Map<string, PlannerEvent>();
    for (const event of sortedEvents) {
      map.set(event.id, event);
    }
    return map;
  }, [sortedEvents]);

  const effectiveEvents = useMemo(
    () =>
      sortedEvents.map((event) => {
        const draft = drafts[event.id];
        return draft ? { ...event, start: draft.start, end: draft.end } : event;
      }),
    [sortedEvents, drafts],
  );

  const applyDraft = useCallback((eventId: string, start: string, end: string) => {
    setDrafts((prev) => {
      const existing = prev[eventId];
      if (existing && existing.start === start && existing.end === end) {
        return prev;
      }
      return { ...prev, [eventId]: { start, end } };
    });
  }, []);

  const clearDraft = useCallback((eventId: string) => {
    setDrafts((prev) => {
      if (!prev[eventId]) return prev;
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }, []);

  const handleDayKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onAddItem(descriptor.id, 'activity');
      }
    },
    [descriptor.id, onAddItem],
  );

  const startDrag = useCallback(
    (baseEvent: PlannerEvent, pointerEvent: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize-end') => {
      pointerEvent.preventDefault();
      if (mode === 'resize-end') {
        pointerEvent.stopPropagation();
      }
      const target = pointerEvent.currentTarget as HTMLElement;
      target.setPointerCapture(pointerEvent.pointerId);
      onStartDrag({
        dayId: descriptor.id,
        eventId: baseEvent.id,
        mode,
        pointerId: pointerEvent.pointerId,
        pointerTarget: target,
        originY: pointerEvent.clientY,
        originalStart: baseEvent.start,
        originalEnd: baseEvent.end,
        pendingStart: baseEvent.start,
        pendingEnd: baseEvent.end,
        lastAppliedDelta: 0,
        minimumDurationMinutes: incrementMinutes,
        applyPreview: (start, end) => applyDraft(baseEvent.id, start, end),
        clearPreview: () => clearDraft(baseEvent.id),
        commit: (start, end) => {
          if (mode === 'move') {
            if (start !== baseEvent.start || end !== baseEvent.end) {
              onMove(baseEvent.id, start, end);
            }
          } else if (end !== baseEvent.end) {
            onResize(baseEvent.id, end);
          }
        },
      });
    },
    [applyDraft, clearDraft, descriptor.id, incrementMinutes, onMove, onResize, onStartDrag],
  );

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={`Itinerary for ${descriptor.day.date}`}
      className="relative border-r border-border/50 bg-surface-1"
      onKeyDown={handleDayKeyDown}
    >
      <div className="sticky top-0 z-10 border-b border-border/60 bg-surface-1/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-3">
              {DATE_FORMAT.format(new Date(descriptor.day.date))}
            </p>
            <h3 className="text-lg font-semibold text-text">{descriptor.day.headline ?? 'Untitled day'}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onAddItem(descriptor.id, 'block')}>
              Block
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAddItem(descriptor.id, 'travel')}>
              Travel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAddItem(descriptor.id, 'idea')}>
              Activity from list
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAddItem(descriptor.id, 'activity')}>
              New activity
            </Button>
          </div>
        </div>
        {descriptor.day.notes && <p className="mt-3 text-sm text-text-3">{descriptor.day.notes}</p>}
      </div>
      <div style={{ height: timelineHeight }} className="relative overflow-hidden">
        {hours.map((hour) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-b border-border/15"
            style={{
              top: (hour - visibleHours.start) * 60 * pixelsPerMinute,
              height: 60 * pixelsPerMinute,
            }}
          />
        ))}
        {effectiveEvents.map((event) => {
          const original = originalMap.get(event.id) ?? event;
          const Icon = getEventIcon(event);
          const offsetMinutes = minutesFromVisibleStart(event.start, visibleHours.start);
          const durationMinutes = Math.max(diffMinutes(event.start, event.end), incrementMinutes);
          const rawTop = offsetMinutes * pixelsPerMinute;
          const rawHeight = Math.max(durationMinutes * pixelsPerMinute, MIN_SLOT_HEIGHT * 1.5);
          const rawBottom = rawTop + rawHeight;
          const visibleTop = 0;
          const visibleBottom = timelineHeight;
          const intersects = rawBottom > visibleTop && rawTop < visibleBottom;
          const isClippedTop = rawTop < visibleTop;
          const isClippedBottom = rawBottom > visibleBottom;
          const isClipped = isClippedTop || isClippedBottom;
          let displayTop = intersects
            ? clamp(rawTop, visibleTop, visibleBottom)
            : rawTop >= visibleBottom
              ? visibleBottom - MIN_SLOT_HEIGHT * 1.25
              : visibleTop;
          const displayBottom = intersects
            ? clamp(rawBottom, visibleTop, visibleBottom)
            : rawTop >= visibleBottom
              ? visibleBottom
              : visibleTop + MIN_SLOT_HEIGHT * 1.25;
          const displayHeight = Math.max(displayBottom - displayTop, MIN_SLOT_HEIGHT * 1.25);
          if (displayTop + displayHeight > visibleBottom) {
            displayTop = visibleBottom - displayHeight;
          }
          const descriptionId = `planner-event-${event.id}`;
          const clipNoteId = `planner-event-${event.id}-clip`;
          return (
            <article
              key={event.id}
              tabIndex={0}
              aria-describedby={`${descriptionId}${isClipped ? ` ${clipNoteId}` : ''}`}
              className={`group absolute left-4 right-4 cursor-grab rounded-xl border border-border bg-surface-2/95 p-4 shadow-lg transition-all ${FOCUS_RING_CLASS}`}
              style={{ top: displayTop, height: displayHeight }}
              onClick={() => onEdit(original)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown') {
                  keyboardEvent.preventDefault();
                  const direction = keyboardEvent.key === 'ArrowUp' ? -1 : 1;
                  const delta = direction * KEYBOARD_NUDGE_MULTIPLIER * incrementMinutes;
                  const nextStart = snapToIncrement(addMinutes(original.start, delta));
                  const nextEnd = snapToIncrement(addMinutes(original.end, delta));
                  onMove(original.id, nextStart, nextEnd);
                }
                if (keyboardEvent.key === 'Enter') {
                  keyboardEvent.preventDefault();
                  onEdit(original);
                }
              }}
              onPointerDown={(pointerEvent) => {
                if ((pointerEvent.target as HTMLElement).dataset.handle) return;
                startDrag(original, pointerEvent, 'move');
              }}
            >
              <p id={descriptionId} className="sr-only">
                {new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to{' '}
                {new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
              {isClipped && (
                <span id={clipNoteId} className="sr-only">
                  Timeline entry clipped to visible hours.
                </span>
              )}
              {isClipped && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-3 top-3 hidden items-center gap-1 rounded-full bg-warning/20 px-2 py-1 text-xs font-medium text-warning group-hover:flex"
                >
                  <span>{CLIPPED_BADGE_LABEL}</span>
                </span>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-text-3">
                  <GripVertical size={16} />
                  <span>
                    {new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} –{' '}
                    {new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <button
                  type="button"
                  data-handle="resize"
                  aria-label="Resize item"
                  className="cursor-ns-resize rounded-md bg-surface-3/80 p-1 text-text-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  onPointerDown={(pointerEvent) => startDrag(original, pointerEvent, 'resize-end')}
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
                  {/* Only travel events have confirmation codes */}
                  {event.type === 'travel' && event.confirmationCode && (
                    <p className="text-xs font-medium text-text-3">
                      Confirmation: {event.confirmationCode}
                    </p>
                  )}
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
            <Button size="sm" variant="ghost" onClick={() => onAddItem(descriptor.id, 'block')}>
              Block
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAddItem(descriptor.id, 'travel')}>
              Travel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAddItem(descriptor.id, 'idea')}>
              From ideas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAddItem(descriptor.id, 'activity')}>
              Activity
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});
