import { describe, expect, it } from 'vitest';
import { allNutrients } from '../../../../public/tools/CalorieTracker/constants.js';
import { fingerprintTrackerFood, parseTrackerFood, TRACKER_NUTRIENT_KEYS } from '../lib/trackerFoods';

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
});
