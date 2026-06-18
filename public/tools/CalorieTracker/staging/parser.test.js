/**
 * @file staging/parser.test.js
 * @description Pure-function tests for the food item construction logic in parser.js.
 *
 * These tests validate the invariant that food items store per-unit nutrient values
 * and that downstream consumers (display, recalc, remove, quantity edit) apply
 * quantity exactly once via `qty * item[nutrient]`.
 *
 * No DOM, no Firebase, no state mutations.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror the pure construction formulas from parser.js so the test
// suite remains independent of DOM-coupled imports.
// ---------------------------------------------------------------------------

/** Mirrors the add food item construction in addStagedNutrientsToDailyLog. */
function buildAddItem(staged, qty) {
  const negativeStaged = Object.fromEntries(
    Object.entries(staged).map(([k, v]) => [k, v || 0])
  );
  return { quantity: qty, ...negativeStaged };
}

/** Mirrors the subtract food item construction in subtractStagedNutrientsFromDailyLog (fixed). */
function buildSubtractItem(staged, qty) {
  const negativeStaged = Object.fromEntries(
    Object.entries(staged).map(([k, v]) => [k, -(v || 0)])
  );
  return { quantity: qty, ...negativeStaged };
}

/** Mirrors the effective-total calculation used by renderFoodItemsContent, updateItemQuantity, and removeFoodItem. */
function effectiveTotal(item, nutrient = 'calories') {
  const q = parseFloat(item.quantity ?? 0) || 0;
  return q * (parseFloat(item[nutrient]) || 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('add food item construction', () => {
  it('stores per-unit calories; effective total = qty × unitCalories', () => {
    const item = buildAddItem({ calories: 100, protein: 10, carbs: 20, fat: 5 }, 2);
    expect(item.quantity).toBe(2);
    expect(item.calories).toBe(100);       // per-unit, not pre-multiplied
    expect(effectiveTotal(item)).toBe(200); // 2 × 100
  });

  it('quantity 1 gives same effective total as stored value', () => {
    const item = buildAddItem({ calories: 350 }, 1);
    expect(effectiveTotal(item)).toBe(350);
  });
});

describe('subtract food item construction', () => {
  it('stores negative per-unit calories; effective total = qty × (−unitCalories)', () => {
    const item = buildSubtractItem({ calories: 100, protein: 10, carbs: 20, fat: 5 }, 2);
    expect(item.quantity).toBe(2);
    expect(item.calories).toBe(-100);       // negative per-unit, NOT qty-pre-applied
    expect(effectiveTotal(item)).toBe(-200); // 2 × −100
  });

  it('quantity 1 gives effective total equal to the negative staged value', () => {
    const item = buildSubtractItem({ calories: 100 }, 1);
    expect(effectiveTotal(item)).toBe(-100);
  });

  it('effective total is NOT −400 when qty=2 and staged calories=100', () => {
    const item = buildSubtractItem({ calories: 100 }, 2);
    expect(effectiveTotal(item)).not.toBe(-400); // the old (buggy) result
    expect(effectiveTotal(item)).toBe(-200);
  });
});

describe('remove subtraction item restores correct day total', () => {
  it('removing a qty=2 subtract-100-cal item restores +200, not +400', () => {
    const item = buildSubtractItem({ calories: 100 }, 2);
    // removeFoodItem computes: itemValue = qty * item[n], then total -= itemValue.
    // For a subtraction item the itemValue is: 2 * -100 = -200.
    // Removing it means the daily total increases by 200.
    const itemValue = parseFloat(item.quantity) * parseFloat(item.calories);
    expect(itemValue).toBe(-200);
    expect(-itemValue).toBe(200); // the net effect on the day total
  });
});

describe('quantity editing on subtraction item', () => {
  it('changing qty from 2 to 3 recalculates to −300 calories', () => {
    const item = buildSubtractItem({ calories: 100 }, 2);
    item.quantity = 3;
    expect(effectiveTotal(item)).toBe(-300); // 3 × −100
  });

  it('changing qty from 2 to 1 recalculates to −100 calories', () => {
    const item = buildSubtractItem({ calories: 100 }, 2);
    item.quantity = 1;
    expect(effectiveTotal(item)).toBe(-100); // 1 × −100
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection — mirrors findDailyDuplicate from parser.js
// ---------------------------------------------------------------------------

function isDailyDuplicate(existingItems, name, calories) {
  const lowerName = name.toLowerCase();
  return existingItems.some(
    item => (item.name || '').toLowerCase() === lowerName
         && Math.round(parseFloat(item.calories) || 0) === Math.round(parseFloat(calories) || 0)
  );
}

describe('daily duplicate detection', () => {
  const existing = [
    { name: 'Chicken Breast', calories: 165, protein: 31, quantity: 1 },
    { name: 'Brown Rice', calories: 215, protein: 5, quantity: 1 },
  ];

  it('detects exact name+calorie match', () => {
    expect(isDailyDuplicate(existing, 'Chicken Breast', 165)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDailyDuplicate(existing, 'chicken breast', 165)).toBe(true);
    expect(isDailyDuplicate(existing, 'BROWN RICE', 215)).toBe(true);
  });

  it('does not flag different calories', () => {
    expect(isDailyDuplicate(existing, 'Chicken Breast', 200)).toBe(false);
  });

  it('does not flag different name', () => {
    expect(isDailyDuplicate(existing, 'Salmon', 165)).toBe(false);
  });

  it('rounds calories for comparison', () => {
    expect(isDailyDuplicate(existing, 'Chicken Breast', 165.4)).toBe(true);
    expect(isDailyDuplicate(existing, 'Chicken Breast', 164.6)).toBe(true);
    expect(isDailyDuplicate(existing, 'Chicken Breast', 163.4)).toBe(false);
  });

  it('returns false for empty log', () => {
    expect(isDailyDuplicate([], 'Chicken Breast', 165)).toBe(false);
  });

  it('handles blank names', () => {
    const withBlank = [{ name: '', calories: 100, quantity: 1 }];
    expect(isDailyDuplicate(withBlank, '', 100)).toBe(true);
    expect(isDailyDuplicate(withBlank, '(Staged Entry)', 100)).toBe(false);
  });
});

describe('add and subtract are symmetric at same qty', () => {
  it('add and subtract of same nutrients at same qty cancel to zero effective total', () => {
    const staged = { calories: 250, protein: 30, carbs: 40, fat: 8 };
    const qty = 3;
    const addItem = buildAddItem(staged, qty);
    const subItem = buildSubtractItem(staged, qty);

    for (const n of ['calories', 'protein', 'carbs', 'fat']) {
      expect(effectiveTotal(addItem, n) + effectiveTotal(subItem, n)).toBe(0);
    }
  });
});
