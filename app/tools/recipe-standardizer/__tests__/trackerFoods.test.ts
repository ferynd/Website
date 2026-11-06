import { describe, expect, it } from 'vitest';
import { allNutrients, NUTRIENT_MAX_BOUNDS } from '../../../../public/tools/CalorieTracker/constants.js';
import { buildTrackerFoodDoc, fingerprintTrackerFood, fingerprintTrackerFoodV1, fingerprintTrackerFoodV2, isValidFirestoreDocId, parseTrackerFood, TRACKER_NUTRIENT_KEYS, trackerFoodId, validateTrackerFoodName, verifyTrackerFoodFingerprint, type TrackerFood } from '../lib/trackerFoods';
import { NUTRIENT_INTAKE_SPEC } from '../lib/nutritionIntake';
import { TRACKER_NUTRIENT_MAX_BOUNDS } from '../lib/trackerFoods';

const fullFood = () => ({
  name: ' Eggs ', quantity: 2, ...Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key, index) => [key, index + 1])),
  lastUpdated: '2025-01-01T00:00:00.000Z', extra: 'ignored',
});

describe('trackerFoods', () => {
  it('keeps the Tracker nutrient order in sync', () => {
    expect(TRACKER_NUTRIENT_KEYS).toEqual(allNutrients);
    expect(TRACKER_NUTRIENT_KEYS).toHaveLength(24);
  });

  it('parses full read-only records and normalizes values defensively', () => {
    const parsed = parseTrackerFood('egg', fullFood())!;
    expect(parsed.name).toBe('Eggs');
    expect(parsed.quantity).toBe(2);
    expect(parsed.nutrients.calories).toBe(1);
    expect(parsed).not.toHaveProperty('extra');
    expect(parseTrackerFood('x', { name: 'x', calories: '12.5' })?.nutrients.calories).toBe(12.5);
    expect(parseTrackerFood('x', { name: 'x', calories: Number.NaN, protein: {} })?.nutrients).toMatchObject({ calories: null, protein: null });
    expect(parseTrackerFood('x', { name: 'x', lastUpdated: { toMillis: () => 0 } })?.lastUpdated).toBe('1970-01-01T00:00:00.000Z');
    expect(parseTrackerFood('x', { calories: 1 })).toBeNull();
    expect(parseTrackerFood('x', { name: '  ' })).toBeNull();
    expect(parseTrackerFood('x', null)).toBeNull();
    expect(parseTrackerFood('x', [])).toBeNull();
    expect(parseTrackerFood('x', { name: 'x' })?.nutrients.protein).toBeNull();
  });

  it('fingerprints nutrient data and quantity but not name', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    expect(fingerprintTrackerFood(food)).toBe(fingerprintTrackerFood(food));
    expect(fingerprintTrackerFood(food)).not.toBe(fingerprintTrackerFood({ ...food, quantity: 3 }));
    expect(fingerprintTrackerFood(food)).not.toBe(fingerprintTrackerFood({ ...food, nutrients: { ...food.nutrients, calories: 99 } }));
    expect(fingerprintTrackerFood(food)).toBe(fingerprintTrackerFood({ quantity: food.quantity, nutrients: food.nutrients }));
  });

  it('fingerprintTrackerFood output is unchanged after the fnv1aHex extraction', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    expect(fingerprintTrackerFood(food)).toBe('9418d4fb');
  });

  it('v1 fingerprint matches pinned golden hashes', () => {
    const zeros = Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, 0])) as TrackerFood['nutrients'];
    const nulls = Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, null])) as TrackerFood['nutrients'];
    const salt = { ...zeros, sodium: 39340 };
    const ones = Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, 1])) as TrackerFood['nutrients'];
    expect(fingerprintTrackerFood({ quantity: 1, nutrients: zeros })).toBe('2d7ade36');
    expect(fingerprintTrackerFood({ quantity: null, nutrients: nulls })).toBe('6dcb2209');
    expect(fingerprintTrackerFood({ quantity: 1, nutrients: salt })).toBe('8194e8a5');
    expect(fingerprintTrackerFood({ quantity: 1, nutrients: ones })).toBe('68da78c4');
    expect(fingerprintTrackerFood(parseTrackerFood('egg', fullFood())!)).toBe('9418d4fb');
    const withConventions = parseTrackerFood('egg', fullFood())!;
    const ignoredByV1 = {
      ...withConventions,
      fiberMeaning: 'total' as const,
      carbConvention: 'excludes_fiber' as const,
    };
    expect(fingerprintTrackerFood(ignoredByV1)).toBe('9418d4fb');
  });

  it('registry expansion does not change v1 fingerprints', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    const expanded = { ...food, detail: { fatSaturated: 9, omega3EPA: 1 } };
    expect(fingerprintTrackerFood(expanded)).toBe(fingerprintTrackerFood(food));
    expect(fingerprintTrackerFoodV1(expanded)).toBe('9418d4fb');
  });

  it('v2 fingerprint is v2-prefixed and changes with a detail value or status', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    const digest = fingerprintTrackerFoodV2(food);
    expect(digest.startsWith('v2:')).toBe(true);
    expect(fingerprintTrackerFoodV2({ ...food, detail: { fatSaturated: 1 } })).not.toBe(digest);
    expect(fingerprintTrackerFoodV2({ ...food, quality: { calories: { status: 'measured' } } })).not.toBe(digest);
  });

  it('v2 fingerprint changes when only upperBound, roundingInterval, or qualifier changes', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    const statusOnly = {
      ...food,
      quality: { protein: { status: 'label_reported' as const } },
    };
    const upper5 = {
      ...food,
      quality: { protein: { status: 'label_reported' as const, upperBound: 5 } },
    };
    const upper10 = {
      ...food,
      quality: { protein: { status: 'label_reported' as const, upperBound: 10 } },
    };
    const interval1 = {
      ...food,
      quality: { fiber: { status: 'label_reported' as const, roundingInterval: 1 } },
    };
    const intervalTenth = {
      ...food,
      quality: { fiber: { status: 'label_reported' as const, roundingInterval: 0.1 } },
    };
    const calculated = {
      ...food,
      quality: { calories: { status: 'calculated' as const } },
    };
    const lowerBound = {
      ...food,
      quality: { calories: { status: 'calculated' as const, qualifier: 'lower_bound' } },
    };
    expect(fingerprintTrackerFoodV1(food)).toBe('9418d4fb');
    expect(fingerprintTrackerFoodV1(upper5)).toBe('9418d4fb');
    expect(fingerprintTrackerFoodV1(upper10)).toBe('9418d4fb');
    expect(fingerprintTrackerFoodV1(interval1)).toBe('9418d4fb');
    expect(fingerprintTrackerFoodV1(lowerBound)).toBe('9418d4fb');
    const statusDigest = fingerprintTrackerFoodV2(statusOnly);
    expect(fingerprintTrackerFoodV2(upper5)).not.toBe(statusDigest);
    expect(fingerprintTrackerFoodV2(upper10)).not.toBe(fingerprintTrackerFoodV2(upper5));
    expect(fingerprintTrackerFoodV2({
      ...statusOnly,
      quality: { protein: { status: 'label_reported', upperBound: undefined } },
    })).toBe(statusDigest);
    expect(fingerprintTrackerFoodV2(interval1)).not.toBe(fingerprintTrackerFoodV2(intervalTenth));
    expect(fingerprintTrackerFoodV2(interval1)).not.toBe(fingerprintTrackerFoodV2({
      ...food,
      quality: { fiber: { status: 'label_reported' } },
    }));
    expect(fingerprintTrackerFoodV2(lowerBound)).not.toBe(fingerprintTrackerFoodV2(calculated));
    expect(verifyTrackerFoodFingerprint(upper10, fingerprintTrackerFoodV2(upper5))).toBe('mismatch');
    expect(verifyTrackerFoodFingerprint(upper5, fingerprintTrackerFoodV2(upper5))).toBe('match');
    expect(verifyTrackerFoodFingerprint(food, fingerprintTrackerFoodV1(food))).toBe('match');
  });

  it('v2 fingerprint changes when only fiberMeaning or carbConvention changes', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    const weighted = { ...food, fiberMeaning: 'weighted_legacy' as const, carbConvention: 'includes_fiber' as const };
    const total = { ...food, fiberMeaning: 'total' as const, carbConvention: 'includes_fiber' as const };
    const excludes = { ...food, fiberMeaning: 'total' as const, carbConvention: 'excludes_fiber' as const };
    expect(fingerprintTrackerFoodV1(weighted)).toBe('9418d4fb');
    expect(fingerprintTrackerFoodV1(total)).toBe(fingerprintTrackerFoodV1(weighted));
    const weightedDigest = fingerprintTrackerFoodV2(weighted);
    expect(fingerprintTrackerFoodV2(total)).not.toBe(weightedDigest);
    expect(fingerprintTrackerFoodV2(excludes)).not.toBe(fingerprintTrackerFoodV2(total));
    expect(fingerprintTrackerFoodV2({ ...weighted, fiberMeaning: 'unknown', carbConvention: 'unknown' })).toBe(fingerprintTrackerFoodV2(food));
    expect(verifyTrackerFoodFingerprint(total, weightedDigest)).toBe('mismatch');
    expect(verifyTrackerFoodFingerprint(weighted, weightedDigest)).toBe('match');
  });

  it('verify: unchanged v1 values and no detail → match; with detail → match-v1-expanded; changed legacy value → mismatch', () => {
    const food = parseTrackerFood('egg', fullFood())!;
    const stored = fingerprintTrackerFoodV1(food);
    expect(verifyTrackerFoodFingerprint(food, stored)).toBe('match');
    expect(verifyTrackerFoodFingerprint({ ...food, detail: { fatSaturated: 2 } }, stored)).toBe('match-v1-expanded');
    expect(verifyTrackerFoodFingerprint({ ...food, nutrients: { ...food.nutrients, calories: 99 } }, stored)).toBe('mismatch');
    expect(verifyTrackerFoodFingerprint(food, null)).toBe('mismatch');
  });

  it('parseTrackerFood reads v2 detail, nulls and quality, and counts unknown fields', () => {
    const parsed = parseTrackerFood('salt', {
      name: 'Salt',
      quantity: 1,
      nutrientSchemaVersion: 2,
      ...Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, key === 'sodium' ? 39340 : 0])),
      sodium: null,
      fatSaturated: 1.5,
      omega3EPA: null,
      nutrientMeta: {
        registryVersion: 2,
        fiberMeaning: 'total',
        carbConvention: 'includes_fiber',
        quality: { sodium: { status: 'measured' }, fatSaturated: { status: 'label_reported', roundingInterval: 0.1 } },
      },
      mysteryField: 'secret',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    })!;
    expect(parsed.schema).toBe(2);
    expect(parsed.nutrients.sodium).toBeNull();
    expect(parsed.nutrients.calories).toBe(0);
    expect(parsed.detail).toMatchObject({ fatSaturated: 1.5, omega3EPA: null });
    expect(parsed.quality?.sodium).toEqual({ status: 'measured' });
    expect(parsed.fiberMeaning).toBe('total');
    expect(parsed.carbConvention).toBe('includes_fiber');
    expect(parsed.unknownFields).toEqual(['mysteryField']);
  });

  it('TRACKER_NUTRIENT_MAX_BOUNDS mirrors CalorieTracker NUTRIENT_MAX_BOUNDS', () => {
    expect(TRACKER_NUTRIENT_MAX_BOUNDS).toEqual(NUTRIENT_MAX_BOUNDS);
  });

  it('mirrors Tracker food IDs and validates safe names', () => {
    expect(trackerFoodId('Olive Oil')).toBe('olive_oil');
    expect(trackerFoodId(' Flour ')).toBe('flour');
    expect(trackerFoodId('All-purpose flour (per 100 g)')).toBe('all_purpose_flour__per_100_g_');
    expect(trackerFoodId('Crème fraîche')).toBe('cr_me_fra_che');
    expect(trackerFoodId('olive-oil')).toBe(trackerFoodId('Olive Oil'));
    expect(validateTrackerFoodName('  ')).toBe('Enter a food name.');
    expect(validateTrackerFoodName('x'.repeat(81))).toContain('80 characters');
    expect(validateTrackerFoodName('東京')).toBe('Add Latin letters or digits to the name (the Nutrition Tracker ID only keeps A–Z and 0–9).');
    expect(validateTrackerFoodName('豆腐 (per 100 g)')).toBe('Add Latin letters or digits to the name (the Nutrition Tracker ID only keeps A–Z and 0–9).');
    expect(validateTrackerFoodName('Tofu 豆腐 (per 100 g)')).toBeNull();
    expect(validateTrackerFoodName('Flour (per 100 g)')).toBeNull();
    expect(validateTrackerFoodName('**x**')).toContain('reserved Firestore ID');
    expect(validateTrackerFoodName('Olive oil')).toBeNull();
  });

  it.each(['東京 (per portion)', '東京 (per 100 g cooked)', '東京(per 100 g)', '東京(per portion)'])(
    'validateTrackerFoodName rejects names that are only an export suffix after non-Latin text',
    (name) => {
      expect(validateTrackerFoodName(name)).toContain('Add Latin letters or digits');
    },
  );

  it('validateTrackerFoodName accepts Butter cookies (per portion) and keeps P2 per-100 g cases passing', () => {
    expect(validateTrackerFoodName('Butter cookies (per portion)')).toBeNull();
    expect(validateTrackerFoodName('Flour (per 100 g)')).toBeNull();
  });

  it('checks Firestore document ID constraints using UTF-8 byte length', () => {
    for (const id of ['foo/bar', '.', '..', '__x__', 'é'.repeat(751)]) {
      expect(isValidFirestoreDocId(id)).toBe(false);
    }
    expect(isValidFirestoreDocId('normal-id')).toBe(true);
    expect(isValidFirestoreDocId('é'.repeat(750))).toBe(true);
  });

  it('builds exact Tracker shape and keeps all intake bounds within Tracker caps', () => {
    const nutrients = Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((k) => [k, 1])) as Record<typeof TRACKER_NUTRIENT_KEYS[number], number>;
    const doc = buildTrackerFoodDoc(' Eggs ', nutrients, '2025-01-02T00:00:00.000Z');
    expect(Object.keys(doc)).toEqual(['name','quantity',...allNutrients,'lastUpdated']);
    expect(doc.name).toBe('Eggs'); expect(doc.quantity).toBe(1);
    const parsed = parseTrackerFood('eggs',doc)!;
    expect(parsed.lastUpdated).toBe('2025-01-02T00:00:00.000Z');
    expect(parsed.nutrients).toEqual(nutrients);
    expect(fingerprintTrackerFood(parsed)).toBe(fingerprintTrackerFood(parseTrackerFood('eggs',doc)!));
    expect(() => buildTrackerFoodDoc('x', { ...nutrients, calories: Number.NaN }, 'now')).toThrow();
    expect(() => buildTrackerFoodDoc('x', { ...nutrients, calories: -1 }, 'now')).toThrow();
    expect(Object.keys(NUTRIENT_INTAKE_SPEC)).toEqual([...TRACKER_NUTRIENT_KEYS]);
    for (const key of TRACKER_NUTRIENT_KEYS) {
      expect(NUTRIENT_INTAKE_SPEC[key].max).toBeLessThanOrEqual(NUTRIENT_MAX_BOUNDS[key]);
      expect(NUTRIENT_INTAKE_SPEC[key].trackerCap).toBe(NUTRIENT_INTAKE_SPEC[key].max === NUTRIENT_MAX_BOUNDS[key]);
    }
  });
});
