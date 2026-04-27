import { describe, expect, it } from 'vitest';
import { pickModifierCount, pickDistinctModifiers } from '../lib/stacking';
import type { DateNightPoolItem, DateNightSettings } from '../lib/types';
import { createSeededRng } from './helpers';

/* ------------------------------------------------------------ */
/* CONFIGURATION: test pool and settings                        */
/* ------------------------------------------------------------ */
const SETTINGS: DateNightSettings = {
  rarityWeights: { common: 60, uncommon: 25, rare: 12, veryRare: 3 },
  stackingDefault: { '0': 8, '1': 52, '2': 25, '3': 10, '4': 4, '5': 1 },
  stackingHigher: { '0': 0, '1': 30, '2': 35, '3': 20, '4': 10, '5': 5 },
  decayRatePerWeek: 0.1,
  decayCap: 4,
};

const modifiers: DateNightPoolItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `m${index}`,
  kind: 'modifier',
  name: `Mod ${index}`,
  rarity: (['common', 'uncommon', 'rare', 'veryRare'][index % 4] as DateNightPoolItem['rarity']),
  frequency: 'anytime',
  baseWeight: 1,
  decayEnabled: true,
  timesPicked: 0,
  timesVetoed: 0,
  timesAccepted: 0,
}));

describe('stacking', () => {
  it('distribution is roughly aligned over 10k samples', () => {
    const rng = createSeededRng(1234);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10000; i += 1) {
      const picked = pickModifierCount(SETTINGS, false, rng);
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    expect((counts.get(1) ?? 0) / 10000).toBeGreaterThan(0.45);
    expect((counts.get(2) ?? 0) / 10000).toBeGreaterThan(0.2);
  });

  it('never duplicates modifiers within a roll', () => {
    const rng = createSeededRng(99);
    const picked = pickDistinctModifiers(modifiers, SETTINGS, 8, { rng, overrideFrequency: true, pushRare: true });
    expect(new Set(picked.map((item) => item.id)).size).toBe(picked.length);
  });
});
