/* ------------------------------------------------------------ */
/* CONFIGURATION: scheduling defaults for idea placement logic  */
/* ------------------------------------------------------------ */

export interface IdeaSchedulingInput {
  dayDate: string;
  visibleStartHour: number;
  visibleEndHour: number;
  incrementMinutes: number;
  durationMinutes: number;
  existingEvents: Array<{ start: string; end: string }>;
}

export interface IdeaSchedulingResult {
  start: Date;
  end: Date;
}

const MINUTES_IN_MS = 60000;

const toDaytime = (dayDate: string, hour: number, minute: number) =>
  new Date(`${dayDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);

const clampToIncrement = (value: Date, incrementMinutes: number, roundUp = false) => {
  const result = new Date(value.getTime());
  const minutes = result.getMinutes();
  const remainder = minutes % incrementMinutes;
  if (remainder === 0) {
    result.setSeconds(0, 0);
    return result;
  }
  const adjustment = roundUp ? incrementMinutes - remainder : -remainder;
  result.setMinutes(minutes + adjustment, 0, 0);
  return result;
};

/**
 * Computes the best-effort start/end timestamps for scheduling an idea on a given day.
 *
 * The algorithm preserves the existing gap-first behaviour for partially booked days while
 * ensuring fully booked days push new ideas to the end of the last block rather than
 * overlapping or shifting earlier events.
 */
export const computeIdeaSlot = ({
  dayDate,
  visibleStartHour,
  visibleEndHour,
  incrementMinutes,
  durationMinutes,
  existingEvents,
}: IdeaSchedulingInput): IdeaSchedulingResult => {
  const limit = toDaytime(dayDate, visibleEndHour, 0);
  let cursor = clampToIncrement(toDaytime(dayDate, visibleStartHour, 0), incrementMinutes);
  const sortedEvents = [...existingEvents]
    .map((event) => ({
      start: new Date(event.start),
      end: new Date(event.end),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let latestExistingEndSnapped = cursor;

  for (const existing of sortedEvents) {
    const existingStart = existing.start;
    const existingEnd = existing.end;

    if (existingEnd.getTime() > latestExistingEndSnapped.getTime()) {
      latestExistingEndSnapped = clampToIncrement(existingEnd, incrementMinutes, true);
    }

    if (existingEnd <= cursor) {
      continue;
    }

    if (existingStart > cursor) {
      const gapMinutes = (existingStart.getTime() - cursor.getTime()) / MINUTES_IN_MS;
      if (gapMinutes >= durationMinutes) {
        break;
      }
    }

    cursor = clampToIncrement(existingEnd, incrementMinutes, true);
    if (cursor >= limit) {
      break;
    }
  }

  let startDate = cursor;
  let endDate = new Date(startDate.getTime() + durationMinutes * MINUTES_IN_MS);

  if (cursor >= limit && sortedEvents.length > 0) {
    startDate = latestExistingEndSnapped;
    endDate = new Date(startDate.getTime() + durationMinutes * MINUTES_IN_MS);
  } else if (endDate > limit) {
    endDate = clampToIncrement(limit, incrementMinutes, false);
    startDate = new Date(endDate.getTime() - durationMinutes * MINUTES_IN_MS);
    const visibleStart = toDaytime(dayDate, visibleStartHour, 0);
    if (startDate < visibleStart) {
      startDate = clampToIncrement(visibleStart, incrementMinutes);
      endDate = new Date(startDate.getTime() + durationMinutes * MINUTES_IN_MS);
    }
  }

  return { start: startDate, end: endDate };
};

