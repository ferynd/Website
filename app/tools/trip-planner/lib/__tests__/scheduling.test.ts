/* ------------------------------------------------------------ */
/* CONFIGURATION: baseline scheduling inputs for test scenarios */
/* ------------------------------------------------------------ */

import { describe, expect, it } from 'vitest';
import { computeIdeaSlot } from '../scheduling';

const BASE_INPUT = {
  dayDate: '2024-05-20',
  visibleStartHour: 8,
  visibleEndHour: 20,
  incrementMinutes: 30,
};

const durationMinutes = 120;

const toISO = (time: string) => new Date(time).toISOString();

describe('computeIdeaSlot', () => {
  it('places a new idea after the final block when the day is full', () => {
    const result = computeIdeaSlot({
      ...BASE_INPUT,
      durationMinutes,
      existingEvents: [
        { start: '2024-05-20T08:00:00', end: '2024-05-20T10:00:00' },
        { start: '2024-05-20T10:00:00', end: '2024-05-20T12:00:00' },
        { start: '2024-05-20T12:00:00', end: '2024-05-20T20:00:00' },
      ],
    });

    expect(result.start.getTime()).toBe(new Date('2024-05-20T20:00:00').getTime());
    expect(result.end.getTime() - result.start.getTime()).toBe(durationMinutes * 60000);
  });

  it('rounds up to the next increment when the last event spills past the visible window', () => {
    const result = computeIdeaSlot({
      ...BASE_INPUT,
      durationMinutes,
      existingEvents: [
        { start: '2024-05-20T08:00:00', end: '2024-05-20T19:00:00' },
        { start: '2024-05-20T19:00:00', end: '2024-05-20T21:10:00' },
      ],
    });

    const lastEventEndRounded = toISO('2024-05-20T21:30:00');

    expect(result.start.toISOString()).toBe(lastEventEndRounded);
    expect(result.end.getTime() - result.start.getTime()).toBe(durationMinutes * 60000);
  });

  it('keeps existing gap placement when room is available earlier in the day', () => {
    const result = computeIdeaSlot({
      ...BASE_INPUT,
      durationMinutes,
      existingEvents: [
        { start: '2024-05-20T08:00:00', end: '2024-05-20T09:00:00' },
        { start: '2024-05-20T11:00:00', end: '2024-05-20T12:00:00' },
      ],
    });

    expect(result.start.getTime()).toBe(new Date('2024-05-20T09:00:00').getTime());
  });
});

