import { describe, expect, it } from 'vitest';
import { pickItemByRarity, pickRarity, RARE_PUSH_WEIGHTS } from '../lib/roller';
import type { DateNightPoolItem, DateNightSettings } from '../lib/types';
import { createSeededRng } from './helpers';

/* ------------------------------------------------------------ */
/* CONFIGURATION: fixture settings                               */
/* ------------------------------------------------------------ */
const SETTINGS: DateNightSettings = {
  rarityWeights: { common: 60, uncommon: 25, rare: 12, veryRare: 3 },
  stackingDefault: { '1': 1 },
  stackingHigher: { '1': 1 },
  decayRatePerWeek: 0.1,
  decayCap: 4,
};

const items: DateNightPoolItem[] = [
  { id: 'a', kind: 'date', name: 'Common', rarity: 'common', frequency: 'anytime', baseWeight: 1, decayEnabled: true, timesPicked: 0, timesVetoed: 0, timesAccepted: 0 },
  { id: 'b', kind: 'date', name: 'Rare', rarity: 'rare', frequency: 'anytime', baseWeight: 1, decayEnabled: true, timesPicked: 0, timesVetoed: 0, timesAccepted: 0 },
];

describe('roller', () => {
  it('rerolls rarity when chosen tier is empty', () => {
    const rng = createSeededRng(5);
    const result = pickItemByRarity(items, 'veryRare', SETTINGS, { rng });
    expect(result).not.toBeNull();
    expect(result?.rarity).not.toBe('veryRare');
  });

  it('push-rare changes rarity weight table', () => {
    expect(RARE_PUSH_WEIGHTS.veryRare).toBeGreaterThan(SETTINGS.rarityWeights.veryRare);
    const rng = createSeededRng(1);
    const tier = pickRarity(SETTINGS, { pushRare: true }, rng);
    expect(['common', 'uncommon', 'rare', 'veryRare']).toContain(tier);
  });

  it('override frequency includes cooldowned items', () => {
    const cooldowned = [{ ...items[0], id: 'c', frequency: 'annual' as const, lastAcceptedAt: new Date().toISOString() }];
    const picked = pickItemByRarity(cooldowned, 'common', SETTINGS, { overrideFrequency: true, rng: createSeededRng(7) });
    expect(picked?.id).toBe('c');
  });
});
