import { describe, expect, it } from 'vitest';
import { isSeasonCheckEligible, recordedSeasonCount, evaluateSeasonResult } from '../lib/seasonCheck';
import type { Show } from '../types';
import { Timestamp } from 'firebase/firestore';

function ts(): Timestamp {
  return { seconds: 0, nanoseconds: 0, toDate: () => new Date(0) } as unknown as Timestamp;
}

function makeShow(patch: Partial<Show> = {}): Show {
  return {
    id: 'show1',
    listId: 'list1',
    title: 'Test Show',
    type: 'tv',
    status: 'completed',
    currentSeason: null,
    currentEpisode: null,
    totalSeasons: null,
    service: null,
    watchers: [],
    description: '',
    notes: '',
    memberNotes: {},
    vibeTags: [],
    brainPower: null,
    ratings: {},
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'u1',
    lastEditedBy: 'u1',
    ...patch,
  };
}

describe('isSeasonCheckEligible', () => {
  it('is eligible for completed tv shows', () => {
    expect(isSeasonCheckEligible(makeShow({ status: 'completed', type: 'tv' }))).toBe(true);
  });

  it('is eligible for on_hold cartoons', () => {
    expect(isSeasonCheckEligible(makeShow({ status: 'on_hold', type: 'cartoon' }))).toBe(true);
  });

  it('is not eligible for watching/planned/dropped shows', () => {
    expect(isSeasonCheckEligible(makeShow({ status: 'watching' }))).toBe(false);
    expect(isSeasonCheckEligible(makeShow({ status: 'planned' }))).toBe(false);
    expect(isSeasonCheckEligible(makeShow({ status: 'dropped' }))).toBe(false);
  });

  it('is not eligible for anime — no reliable season-count source', () => {
    expect(isSeasonCheckEligible(makeShow({ status: 'completed', type: 'anime' }))).toBe(false);
  });

  it('is not eligible for movies — no seasons', () => {
    expect(isSeasonCheckEligible(makeShow({ status: 'completed', type: 'movie' }))).toBe(false);
    expect(isSeasonCheckEligible(makeShow({ status: 'completed', type: 'animated_movie' }))).toBe(false);
  });
});

describe('recordedSeasonCount', () => {
  it('prefers totalSeasons over currentSeason', () => {
    expect(recordedSeasonCount(makeShow({ totalSeasons: 3, currentSeason: 1 }))).toBe(3);
  });

  it('falls back to currentSeason when totalSeasons is unset', () => {
    expect(recordedSeasonCount(makeShow({ totalSeasons: null, currentSeason: 2 }))).toBe(2);
  });

  it('is null when neither is set', () => {
    expect(recordedSeasonCount(makeShow({ totalSeasons: null, currentSeason: null }))).toBeNull();
  });
});

describe('evaluateSeasonResult', () => {
  it('flags a new season when latest exceeds recorded', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: 2, latestSeasons: 3,
      tmdbStatus: 'Ended', nextAirDate: null, lastAirDate: '2024-01-01',
    });
    expect(result.hasNewSeason).toBe(true);
  });

  it('does not flag when latest equals recorded', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: 3, latestSeasons: 3,
      tmdbStatus: 'Ended', nextAirDate: null, lastAirDate: '2024-01-01',
    });
    expect(result.hasNewSeason).toBe(false);
  });

  it('does not flag when recordedSeasons is unknown', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: null, latestSeasons: 3,
      tmdbStatus: 'Ended', nextAirDate: null, lastAirDate: '2024-01-01',
    });
    expect(result.hasNewSeason).toBe(false);
  });

  it('marks airing when status is Returning Series with a next air date', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: 1, latestSeasons: 2,
      tmdbStatus: 'Returning Series', nextAirDate: '2026-08-01', lastAirDate: '2026-07-01',
    });
    expect(result.airingStatus).toBe('airing');
  });

  it('marks fully_released when there is a last air date but no upcoming episode', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: 1, latestSeasons: 2,
      tmdbStatus: 'Ended', nextAirDate: null, lastAirDate: '2024-01-01',
    });
    expect(result.airingStatus).toBe('fully_released');
  });

  it('marks unknown when there is no air date info at all', () => {
    const result = evaluateSeasonResult({
      showId: 's1', recordedSeasons: 1, latestSeasons: 2,
      tmdbStatus: null, nextAirDate: null, lastAirDate: null,
    });
    expect(result.airingStatus).toBe('unknown');
  });
});
