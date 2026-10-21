/* Nutrition Tracker food contracts, parsing, and identifiers. */

import { normalizeIngredientName } from './shoppingList';
import type { FoodItemRef } from './types';

/* --- CONFIGURATION: tracker export bounds and name suffixes --- */
/** Maximum values accepted by the Nutrition Tracker's food editor. */
export const TRACKER_NUTRIENT_MAX_BOUNDS: Record<TrackerNutrientKey, number> = {
  calories: 10000,
  protein: 1000,
  carbs: 1000,
  fat: 1000,
  fiber: 500,
  potassium: 50000,
  magnesium: 10000,
  sodium: 23000,
  calcium: 25000,
  choline: 35000,
  vitaminB12: 10000,
  folate: 10000,
  vitaminC: 20000,
  vitaminB6: 1000,
  vitaminA: 30000,
  vitaminD: 1000,
  vitaminE: 10000,
  vitaminK: 10000,
  selenium: 4000,
  iodine: 11000,
  phosphorus: 40000,
  iron: 450,
  zinc: 400,
  omega3: 100,
};

/** Suffixes ignored when checking whether an export name has a usable tracker id. */
export const TRACKER_NAME_BASIS_SUFFIXES = [' (per 100 g)', ' (per portion)', ' (per 100 g cooked)'] as const;

/* CONFIGURATION: Nutrition Tracker nutrient keys (mirror of
   public/tools/CalorieTracker/constants.js allNutrients — parity is tested) */
/** Nutrient fields stored in Nutrition Tracker food documents. */
export const TRACKER_NUTRIENT_KEYS = [
  'calories', 'protein', 'carbs', 'fat',
  'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
  'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
  'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
] as const;

/** One nutrient field supported by the tracker. */
export type TrackerNutrientKey = (typeof TRACKER_NUTRIENT_KEYS)[number];

/* CONFIGURATION: tracker food naming */
/** Maximum accepted display-name length for tracker foods. */
export const TRACKER_FOOD_NAME_MAX = 80;
/** Convert a tracker food name to its document ID. */
export const trackerFoodId = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
/** Return whether a string is a valid Firestore document ID for a food item. */
export const isValidFirestoreDocId = (id: string): boolean => (
  id.length > 0
  && !id.includes('/')
  && id !== '.'
  && id !== '..'
  && !/^__.*__$/.test(id)
  && new TextEncoder().encode(id).length <= 1500
);
/** Validate a display name against tracker naming and ID constraints. */
export const validateTrackerFoodName = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a food name.';
  if (trimmed.length > TRACKER_FOOD_NAME_MAX) return 'Food names are limited to 80 characters.';
  let meaningfulName = trimmed;
  for (const suffix of TRACKER_NAME_BASIS_SUFFIXES) {
    // Match with or without the leading space, as the original P2 regex did.
    const bareSuffix = suffix.trim();
    if (meaningfulName.toLowerCase().endsWith(bareSuffix)) {
      meaningfulName = meaningfulName.slice(0, -bareSuffix.length).trim();
      break;
    }
  }
  const id = trackerFoodId(meaningfulName);
  if (!/[a-z0-9]/.test(id)) return 'Add Latin letters or digits to the name (the Nutrition Tracker ID only keeps A–Z and 0–9).';
  if (/^__.*__$/.test(id)) return 'This name maps to a reserved Firestore ID — change the leading/trailing symbols.';
  return null;
};
/** Tracker document shape for a newly created food. */
export type TrackerFoodDoc = { name: string; quantity: 1; lastUpdated: string } & Record<TrackerNutrientKey, number>;
/** Build a validated tracker food document with quantity fixed at one. */
export const buildTrackerFoodDoc = (name: string, nutrients: Record<TrackerNutrientKey, number>, nowIso: string): TrackerFoodDoc => {
  const doc: Record<string, unknown> = { name: name.trim(), quantity: 1 };
  TRACKER_NUTRIENT_KEYS.forEach((key) => {
    const value = nutrients[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid nutrient value for ${key}.`);
    doc[key] = value;
  });
  doc.lastUpdated = nowIso;
  return doc as TrackerFoodDoc;
};
/** Error raised when one or more requested tracker food IDs already exist. */
export class FoodIdCollisionError extends Error {
  constructor(readonly foodIds: string[]) { super(`Nutrition Tracker food ID(s) already exist: ${foodIds.join(', ')}`); this.name = 'FoodIdCollisionError'; }
}

/** Error raised when a tracker food being replaced by intake reappears before commit. */
export class FoodTargetReappearedError extends Error {
  constructor(readonly foodIds: string[]) { super(`Nutrition Tracker replacement target(s) reappeared: ${foodIds.join(', ')}`); this.name = 'FoodTargetReappearedError'; }
}

/** Error raised when a linked tracker food changed or disappeared before commit. */
export class FoodLinkTargetChangedError extends Error {
  constructor(readonly foodIds: string[]) { super(`Nutrition Tracker link target(s) changed or were deleted: ${foodIds.join(', ')}`); this.name = 'FoodLinkTargetChangedError'; }
}

/** Parsed tracker food with nullable values for incomplete source data. */
export interface TrackerFood extends FoodItemRef {
  quantity: number | null;
  nutrients: Record<TrackerNutrientKey, number | null>;
  lastUpdated: string | null;
}

/** Current status and contents of a Nutrition Tracker food load. */
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

/** Parse an untrusted tracker document, returning null when its name is invalid. */
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

/** Create a stable fingerprint for the tracker quantity and nutrient values. */
export const fingerprintTrackerFood = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients'>,
): string => {
  const canonical = `q=${food.quantity ?? ''}${TRACKER_NUTRIENT_KEYS
    .map((key) => `;${key}=${food.nutrients[key] ?? ''}`)
    .join('')}`;
  return fnv1aHex(canonical);
};

/** Return the stable FNV-1a 32-bit hash used by tracker food fingerprints. */
export const fnv1aHex = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/** Identity of a tracker food that a planned link must still match at commit. */
export interface LinkTarget {
  id: string;
  fingerprint: string;
  normalizedName: string;
  lastUpdated: string | null;
}

/**
 * A document read in the commit transaction no longer matches the captured link.
 * Missing documents are handled by the caller; null means the snapshot did not parse.
 */
export const linkTargetChanged = (
  parsed: TrackerFood | null,
  expected: Pick<LinkTarget, 'fingerprint' | 'normalizedName' | 'lastUpdated'>,
): boolean => (
  parsed === null
  || fingerprintTrackerFood(parsed) !== expected.fingerprint
  || normalizeIngredientName(parsed.name) !== expected.normalizedName
  || parsed.lastUpdated !== expected.lastUpdated
);
