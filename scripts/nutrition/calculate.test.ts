import { expect, it } from 'vitest';
import { calculateMeal, scalePerBasis } from '../../public/shared/nutrition/calculate.js';

it('shares per-100 g scaling and does not store weighted fiber on the profile', () => {
    expect(scalePerBasis(250, 4, 100)).toBe(10);
    const result = calculateMeal({ lines: [{ lineId: 'a', grams: 100, fiberCategory: 'fruit', nutrients: { fiberTotal: { value: 10, status: 'measured' }, calories: { value: 40, status: 'measured' } } }] });
    expect(result.nutrients.calories.value).toBe(40);
    expect(result.nutrients.fiberWeightedLegacy.value).toBe(8);
    expect(result.nutrients.fiberWeightedLegacy.status).toBe('calculated');
});
