/* Nutrition Tracker food contracts, parsing, and identifiers. */

import { resolveNutrientWriteVersion } from '@/public/shared/nutrition/capabilities.js';
import {
  CARB_CONVENTIONS,
  FINGERPRINT_KEYSETS,
  FIBER_MEANINGS,
  LEGACY_V1_KEYS,
  NUTRIENT_STATUSES,
  RESERVED_DOC_FIELDS,
  V2_DETAIL_KEYS,
  V2_KEYS,
  getNutrient,
  type CarbConvention,
  type DetailKey,
  type FiberMeaning,
  type NutrientKey,
  type NutrientQuality,
} from '@/public/shared/nutrition/nutrientRegistry.js';
import { normalizeIngredientName } from './shoppingList';
import type { FoodItemRef } from './types';

/* --- CONFIGURATION: tracker export bounds and name suffixes --- */
/** Maximum values accepted by the Nutrition Tracker's food editor. Derived from the shared registry. */
export const TRACKER_NUTRIENT_MAX_BOUNDS = Object.fromEntries(
  LEGACY_V1_KEYS.map((key) => [key, getNutrient(key)!.bounds.perUnit.max]),
) as Record<TrackerNutrientKey, number>;

/** Suffixes ignored when checking whether an export name has a usable tracker id. */
export const TRACKER_NAME_BASIS_SUFFIXES = [' (per 100 g)', ' (per portion)', ' (per 100 g cooked)'] as const;

/* CONFIGURATION: Nutrition Tracker nutrient keys (re-export of the shared registry). */
/** Nutrient fields stored in Nutrition Tracker food documents. */
export const TRACKER_NUTRIENT_KEYS = LEGACY_V1_KEYS;

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
  /** 2 when the document declares nutrientSchemaVersion 2. Omitted fields stay compatible with older fixtures. */
  schema?: 1 | 2;
  detail?: Partial<Record<DetailKey, number | null>>;
  quality?: Partial<Record<NutrientKey, NutrientQuality>>;
  fiberMeaning?: FiberMeaning;
  carbConvention?: CarbConvention;
  /** Names of document fields the registry does not recognize. */
  unknownFields?: string[];
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
  const schema = Number(record.nutrientSchemaVersion) === 2 ? 2 : 1;
  const detail: Partial<Record<DetailKey, number | null>> = {};
  const quality: Partial<Record<NutrientKey, NutrientQuality>> = {};
  let fiberMeaning: FiberMeaning = 'unknown';
  let carbConvention: CarbConvention = 'unknown';
  if (schema === 2) {
    for (const key of V2_DETAIL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      detail[key] = record[key] === null ? null : readFiniteNumber(record[key]);
    }
    for (const key of LEGACY_V1_KEYS) {
      if (record[key] === null) nutrients[key] = null;
    }
    const meta = record.nutrientMeta;
    if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
      const metaRecord = meta as Record<string, unknown>;
      if (FIBER_MEANINGS.includes(metaRecord.fiberMeaning as FiberMeaning)) fiberMeaning = metaRecord.fiberMeaning as FiberMeaning;
      if (CARB_CONVENTIONS.includes(metaRecord.carbConvention as CarbConvention)) carbConvention = metaRecord.carbConvention as CarbConvention;
      const storedQuality = metaRecord.quality;
      if (typeof storedQuality === 'object' && storedQuality !== null) {
        for (const [key, raw] of Object.entries(storedQuality as Record<string, unknown>)) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const entry = raw as Record<string, unknown>;
          if (!NUTRIENT_STATUSES.includes(entry.status as NutrientQuality['status'])) continue;
          quality[key as NutrientKey] = {
            status: entry.status as NutrientQuality['status'],
            ...(typeof entry.roundingInterval === 'number' ? { roundingInterval: entry.roundingInterval } : {}),
            ...(typeof entry.upperBound === 'number' ? { upperBound: entry.upperBound } : {}),
            ...(typeof entry.qualifier === 'string' ? { qualifier: entry.qualifier } : {}),
          };
        }
      }
    }
  }
  const known = new Set<string>([...RESERVED_DOC_FIELDS, ...V2_KEYS]);
  const unknownFields = Object.keys(record).filter((key) => !known.has(key));
  return {
    id,
    name: record.name.trim(),
    quantity: readFiniteNumber(record.quantity),
    nutrients,
    lastUpdated,
    schema,
    detail,
    quality,
    fiberMeaning,
    carbConvention,
    unknownFields,
  };
};

