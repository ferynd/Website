import { describe, expect, it } from 'vitest';
import { effectiveWeight, isEligibleByFrequency, weeksSince } from '../lib/decay';
import type { DateNightPoolItem, DateNightSettings } from '../lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: shared fixtures                               */
/* ------------------------------------------------------------ */
const SETTINGS: DateNightSettings = {
  rarityWeights: { common: 60, uncommon: 25, rare: 12, veryRare: 3 },
  stackingDefault: { '1': 1 },
  stackingHigher: { '1': 1 },
  decayRatePerWeek: 0.1,
  decayCap: 4,
};

const baseItem = (patch: Partial<DateNightPoolItem> = {}): DateNightPoolItem => ({
  id: 'd1',
  kind: 'date',
  name: 'Test',
  rarity: 'common',
  frequency: 'monthly',
  baseWeight: 1,
  decayEnabled: true,
  timesPicked: 0,
  timesVetoed: 0,
  timesAccepted: 0,
  ...patch,
});

describe('decay', () => {
  it('enforces cooldown unless override is enabled', () => {
    const now = Date.now();
    const item = baseItem({ lastAcceptedAt: new Date(now - 5 * 86400000).toISOString() });
    expect(isEligibleByFrequency(item, { now })).toBe(false);
    expect(isEligibleByFrequency(item, { now, overrideFrequency: true })).toBe(true);
  });

  it('caps decay multiplier at decayCap', () => {
    const now = Date.now();
    const item = baseItem({ lastAcceptedAt: new Date(now - 3650 * 86400000).toISOString() });
    expect(effectiveWeight(item, SETTINGS, { now })).toBeCloseTo(4, 5);
  });

  it('does not apply decay multiplier when decay is disabled', () => {
    const now = Date.now();
    const item = baseItem({ decayEnabled: false, lastAcceptedAt: new Date(now - 3650 * 86400000).toISOString() });
    expect(effectiveWeight(item, SETTINGS, { now, overrideFrequency: true })).toBeCloseTo(1, 5);
  });

  it('computes weeks since for valid and missing dates', () => {
    const now = Date.now();
    expect(weeksSince(new Date(now - 14 * 86400000).toISOString(), now)).toBeCloseTo(2, 2);
    expect(weeksSince(undefined, now)).toBe(52);
  });
});
