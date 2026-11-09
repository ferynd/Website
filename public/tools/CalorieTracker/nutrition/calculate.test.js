import { describe, expect, it } from 'vitest';
import { compoundGroups } from '../../../shared/nutrition/import/ingredientList.js';
import { calculateMeal, nutrientBasis, scalePerBasis, RESISTANT_STARCH_COEFFICIENT } from '../../../shared/nutrition/calculate.js';

const nutrient = (value, status = 'measured', extra = {}) => ({ value, status, ...extra });
const zeros = (keys) => Object.fromEntries(keys.map(key => [key, nutrient(0)]));
const polyols = zeros(['erythritol', 'sorbitol', 'mannitol', 'isomalt', 'xylitol', 'glycerol', 'maltitol']);

describe('shared meal calculation', () => {
    it('scales per 100 g and per unit with one function', () => {
        expect(scalePerBasis(50, 20, 100)).toBe(10);
        expect(scalePerBasis(40, 5, 20)).toBe(10);
        expect(scalePerBasis(50, null, 100)).toBeNull();
        expect(scalePerBasis(50, 0, 100)).toBe(0);
    });

    it('keeps unknown distinct from zero and does not mutate inputs', () => {
        const lines = [
            { lineId: 'a', grams: 100, nutrients: { calories: nutrient(100), sodium: nutrient(0) } },
            { lineId: 'b', grams: 100, nutrients: { calories: nutrient(50) } },
        ];
        const snapshot = structuredClone(lines);
        const result = calculateMeal({ lines });
        expect(result.nutrients.calories).toMatchObject({ value: 150, status: 'reported' });
        expect(result.nutrients.sodium).toMatchObject({ value: 0, status: 'reported' });
        expect(result.nutrients.protein.value).toBeNull();
        expect(result.nutrients.protein.status).toBe('unknown');
        expect(lines).toEqual(snapshot);
        expect(calculateMeal({ lines })).toEqual(result);
    });

    it('propagates ranges and estimated status without treating missing lines as zero', () => {
        const result = calculateMeal({ lines: [
            { lineId: 'a', grams: 100, gMin: 80, gMax: 120, quantityBasis: 'estimated', nutrients: { calories: nutrient(10, 'measured', { low: 8, high: 12 }) } },
            { lineId: 'b', grams: 100, nutrients: {} },
        ] });
        expect(result.nutrients.calories.status).toBe('estimated');
        expect(result.nutrients.calories.value).toBe(10);
        expect(result.nutrients.calories.low).toBeCloseTo(6.4);
        expect(result.nutrients.calories.high).toBeCloseTo(14.4);
        expect(result.nutrients.calories.coverage).toMatchObject({ gramsKnown: 100, gramsTotal: 200, ingredientsKnown: 1, ingredientsTotal: 2 });
    });

    it('counts a compound parent or its children once, including nested yield', () => {
        const lines = [
            { lineId: 'sauce', grams: 100, nutrients: { calories: nutrient(100) } },
            { lineId: 'tomato', parentLineId: 'sauce', grams: 40, nutrients: { calories: nutrient(50) } },
            { lineId: 'onion', parentLineId: 'sauce', grams: 20, yieldRetention: 0.5, nutrients: { calories: nutrient(40) } },
        ];
        const result = calculateMeal({ lines });
        expect(result.countedLineIds).toEqual(['tomato', 'onion']);
        expect(result.nutrients.calories.value).toBe(20 + 4);
        expect(new Set(result.countedLineIds)).toEqual(new Set(lines.filter(line => !compoundGroups({ ingredients: lines }).some(group => group.parentLineId === line.lineId)).map(line => line.lineId)));
    });

    it('computes weighted fiber per ingredient without double counting or inventing a category', () => {
        const category = calculateMeal({ lines: [{ lineId: 'oats', grams: 100, fiberCategory: 'oats', nutrients: { fiberTotal: nutrient(10) } }] });
        expect(category.nutrients.fiberWeightedLegacy.value).toBe(8);
        const both = calculateMeal({ lines: [{
            lineId: 'mix', grams: 100, fiberCategory: 'fruit',
            fiberComponents: [{ kind: 'psyllium', gramsPer100g: 10 }, { kind: 'lignin', gramsPer100g: 10 }],
            nutrients: { fiberTotal: nutrient(10) },
        }] });
        expect(both.nutrients.fiberWeightedLegacy.value).toBe(7);
        expect(calculateMeal({ lines: [{ lineId: 'plain', grams: 100, nutrients: { fiberTotal: nutrient(10) } }] }).nutrients.fiberWeightedLegacy.value).toBeNull();
        expect(calculateMeal({ lines: [{ lineId: 'est', grams: 100, quantityBasis: 'estimated', fiberCategory: 'oats', nutrients: { fiberTotal: nutrient(10) } }] }).nutrients.fiberWeightedLegacy.status).toBe('estimated');
        expect(calculateMeal({ lines: [{ lineId: 'src', grams: 100, fiberCategory: 'fruit', nutrients: { fiberTotal: nutrient(10, 'estimated_from_comparable') } }] }).nutrients.fiberWeightedLegacy.status).toBe('estimated');
        expect(category.nutrients.fiberWeightedLegacy.status).toBe('calculated');
        expect(RESISTANT_STARCH_COEFFICIENT).toBe(0.55);
    });

    it('derives adjusted carbs and FODMAP equivalents without clamping or zero-filling gaps', () => {
        const complete = calculateMeal({ carbConvention: 'includes_fiber', lines: [{ lineId: 'a', grams: 100, nutrients: {
            carbs: nutrient(20), fiberTotal: nutrient(5), allulose: nutrient(1), ...polyols, erythritol: nutrient(4), maltitol: nutrient(4),
            lactose: nutrient(6), fructans: nutrient(3),
        } }] });
        expect(complete.adjustedCarbs).toMatchObject({ value: 9, incomplete: false, version: 1 });
        expect(complete.fodmapEquivalents.milkEquivalents.value).toBe(0.5);
        expect(complete.fodmapEquivalents.fructanScoops.value).toBe(1);
        expect(complete.fodmapEquivalents.gosScoops.value).toBeNull();
        const negative = calculateMeal({ carbConvention: 'includes_fiber', lines: [{ lineId: 'a', grams: 100, nutrients: { carbs: nutrient(1), fiberTotal: nutrient(5), allulose: nutrient(0), ...polyols } }] });
        expect(negative.adjustedCarbs.value).toBeNull();
        expect(negative.adjustedCarbs.negative).toBe(true);
        const remainder = calculateMeal({ carbConvention: 'excludes_fiber', lines: [{ lineId: 'a', grams: 100, nutrients: {
            carbs: nutrient(20), allulose: nutrient(0), ...polyols, erythritol: nutrient(2),
            sugarAlcoholsTotal: nutrient(10),
        } }] });
        expect(remainder.adjustedCarbs).toMatchObject({ value: null, incomplete: true });
    });

    it('keeps roasted-meat nutrients when water is lost', () => {
        const meat = { lineId: 'roast', grams: 200, waterDeltaG: -50, nutrients: { calories: nutrient(200) } };
        const result = calculateMeal({ lines: [meat] });
        expect(result.nutrients.calories.value).toBe(400);
        expect(result.mass).toMatchObject({ rawG: 200, cookedG: 150, waterDeltaG: -50 });
        expect(result.countedLineIds).toEqual(['roast']);
    });

    it('keeps boiled-pasta nutrients when water is gained', () => {
        const pasta = { lineId: 'pasta', grams: 100, yieldRetention: 2, nutrients: { calories: nutrient(350) } };
        const result = calculateMeal({ lines: [pasta] });
        expect(nutrientBasis(pasta).g).toBe(100);
        expect(result.nutrients.calories.value).toBe(350);
        expect(result.mass.cookedG).toBe(200);
        expect(result.countedLineIds).toEqual(['pasta']);
    });

    it('keeps baking nutrients when dough loses water', () => {
        const dough = { lineId: 'dough', grams: 500, waterDeltaG: -50, nutrients: { calories: nutrient(250) } };
        const result = calculateMeal({ lines: [dough] });
        expect(result.nutrients.calories.value).toBe(1250);
        expect(result.mass).toMatchObject({ rawG: 500, cookedG: 450, waterDeltaG: -50 });
    });

    it('discards sauce fat once and does not copy it onto another line', () => {
        const result = calculateMeal({ lines: [
            { lineId: 'oil', grams: 30, fatDiscardedG: 15, nutrients: { calories: nutrient(900) } },
            { lineId: 'tomato', grams: 100, fatAbsorbedG: 15, nutrients: { calories: nutrient(20) } },
        ] });
        expect(result.nutrients.calories.value).toBe(135 + 20);
        expect(result.mass.fatDiscardedG).toBe(15);
        expect(result.mass.fatAbsorbedG).toBe(15);
        expect(result.mass.cookedG).toBe(15 + 100);
        const external = calculateMeal({ lines: [
            { lineId: 'potato', grams: 100, fatAbsorbedG: 10, fatAbsorbedExternal: true, nutrients: { calories: nutrient(80) } },
        ] });
        expect(external.nutrients.calories.value).toBe(80);
        expect(external.mass.cookedG).toBe(110);
    });

    it('counts a mixed dish once and does not scale it by water or serving weight', () => {
        const result = calculateMeal({ lines: [
            { lineId: 'burger', grams: 400, nutrients: { calories: nutrient(300) } },
            { lineId: 'patty', parentLineId: 'burger', grams: 150, waterDeltaG: -30, nutrients: { calories: nutrient(250) } },
            { lineId: 'bun', parentLineId: 'burger', grams: 80, nutrients: { calories: nutrient(270) } },
            { lineId: 'cheese', parentLineId: 'burger', grams: 20, yieldRetention: 1, nutrients: { calories: nutrient(350) } },
        ] });
        expect(result.countedLineIds).toEqual(['patty', 'bun', 'cheese']);
        expect(result.nutrients.calories.value).toBe(375 + 216 + 70);
        expect(result.mass).toMatchObject({ rawG: 250, cookedG: 220, waterDeltaG: -30 });
    });
});