/** Build a v2 tracker document. Callers must pass writeVersion 2. Nulls are preserved. */
export const buildTrackerFoodDocV2 = (
  name: string,
  fields: { nutrients: Record<TrackerNutrientKey, number | null>; detail?: Partial<Record<DetailKey, number | null>>; quality?: Partial<Record<NutrientKey, NutrientQuality>>; fiberMeaning?: FiberMeaning; carbConvention?: CarbConvention },
  nowIso: string,
): Record<string, unknown> & { name: string; quantity: 1; lastUpdated: string } => {
  const doc: Record<string, unknown> & { name: string; quantity: 1; lastUpdated: string } = {
    name: name.trim(),
    quantity: 1,
    lastUpdated: nowIso,
  };
  for (const key of V2_KEYS) {
    const value = (LEGACY_V1_KEYS as readonly string[]).includes(key)
      ? fields.nutrients[key as TrackerNutrientKey]
      : fields.detail?.[key as DetailKey];
    doc[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  const quality: Record<string, NutrientQuality> = {};
  for (const [key, entry] of Object.entries(fields.quality ?? {})) {
    if (!entry || entry.status === 'unknown') continue;
    quality[key] = entry;
  }
  const nutrientMeta: Record<string, unknown> = { registryVersion: 2, quality };
  if (fields.fiberMeaning && fields.fiberMeaning !== 'unknown') nutrientMeta.fiberMeaning = fields.fiberMeaning;
  if (fields.carbConvention && fields.carbConvention !== 'unknown') nutrientMeta.carbConvention = fields.carbConvention;
  doc.nutrientSchemaVersion = 2;
  doc.nutrientMeta = nutrientMeta;
  doc.lastUpdated = nowIso;
  return doc;
};

type IntakeFoodOptions = {
  writeVersion?: 1 | 2;
  detail?: Partial<Record<DetailKey, number | null>>;
  quality?: Partial<Record<NutrientKey, NutrientQuality>>;
};

/** Choose the v1 or v2 food document from the write version. Defaults to the production flag. */
export const intakeFoodDoc = (
  name: string,
  nutrients: Record<TrackerNutrientKey, number>,
  nowIso: string,
  options?: IntakeFoodOptions,
): TrackerFoodDoc | ReturnType<typeof buildTrackerFoodDocV2> => {
  const version = options?.writeVersion ?? resolveNutrientWriteVersion();
  if (version === 2) {
    return buildTrackerFoodDocV2(name, {
      nutrients,
      detail: options?.detail,
      quality: options?.quality,
    }, nowIso);
  }
  return buildTrackerFoodDoc(name, nutrients, nowIso);
};

/** Create a stable fingerprint for the tracker quantity and nutrient values. */
export const fingerprintTrackerFoodV1 = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients'>,
): string => {
  const canonical = `q=${food.quantity ?? ''}${FINGERPRINT_KEYSETS[1]
    .map((key) => `;${key}=${food.nutrients[key] ?? ''}`)
    .join('')}`;
  return fnv1aHex(canonical);
};

/** Existing callers keep the v1 fingerprint. */
export const fingerprintTrackerFood = fingerprintTrackerFoodV1;

const detailValue = (food: Pick<TrackerFood, 'detail'>, key: DetailKey): number | null => {
  const value = food.detail?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : null;
};

/** v2 fingerprint includes every registry key plus its quality status. */
export const fingerprintTrackerFoodV2 = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients' | 'detail' | 'quality'>,
): string => {
  const canonical = `r=2|q=${food.quantity ?? ''}${V2_KEYS.map((key) => {
    const value = (LEGACY_V1_KEYS as readonly string[]).includes(key)
      ? food.nutrients[key as TrackerNutrientKey]
      : detailValue(food, key as DetailKey);
    const status = food.quality?.[key]?.status ?? '';
    return `;${key}=${value ?? ''}:${status ?? ''}`;
  }).join('')}`;
  return `v2:${fnv1aHex(canonical)}`;
};

export type FingerprintVerdict = 'match' | 'match-v1-expanded' | 'mismatch';

/** Compare a stored fingerprint. match and match-v1-expanded are unchanged for the legacy 24 keys. */
export const verifyTrackerFoodFingerprint = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients' | 'detail' | 'quality'>,
  stored: string | null,
): FingerprintVerdict => {
  if (stored == null || stored === '') return 'mismatch';
  if (stored.startsWith('v2:')) return fingerprintTrackerFoodV2(food) === stored ? 'match' : 'mismatch';
  if (fingerprintTrackerFoodV1(food) !== stored) return 'mismatch';
  const expanded = V2_DETAIL_KEYS.some((key) => {
    const value = food.detail?.[key];
    return typeof value === 'number' && Number.isFinite(value);
  });
  return expanded ? 'match-v1-expanded' : 'match';
};

/** Fingerprint stored on new links and exports. v1 while production writes are off. */
export const currentFingerprint = (
  food: Pick<TrackerFood, 'quantity' | 'nutrients' | 'detail' | 'quality'>,
): string => (resolveNutrientWriteVersion() === 2 ? fingerprintTrackerFoodV2(food) : fingerprintTrackerFoodV1(food));

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
  || verifyTrackerFoodFingerprint(parsed, expected.fingerprint) === 'mismatch'
  || normalizeIngredientName(parsed.name) !== expected.normalizedName
  || parsed.lastUpdated !== expected.lastUpdated
);
