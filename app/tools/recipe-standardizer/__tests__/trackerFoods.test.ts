import { describe, expect, it } from 'vitest';
import { allNutrients, NUTRIENT_MAX_BOUNDS } from '../../../../public/tools/CalorieTracker/constants.js';
import { buildTrackerFoodDoc, fingerprintTrackerFood, isValidFirestoreDocId, parseTrackerFood, TRACKER_NUTRIENT_KEYS, trackerFoodId, validateTrackerFoodName } from '../lib/trackerFoods';
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
