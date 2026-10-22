import { describe, expect, it } from 'vitest';
import { buildLedger } from '../ledger';
import {
  capProgress,
  enteredPercentTotal,
  formatNormalizedShare,
  newTravelerNotice,
  newTravelerOverageCents,
  overagePreview,
  parseSettingsDraft,
  previewSettings,
  savedSettingsMatch,
  settingsAreStale,
  settingsDraft,
  settingsWriteError,
  STALE_SETTINGS_MESSAGE,
  tripRevision,
  validateTripSettings,
  type TripSettingsFields,
} from '../tripSettings';
import type { Expense, Trip, TripParticipant } from '../../pageTypes';
import type { BudgetCapResult } from '../ledger';

const person = (id: string, name = id): TripParticipant => ({
  id,
  name,
  isRegistered: false,
  addedBy: 'admin',
});

const expense = (
  fields: Partial<Expense> & Pick<Expense, 'totalAmount' | 'paidBy' | 'splitParticipants'>,
): Expense => ({
  id: 'expense',
  category: 'Food',
  description: 'Dinner',
  splitType: 'even',
  manualSplit: {},
  createdBy: 'admin',
  ...fields,
});

const baseTrip = (extra: Partial<Trip> = {}): Trip => ({
  id: 'trip',
  name: 'Weekend',
  createdBy: 'admin',
  participants: [person('a', 'Ada'), person('b', 'Bea')],
  participantIds: ['a', 'b'],
  expenses: [expense({ totalAmount: 100, paidBy: { a: 100 }, splitParticipants: ['a', 'b'] })],
  payments: [],
  spendCaps: [{ participantId: 'a', maxAmount: 40 }],
  overageSplit: { type: 'even' },
  defaultSplit: {},
  ...extra,
});

const evenSettings = (caps: TripSettingsFields['spendCaps'] = []): TripSettingsFields => ({
  spendCaps: caps,
  overageSplit: { type: 'even' },
  defaultSplit: {},
});

describe('trip settings validation', () => {
  const ids = ['a', 'b'];

  it('accepts blank defaults, a zero cap, and infeasible caps', () => {
    expect(validateTripSettings(evenSettings([{ participantId: 'a', maxAmount: 0 }]), ids)).toEqual([]);
    const infeasible = evenSettings([
      { participantId: 'a', maxAmount: 1 },
      { participantId: 'b', maxAmount: 1 },
    ]);
    expect(validateTripSettings(infeasible, ids)).toEqual([]);
    const ledger = buildLedger(baseTrip({ spendCaps: [] }));
    expect(previewSettings(ledger, infeasible).unallocatedCents).toBeGreaterThan(0);
  });

  it('rejects fractional cents, bad shares, and a default that is not 100%', () => {
    expect(validateTripSettings(evenSettings([{ participantId: 'a', maxAmount: 10.005 }]), ids)[0])
      .toMatch(/whole cents/);
    expect(validateTripSettings(evenSettings([{ participantId: 'ghost', maxAmount: 1 }]), ids)[0])
      .toMatch(/distinct travelers/);
    expect(validateTripSettings({
      ...evenSettings(),
      overageSplit: { type: 'manual', shares: {} },
    }, ids)).toContain('Custom overage needs at least one positive share.');
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: { a: 40, b: 40 },
    }, ids)[0]).toMatch(/total 100%/);
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: { a: 50, b: 50 },
    }, ids)).toEqual([]);
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: { a: 33.33, b: 33.33, c: 33.34 },
    }, ['a', 'b', 'c'])).toEqual([]);
  });

  it('drops blank and unknown inputs, and keeps invalid text for validation', () => {
    const parsed = parseSettingsDraft({
      caps: { a: '10.50', b: '', ghost: '5' },
      overageType: 'even',
      overageShares: { a: '20' },
      defaultShares: { a: '', b: '100' },
    }, ids);
    expect(parsed.errors).toEqual([]);
    expect(parsed.settings).toEqual({
      spendCaps: [{ participantId: 'a', maxAmount: 10.5 }],
      overageSplit: { type: 'even' },
      defaultSplit: { b: 100 },
    });
    expect(parseSettingsDraft({
      caps: { a: '10.005' },
      overageType: 'manual',
      overageShares: { a: '' },
      defaultShares: {},
    }, ids).errors.join(' ')).toMatch(/whole cents/);
  });
});

