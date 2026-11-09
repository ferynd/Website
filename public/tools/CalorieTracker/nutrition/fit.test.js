import { describe, expect, it } from 'vitest';
import { fitQuantities } from '../../../shared/nutrition/fit.js';

const calories = value => ({ calories: { value, status: 'measured' } });
const fact = (nutrients, extra = {}) => ({ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients, ...extra });

describe('quantity fitting', () => {
    it('does not invent a target for a photo-only meal or a missing nutrient', () => {
        const photo = fitQuantities({ lines: [{ lineId: 'rice', grams: 100, gMin: 40, gMax: 160, basis: 'estimated', nutrients: calories(130) }] });
        expect(photo).toMatchObject({ skipped: true, ran: false, reason: 'no eligible known facts', modelCalls: 0 });
        expect(photo.quantities[0].grams).toBe(100);
        const missing = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, gMin: 40, gMax: 160, basis: 'estimated', nutrients: calories(130) }],
            facts: [fact({ protein: { value: 20, unit: 'g' } })],
        });
        expect(missing.reason).toBe('no numeric fit target');
        expect(missing.quantities[0].changed).toBe(false);
    });

    it('scales an estimated portion and leaves a known recipe fixed', () => {
        const scaled = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, gMin: 0, gMax: 400, basis: 'estimated', nutrients: calories(100) }],
            facts: [fact(calories(250))],
        });
        expect(scaled.quantities[0].grams).toBeCloseTo(250, 0);
        expect(scaled.flags).toMatchObject({ infeasible: false, nonUnique: false, unique: true });
        expect(scaled.calculation.nutrients.calories.value).toBeCloseTo(250, 0);
        const again = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, gMin: 0, gMax: 400, basis: 'estimated', nutrients: calories(100) }],
            facts: [fact(calories(250))],
        });
        expect(again.quantities).toEqual(scaled.quantities);
        const fixed = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, basis: 'recipe_stated', nutrients: calories(130) }],
            facts: [fact(calories(130))],
        });
        expect(fixed.quantities[0]).toMatchObject({ grams: 100, changed: false });
        expect(fixed.flags.infeasible).toBe(false);
        const withheld = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, gMin: 0, gMax: 400, basis: 'recipe_stated', nutrients: calories(100) }],
            facts: [fact(calories(250))],
        });
        expect(withheld.quantities[0].grams).toBe(100);
        expect(withheld.flags.infeasible).toBe(true);
    });

    it('reports a non-unique fit and does not treat a rounded label as an exact point', () => {
        const ambiguous = fitQuantities({
            lines: [
                { lineId: 'a', grams: 50, gMin: 0, gMax: 200, basis: 'estimated', nutrients: calories(100) },
                { lineId: 'b', grams: 50, gMin: 0, gMax: 200, basis: 'estimated', nutrients: calories(100) },
            ],
            facts: [fact(calories(100))],
        });
        expect(ambiguous.flags.nonUnique).toBe(true);
        expect(ambiguous.flags.unique).toBe(false);
        expect(ambiguous.quantities.map(item => item.grams).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 0);
        const rounded = fitQuantities({
            lines: [{ lineId: 'rice', grams: 100, gMin: 0, gMax: 400, basis: 'estimated', nutrients: calories(100) }],
            facts: [fact({ calories: { value: 180, unit: 'kcal', rounding: 'fda_label' } })],
        });
        expect(rounded.reason).toBe('no numeric fit target');
        expect(rounded.quantities[0].grams).toBe(100);
        const capped = fitQuantities({
            lines: [{ lineId: 'oil', grams: 80, gMin: 0, gMax: 200, basis: 'estimated', nutrients: calories(100) }],
            facts: [fact({ calories: { value: 100, unit: 'kcal', qualifier: 'less_than' } })],
        });
        expect(capped.quantities[0].grams).toBeLessThanOrEqual(100);
        expect(capped.residuals[0].consistent).toBe(true);
        expect(capped.residuals[0].difference).toBeNull();
    });

    it('keeps order, a two-percent tail, yield, and nested lines from being double counted', () => {
        const ordered = fitQuantities({
            lines: [
                { lineId: 'beef', grams: 80, basis: 'measured', nutrients: calories(200), order: { position: 1 } },
                { lineId: 'salt', grams: 100, gMin: 0, gMax: 120, basis: 'estimated', nutrients: calories(0), order: { position: 2 } },
            ],
            facts: [fact(calories(160))],
        });
        expect(ordered.quantities.find(item => item.lineId === 'beef').grams).toBe(80);
        expect(ordered.quantities.find(item => item.lineId === 'salt').grams).toBeLessThanOrEqual(80);
        const tail = fitQuantities({
            lines: [
                { lineId: 'beef', grams: 100, basis: 'measured', nutrients: calories(200) },
                { lineId: 'spice', grams: 10, gMin: 0, gMax: 20, basis: 'estimated', nutrients: calories(0), order: { tail: true } },
            ],
            facts: [fact(calories(200))],
        });
        expect(tail.quantities.find(item => item.lineId === 'spice').grams).toBeLessThanOrEqual(2.1);
        const oil = fitQuantities({
            lines: [{ lineId: 'oil', grams: 10, gMin: 0, gMax: 100, basis: 'estimated', nutrients: calories(200), yieldRetention: 0.5 }],
            facts: [fact(calories(50))],
        });
        expect(oil.quantities[0].grams).toBeCloseTo(50, 0);
        expect(oil.calculation.nutrients.calories.value).toBeCloseTo(50, 0);
        const nested = fitQuantities({
            lines: [
                { lineId: 'sauce', grams: 100, gMin: 0, gMax: 200, basis: 'estimated', nutrients: calories(900) },
                { lineId: 'tomato', grams: 40, gMin: 0, gMax: 100, basis: 'estimated', nutrients: calories(50), parentLineId: 'sauce' },
            ],
            facts: [fact(calories(25))],
        });
        expect(nested.quantities.find(item => item.lineId === 'sauce').grams).toBe(100);
        expect(nested.quantities.find(item => item.lineId === 'tomato').grams).toBeCloseTo(50, 0);
        expect(nested.calculation.nutrients.calories.value).toBeCloseTo(25, 0);
        expect(nested.modelCalls).toBe(0);
    });
});
