import type { FoodItemRef } from './types';

/* CONFIGURATION: Nutrition Tracker nutrient keys (mirror of
   public/tools/CalorieTracker/constants.js allNutrients — parity is tested) */
export const TRACKER_NUTRIENT_KEYS = [
  'calories', 'protein', 'carbs', 'fat',
  'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
  'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
  'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
] as const;

export type TrackerNutrientKey = (typeof TRACKER_NUTRIENT_KEYS)[number];

export interface TrackerFood extends FoodItemRef {
  quantity: number | null;
  nutrients: Record<TrackerNutrientKey, number | null>;
  lastUpdated: string | null;
}

export interface FoodsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: TrackerFood[];
  error: string;
}

const readFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

export const parseTrackerFood = (id: string, data: unknown): TrackerFood | null => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name.trim()) return null;
  const nutrients = Object.fromEntries(
    TRACKER_NUTRIENT_KEYS.map((key) => [key, readFiniteNumber(record[key])]),
  ) as Record<TrackerNutrientKey, number | null>;
  const updated = record.lastUpdated;
  let lastUpdated: string | null = typeof updated === 'string' ? updated : null;
  if (typeof updated === 'object' && updated !== null && 'toMillis' in updated && typeof updated.toMillis === 'function') {
    try {
      lastUpdated = new Date(updated.toMillis()).toISOString();
    } catch {
      lastUpdated = null;
    }
  }
  return {
    id,
    name: record.name.trim(),
    quantity: readFiniteNumber(record.quantity),
    nutrients,
    lastUpdated,
  };
};

export const fingerprintTrackerFood = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients'>,
): string => {
  const canonical = `q=${food.quantity ?? ''}${TRACKER_NUTRIENT_KEYS
    .map((key) => `;${key}=${food.nutrients[key] ?? ''}`)
    .join('')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};