describe('stale settings edits', () => {
  const trip = baseTrip();
  const revision = tripRevision(trip);
  const settings = evenSettings();

  it('ignores updatedAt and notices other document changes', () => {
    expect(settingsAreStale(revision, trip)).toBe(false);
    expect(settingsAreStale(revision, { ...trip, updatedAt: { seconds: 1, nanoseconds: 0 } as Trip['updatedAt'] })).toBe(false);
    expect(settingsAreStale(revision, { ...trip, name: 'Changed' })).toBe(true);
    expect(tripRevision({ ...trip, updatedAt: { seconds: 9, nanoseconds: 0 } as Trip['updatedAt'] })).toBe(revision);
  });

  it('blocks a write until overwrite names the current revision', () => {
    expect(settingsWriteError(settings, ['a', 'b'], revision, revision)).toBeNull();
    expect(settingsWriteError(settings, ['a', 'b'], 'old', revision)).toBe(STALE_SETTINGS_MESSAGE);
    expect(settingsWriteError(settings, ['a', 'b'], 'old', revision, 'other')).toBe(STALE_SETTINGS_MESSAGE);
    expect(settingsWriteError(settings, ['a', 'b'], 'old', revision, revision)).toBeNull();
    expect(settingsWriteError(evenSettings([{ participantId: 'a', maxAmount: -1 }]), ['a', 'b'], 'old', revision, revision))
      .toMatch(/whole cents/);
  });

  it('matches a saved snapshot without caring about cap order or updatedAt', () => {
    const saved = evenSettings([{ participantId: 'b', maxAmount: 2 }, { participantId: 'a', maxAmount: 1 }]);
    const stored = baseTrip({
      spendCaps: [{ participantId: 'a', maxAmount: 1 }, { participantId: 'b', maxAmount: 2 }],
      name: 'Weekend',
    });
    expect(savedSettingsMatch(stored, saved)).toBe(true);
    expect(savedSettingsMatch(stored, evenSettings([{ participantId: 'a', maxAmount: 1 }]))).toBe(false);
    expect(settingsDraft(stored).caps).toEqual({ a: '1', b: '2' });
  });
});

describe('overage eligibility and new-traveler notice', () => {
  it('follows capped travelers from the ledger and normalizes shares', () => {
    const trip = baseTrip({
      participants: [person('a', 'Ada'), person('b', 'Bea'), person('c', 'Cam')],
      participantIds: ['a', 'b', 'c'],
      expenses: [expense({
        totalAmount: 90,
        paidBy: { a: 90 },
        splitParticipants: ['a', 'b', 'c'],
      })],
      spendCaps: [{ participantId: 'a', maxAmount: 10 }],
      overageSplit: { type: 'manual', shares: { a: 100 } },
    });
    const ledger = buildLedger(trip);
    const preview = overagePreview(ledger.caps, trip.overageSplit!, ledger.travelerIds);
    expect(ledger.caps.fallbackUsed).toBe(true);
    expect(preview.fallback).toBe(true);
    expect(preview.absorbing).toEqual(['b', 'c']);
    expect(preview.eligible).toEqual(['b', 'c']);
    expect(preview.normalized).toEqual({ b: 5000, c: 5000 });
    expect(formatNormalizedShare(5000)).toBe('50.00%');
    expect(formatNormalizedShare(10000)).toBe('100.00%');
  });

  it('treats someone as eligible only when the ledger has not capped them', () => {
    const caps = {
      final: { a: 100, b: 100 },
      adjustments: { a: 0, b: 50 },
      transfers: [],
      uncovered: [],
      unallocatedCents: 0,
      fallbackUsed: false,
      capCents: { a: 100, b: 100 },
      cappedIds: ['a'],
    } as BudgetCapResult;
    const preview = overagePreview(caps, { type: 'even' }, ['a', 'b']);
    expect(preview.eligible).toEqual(['b']);
    expect(preview.absorbing).toEqual(['b']);
    expect(preview.normalized.b).toBe(10000);
  });

  it('reports the cents a new traveler would absorb without resplitting expenses', () => {
    const trip = baseTrip();
    const before = trip.participants.map((item) => item.id);
    expect(newTravelerOverageCents(trip)).toBe(500);
    expect(trip.participants.map((item) => item.id)).toEqual(before);
    expect(trip.expenses[0].splitParticipants).toEqual(['a', 'b']);
    expect(newTravelerNotice(trip, ' Casey ')).toEqual({
      resplit: 'Existing expenses are not resplit. Add Casey to earlier expenses by editing them.',
      overage: 'Casey will start absorbing over-cap costs: currently +$5.00.',
    });
    expect(newTravelerOverageCents({
      ...trip,
      overageSplit: { type: 'manual', shares: { b: 100 } },
    })).toBe(0);
    expect(newTravelerNotice({ ...trip, spendCaps: [] }, 'Casey').overage).toBeNull();
  });
});

describe('near-cap marker', () => {
  it('marks strictly under 5% remaining, including zero left, and not an exact 5%', () => {
    expect(capProgress(9500, 10000)).toMatchObject({ nearCap: false, overCap: false });
    expect(capProgress(9501, 10000)).toMatchObject({ nearCap: true, overCap: false });
    expect(capProgress(10000, 10000)).toMatchObject({ nearCap: true, atCap: true, overCap: false, percent: 100 });
    expect(capProgress(9999, 10000).atCap).toBe(false);
    expect(capProgress(10001, 10000)).toMatchObject({ nearCap: false, overCap: true, percent: 100 });
    expect(capProgress(0, 10000).nearCap).toBe(false);
    expect(capProgress(0, 0)).toMatchObject({ nearCap: false, overCap: false });
  });
});

describe('entered percent total', () => {
  it('ignores blanks and rejects text that is not a number', () => {
    expect(enteredPercentTotal({ a: '', b: '  ' })).toBeNull();
    expect(enteredPercentTotal({ a: '50', b: '50' })).toBe(100);
    expect(enteredPercentTotal({ a: 'nope' })).toBeNull();
  });
});
