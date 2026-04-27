/* ------------------------------------------------------------ */
/* CONFIGURATION: modifier stack selection helpers               */
/* ------------------------------------------------------------ */

import { pickItemByRarity, pickRarity, pickWeighted } from './roller';
import type { DateNightPoolItem, DateNightSettings } from './types';

export const pickModifierCount = (
  settings: DateNightSettings,
  higherStacking: boolean,
  rng: () => number = Math.random,
): number => {
  const map = higherStacking ? settings.stackingHigher : settings.stackingDefault;
  return pickWeighted(Object.entries(map).map(([value, weight]) => ({ value: Number(value), weight })), rng) ?? 1;
};

export const pickDistinctModifiers = (
  modifiers: DateNightPoolItem[],
  settings: DateNightSettings,
  requestedCount: number,
  options?: { pushRare?: boolean; overrideFrequency?: boolean; rng?: () => number },
): DateNightPoolItem[] => {
  const rng = options?.rng ?? Math.random;
  const chosenIds = new Set<string>();
  const picks: DateNightPoolItem[] = [];

  for (let index = 0; index < requestedCount; index += 1) {
    const rarity = pickRarity(settings, { pushRare: options?.pushRare }, rng);
    const picked = pickItemByRarity(modifiers, rarity, settings, {
      overrideFrequency: options?.overrideFrequency,
      excludeIds: chosenIds,
      rng,
    });
    if (!picked) break;
    chosenIds.add(picked.id);
    picks.push(picked);
  }

  return picks;
};
