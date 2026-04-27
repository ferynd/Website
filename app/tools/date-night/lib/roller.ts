/* ------------------------------------------------------------ */
/* CONFIGURATION: rarity/item weighted draw logic                */
/* ------------------------------------------------------------ */

import { effectiveWeight } from './decay';
import type { DateNightPoolItem, DateNightRarity, DateNightSettings } from './types';

export const RARITIES: DateNightRarity[] = ['common', 'uncommon', 'rare', 'veryRare'];

export const RARE_PUSH_WEIGHTS: Record<DateNightRarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 30,
  veryRare: 50,
};

export const pickWeighted = <T>(
  entries: Array<{ value: T; weight: number }>,
  rng: () => number = Math.random,
): T | null => {
  const active = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  const total = active.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let threshold = rng() * total;
  for (const entry of active) {
    threshold -= entry.weight;
    if (threshold <= 0) return entry.value;
  }
  return active[active.length - 1]?.value ?? null;
};

export const pickRarity = (
  settings: DateNightSettings,
  options?: { pushRare?: boolean; includeOnly?: DateNightRarity[] },
  rng: () => number = Math.random,
): DateNightRarity => {
  const weightMap = options?.pushRare ? RARE_PUSH_WEIGHTS : settings.rarityWeights;
  const tiers = options?.includeOnly?.length ? options.includeOnly : RARITIES;
  return (
    pickWeighted(
      tiers.map((tier) => ({ value: tier, weight: weightMap[tier] ?? 0 })),
      rng,
    ) ?? 'common'
  );
};

export const pickItemByRarity = (
  items: DateNightPoolItem[],
  rarity: DateNightRarity,
  settings: DateNightSettings,
  options?: {
    overrideFrequency?: boolean;
    excludeIds?: Set<string>;
    pushRare?: boolean;
    rng?: () => number;
  },
): DateNightPoolItem | null => {
  const rng = options?.rng ?? Math.random;
  const filtered = items.filter((item) => !(options?.excludeIds?.has(item.id)));
  if (!filtered.length) return null;

  const eligibleByTier: Record<DateNightRarity, DateNightPoolItem[]> = {
    common: [], uncommon: [], rare: [], veryRare: [],
  };

  for (const item of filtered) {
    const weight = effectiveWeight(item, settings, { overrideFrequency: options?.overrideFrequency });
    if (weight > 0) {
      eligibleByTier[item.rarity].push(item);
    }
  }

  const tiersWithItems = RARITIES.filter((tier) => eligibleByTier[tier].length > 0);
  if (!tiersWithItems.length) return null;

  const resolvedRarity = eligibleByTier[rarity].length
    ? rarity
    : pickRarity(settings, { includeOnly: tiersWithItems, pushRare: options?.pushRare }, rng);

  const candidates = eligibleByTier[resolvedRarity];
  return pickWeighted(
    candidates.map((item) => ({
      value: item,
      weight: effectiveWeight(item, settings, { overrideFrequency: options?.overrideFrequency }),
    })),
    rng,
  );
};
