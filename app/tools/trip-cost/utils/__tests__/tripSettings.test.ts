import { describe, expect, it } from 'vitest';
import { applyBudgetCaps, buildLedger } from '../ledger';
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

  it('rejects custom shares that disappear at allocator precision', () => {
    const parsed = parseSettingsDraft({
      caps: {},
      overageType: 'manual',
      overageShares: { a: '0.0000001' },
      defaultShares: {},
    }, ids);
    expect(parsed.errors).toContain('Custom overage needs at least one positive share.');
    expect(parsed.errors).toContain('Overage shares must use at most six decimal places.');
    expect(validateTripSettings({
      ...evenSettings(),
      overageSplit: { type: 'manual', shares: { a: 0.000001 } },
    }, ids)).toEqual([]);
  });

  it('rejects excess precision even alongside positive overage or default shares', () => {
    const errors = validateTripSettings({
      ...evenSettings(),
      overageSplit: { type: 'manual', shares: { a: 100, b: 0.0000001 } },
      defaultSplit: { a: 100, b: 0.0000001 },
    }, ids);
    expect(errors).toContain('Overage shares must use at most six decimal places.');
    expect(errors).toContain('Default split must use at most six decimal places.');
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

  it('accepts legacy rounded defaults within 0.1% and reports the total outside it', () => {
    const legacyDefaults: TripSettingsFields['defaultSplit'][] = [
      { a: 33.3, b: 33.3, c: 33.3 },
      { a: 50, b: 50.1 },
    ];
    for (const defaultSplit of legacyDefaults) {
      expect(validateTripSettings({ ...evenSettings(), defaultSplit }, ['a', 'b', 'c'])).toEqual([]);
    }
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: { a: 49.9, b: 49.9 },
    }, ids)).toEqual([
      'Default split percentages must total 100% (currently 99.80%), or leave every field blank for equal splitting.',
    ]);
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: { a: 50, b: 50.11 },
    }, ids)[0]).toContain('currently 100.11%');
  });

  it('omits orphan defaults and overage shares when parsing a stored draft', () => {
    const stored = baseTrip({
      defaultSplit: { a: 40, b: 30, gone: 30 },
      overageSplit: { type: 'manual', shares: { a: 0, b: 0, gone: 100 } },
    });
    const parsed = parseSettingsDraft(settingsDraft(stored), ids);
    expect(parsed.settings.defaultSplit).toEqual({ a: 40, b: 30 });
    expect(parsed.settings.overageSplit.shares).toEqual({ a: 0, b: 0 });
    expect(parsed.errors).toContain('Custom overage needs at least one positive share.');
    expect(parsed.errors.join(' ')).toContain('currently 70.00%');
    expect(validateTripSettings({
      ...evenSettings(),
      defaultSplit: stored.defaultSplit!,
    }, ids).join(' ')).toContain('currently 70.00%');
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
    const reordered = Object.fromEntries(Object.entries(trip).reverse()) as unknown as Trip;
    expect(tripRevision(reordered)).toBe(revision);
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

  it('excludes travelers whose final responsibility has reached their cap', () => {
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
    expect(preview.eligible).toEqual([]);
    expect(preview.absorbing).toEqual(['b']);
    expect(preview.normalized).toEqual({});
  });

  it('excludes a traveler exactly at cap even before the ledger locks them', () => {
    const caps = applyBudgetCaps(
      { a: 29, b: 28, c: 0 },
      [{ participantId: 'a', maxAmount: 0.29 }, { participantId: 'b', maxAmount: 0.29 }],
      { type: 'even' },
      ['a', 'b', 'c'],
    );
    expect(caps.cappedIds).toEqual([]);
    expect(caps.capCents.a).toBe(29);
    const preview = overagePreview(caps, { type: 'even' }, ['a', 'b', 'c']);
    expect(preview.eligible).toEqual(['b', 'c']);
    expect(preview.normalized).toEqual({ b: 5000, c: 5000 });
  });

  it('falls back to even when only travelers at their caps have manual shares', () => {
    const split = { type: 'manual' as const, shares: { a: 100 } };
    const caps = applyBudgetCaps(
      { a: 100, b: 0, c: 0 },
      [{ participantId: 'a', maxAmount: 1 }],
      split,
      ['a', 'b', 'c'],
    );
    const preview = overagePreview(caps, split, ['a', 'b', 'c']);
    expect(preview.fallback).toBe(true);
    expect(preview.eligible).toEqual(['b', 'c']);
    expect(preview.normalized).toEqual({ b: 5000, c: 5000 });

    const furtherOverage = applyBudgetCaps(
      { a: 102, b: 0, c: 0 },
      [{ participantId: 'a', maxAmount: 1 }],
      split,
      ['a', 'b', 'c'],
    );
    expect(furtherOverage.fallbackUsed).toBe(true);
    expect(furtherOverage.adjustments).toEqual({ a: -2, b: 1, c: 1 });
  });

  it('keeps uncapped zero-share travelers eligible and ignores invalid manual weights', () => {
    const ids = ['a', 'b', 'c'];
    const caps = applyBudgetCaps({ a: 0, b: 0, c: 0 }, [{ participantId: 'a', maxAmount: 0 }], undefined, ids);
    const preview = overagePreview(caps, { type: 'manual', shares: { a: 100, b: Infinity, c: -1 } }, ids);
    expect(preview.eligible).toEqual(['b', 'c']);
    expect(preview.fallback).toBe(true);
    expect(preview.normalized).toEqual({ b: 5000, c: 5000 });
    expect(overagePreview(caps, { type: 'manual', shares: { b: 25 } }, ids).normalized)
      .toEqual({ b: 10000, c: 0 });
  });

  it('falls back to even when eligible manual shares quantize to zero', () => {
    const ids = ['a', 'b'];
    const caps = applyBudgetCaps({ a: 0, b: 0 }, [], undefined, ids);
    const preview = overagePreview(caps, { type: 'manual', shares: { a: 0.0000001 } }, ids);
    expect(preview.fallback).toBe(true);
    expect(preview.normalized).toEqual({ a: 5000, b: 5000 });
    expect(overagePreview(caps, { type: 'manual', shares: { a: 0.0000001, b: 0.000001 } }, ids))
      .toMatchObject({ fallback: false, normalized: { a: 0, b: 10000 } });
  });

  it('does not claim an even fallback when nobody can absorb overage', () => {
    const caps = applyBudgetCaps({ a: 0 }, [{ participantId: 'a', maxAmount: 0 }], undefined, ['a']);
    expect(overagePreview(caps, { type: 'manual', shares: { a: 100 } }, ['a']))
      .toMatchObject({ eligible: [], normalized: {}, fallback: false });
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

  it('includes manual overage falling back to an even split in the add-traveler notice', () => {
    const trip = baseTrip({
      spendCaps: [
        { participantId: 'a', maxAmount: 100 },
        { participantId: 'b', maxAmount: 100 },
      ],
      expenses: [expense({ totalAmount: 300, paidBy: { a: 300 }, splitParticipants: ['a', 'b'] })],
      overageSplit: { type: 'manual', shares: { a: 50, b: 50 } },
    });
    expect(newTravelerOverageCents(trip)).toBe(10000);
    expect(newTravelerNotice(trip, 'Casey').overage)
      .toBe('Casey will start absorbing over-cap costs: currently +$100.00.');

    const withEligibleShare = { ...trip, spendCaps: [{ participantId: 'a', maxAmount: 100 }] };
    expect(newTravelerOverageCents(withEligibleShare)).toBe(0);
    expect(newTravelerNotice(withEligibleShare, 'Casey').overage).toBeNull();
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
