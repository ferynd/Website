import { V2_KEYS } from './nutrientRegistry.js';

/** Meal math only. Profiles stay per 100 g. This module does not fetch, fit, or save. */
export const CALCULATION_VERSION = 2;
export const FIBER_WEIGHT_VERSION = 1;
export const ADJUSTED_CARB_VERSION = 1;
export const FODMAP_EQUIVALENT_VERSION = 1;
export const RESISTANT_STARCH_COEFFICIENT = 0.55;
export const FIBER_CATEGORY_COEFFICIENTS = Object.freeze({
    fruit: 0.8, legumes: 0.8, oats: 0.8, barley: 0.8,
    'non-starchy-vegetables': 0.7, 'nuts-seeds': 0.6, 'wheat-bran': 0.5,
});
export const FIBER_SUBTYPE_COEFFICIENTS = Object.freeze({
    psyllium: 0.7, resistantStarch: RESISTANT_STARCH_COEFFICIENT, cellulose: 0.2, lignin: 0, fermentable: 1,
});
export const POLYOL_COUNTED_FRACTIONS = Object.freeze({
    erythritol: 0, sorbitol: 0.5, mannitol: 0.5, isomalt: 0.5, xylitol: 0.5, glycerol: 0.5, maltitol: 0.75,
});
const STORED_KEYS = V2_KEYS.filter(key => key !== 'fiberWeightedLegacy');
const REPORTED = new Set(['measured', 'label_reported', 'legacy_unclassified']);

/** One scaling rule for per-100 g profiles and per-unit foods. Null stays null. */
export function scalePerBasis(quantityGrams, amountPerBasis, basisGrams) {
    if (!Number.isFinite(quantityGrams) || quantityGrams < 0 || !Number.isFinite(basisGrams) || basisGrams <= 0) return null;
    if (typeof amountPerBasis !== 'number' || !Number.isFinite(amountPerBasis) || amountPerBasis < 0) return null;
    const contribution = quantityGrams / basisGrams * amountPerBasis;
    return Number.isFinite(contribution) ? contribution : null;
}

function countedLines(lines) {
    const parents = new Set(lines.filter(line => line.parentLineId).map(line => line.parentLineId));
    return lines.filter(line => !parents.has(line.lineId));
}

/**
 * Nutrient grams are the edible profile amount after one fat discard and one nutrient retention.
 * Water changes cooked weight only. yieldRetention above 1 is water gain, not a dropped line
 * and not a nutrient multiplier. External absorbed fat adds mass only when fatAbsorbedExternal is set,
 * so a counted fat line is not added twice.
 */
export function nutrientBasis(line) {
    const grams = Number.isFinite(line.grams) && line.grams >= 0 ? line.grams : null;
    if (grams == null) return null;
    const stated = line.yieldRetention == null ? 1 : line.yieldRetention;
    if (!Number.isFinite(stated) || stated < 0) return null;
    const retention = stated > 1 ? 1 : stated;
    const explicitWater = Number.isFinite(line.waterDeltaG);
    const waterDeltaG = explicitWater ? line.waterDeltaG : (stated > 1 ? grams * (stated - 1) : 0);
    const fatDiscardedG = Number.isFinite(line.fatDiscardedG) && line.fatDiscardedG > 0 ? line.fatDiscardedG : 0;
    const fatAbsorbedG = Number.isFinite(line.fatAbsorbedG) && line.fatAbsorbedG > 0 ? line.fatAbsorbedG : 0;
    const externalFat = line.fatAbsorbedExternal === true ? fatAbsorbedG : 0;
    const scale = value => {
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.max(0, value - Math.min(fatDiscardedG, value)) * retention;
    };
    const g = scale(grams);
    const cooked = grams + waterDeltaG + externalFat - fatDiscardedG;
    return {
        g,
        gMin: scale(line.gMin) ?? g,
        gMax: scale(line.gMax) ?? g,
        rawG: grams,
        cookedG: cooked < 0 ? 0 : cooked,
        waterDeltaG,
        fatAbsorbedG,
        fatDiscardedG,
        retention,
    };
}

function gramsOf(line) {
    const basis = nutrientBasis(line);
    if (!basis) return null;
    return { g: basis.g, gMin: basis.gMin, gMax: basis.gMax };
}

function addMass(total, basis) {
    total.rawG += basis.rawG;
    total.cookedG += basis.cookedG;
    total.waterDeltaG += basis.waterDeltaG;
    total.fatAbsorbedG += basis.fatAbsorbedG;
    total.fatDiscardedG += basis.fatDiscardedG;
}

function observation(line, key) {
    const raw = line.nutrients?.[key];
    if (!raw || raw.value == null || !Number.isFinite(raw.value) || raw.value < 0) return null;
    return { value: raw.value, low: Number.isFinite(raw.low) ? raw.low : raw.value, high: Number.isFinite(raw.high) ? raw.high : raw.value, status: raw.status || 'unknown' };
}

function rollup(parts) {
    const known = parts.filter(part => part.value != null);
    if (!known.length) return 'unknown';
    if (known.some(part => part.estimated)) return 'estimated';
    if (known.some(part => part.status === 'calculated')) return 'calculated';
    return 'reported';
}

function weightedFiber(line, grams) {
    const quantityEstimated = line.quantityBasis === 'estimated';
    const components = line.fiberComponents;
    if (Array.isArray(components) && components.length) {
        let value = 0;
        let low = 0;
        let high = 0;
        let estimated = quantityEstimated;
        for (const component of components) {
            const coefficient = FIBER_SUBTYPE_COEFFICIENTS[component.kind];
            if (coefficient == null || !Number.isFinite(component.gramsPer100g) || component.gramsPer100g < 0) return null;
            if (component.status === 'estimated_from_comparable') estimated = true;
            value += scalePerBasis(grams.g, component.gramsPer100g, 100) * coefficient;
            low += scalePerBasis(grams.gMin, component.low ?? component.gramsPer100g, 100) * coefficient;
            high += scalePerBasis(grams.gMax, component.high ?? component.gramsPer100g, 100) * coefficient;
        }
        return { value, low, high, coefficient: 'subtype', status: estimated ? 'estimated' : 'calculated' };
    }
    const coefficient = FIBER_CATEGORY_COEFFICIENTS[line.fiberCategory];
    const total = observation(line, 'fiberTotal');
    if (coefficient == null || !total) return null;
    const estimated = quantityEstimated || total.status === 'estimated_from_comparable';
    return {
        value: scalePerBasis(grams.g, total.value, 100) * coefficient,
        low: scalePerBasis(grams.gMin, total.low, 100) * coefficient,
        high: scalePerBasis(grams.gMax, total.high, 100) * coefficient,
        coefficient, status: estimated ? 'estimated' : 'calculated',
    };
}

function adjustedCarbs(nutrients, convention) {
    const carbs = nutrients.carbs;
    if (!carbs || carbs.value == null || !['includes_fiber', 'excludes_fiber'].includes(convention))
        return { value: null, status: 'unknown', incomplete: true };
    const fiber = convention === 'includes_fiber' ? nutrients.fiberTotal || nutrients.fiber : null;
    if (convention === 'includes_fiber' && (!fiber || fiber.value == null))
        return { value: null, status: 'unknown', incomplete: true };
    let value = carbs.value - (fiber?.value || 0);
    let low = (carbs.low ?? carbs.value) - (fiber?.high ?? fiber?.value ?? 0);
    let high = (carbs.high ?? carbs.value) - (fiber?.low ?? fiber?.value ?? 0);
    if (!nutrients.allulose || nutrients.allulose.value == null)
        return { value: null, status: 'unknown', incomplete: true };
    value -= nutrients.allulose.value;
    low -= nutrients.allulose.high ?? nutrients.allulose.value;
    high -= nutrients.allulose.low ?? nutrients.allulose.value;
    for (const [key, fraction] of Object.entries(POLYOL_COUNTED_FRACTIONS)) {
        const polyol = nutrients[key];
        if (!polyol || polyol.value == null) return { value: null, status: 'unknown', incomplete: true };
        const removed = (1 - fraction) * polyol.value;
        value -= removed;
        low -= (1 - fraction) * (polyol.high ?? polyol.value);
        high -= (1 - fraction) * (polyol.low ?? polyol.value);
    }
    if (nutrients.sugarAlcoholsTotal?.value != null) {
        const identified = Object.keys(POLYOL_COUNTED_FRACTIONS).reduce((sum, key) => sum + nutrients[key].value, 0);
        if (nutrients.sugarAlcoholsTotal.value - identified > 1e-6)
            return { value: null, status: 'unknown', incomplete: true };
    }
    if (value < 0 || low < 0) return { value: null, status: 'unknown', incomplete: true, negative: true };
    return { value, low, high, status: carbs.status === 'estimated' ? 'estimated' : 'calculated', incomplete: false };
}

function fodmap(nutrients) {
    const equate = (key, divisor) => {
        const item = nutrients[key];
        if (!item || item.value == null) return { value: null, status: 'unknown' };
        const round = value => Math.round(value / divisor * 10) / 10;
        return { value: round(item.value), low: round(item.low ?? item.value), high: round(item.high ?? item.value), status: item.status === 'unknown' ? 'unknown' : 'calculated' };
    };
    return {
        milkEquivalents: equate('lactose', 12),
        fructanScoops: equate('fructans', 3),
        gosScoops: equate('gos', 0.75),
    };
}

/**
 * Scale counted lines to a meal. Parents with children are omitted.
 * Unknown stays null. Derived metrics are computed here and are not read from profiles.
 */
export function calculateMeal(input = {}) {
    const lines = countedLines(input.lines || []);
    const nutrients = {};
    for (const key of STORED_KEYS) {
        const parts = [];
        let gramsKnown = 0;
        let ingredientsKnown = 0;
        for (const line of lines) {
            const grams = gramsOf(line);
            if (!grams) continue;
            const seen = observation(line, key);
            const estimated = line.quantityBasis === 'estimated' || seen?.status === 'estimated_from_comparable';
            if (!seen) {
                parts.push({ value: null, estimated, status: 'unknown' });
                continue;
            }
            const value = scalePerBasis(grams.g, seen.value, 100);
            parts.push({
                value, low: scalePerBasis(grams.gMin, seen.low, 100), high: scalePerBasis(grams.gMax, seen.high, 100),
                estimated, status: REPORTED.has(seen.status) ? 'reported' : seen.status,
            });
            gramsKnown += grams.g;
            ingredientsKnown += 1;
        }
        const known = parts.filter(part => part.value != null);
        const gramsTotal = lines.reduce((sum, line) => sum + (gramsOf(line)?.g || 0), 0);
        nutrients[key] = {
            value: known.length ? known.reduce((sum, part) => sum + part.value, 0) : null,
            low: known.length ? known.reduce((sum, part) => sum + part.low, 0) : null,
            high: known.length ? known.reduce((sum, part) => sum + part.high, 0) : null,
            status: rollup(parts),
            coverage: { gramsKnown, gramsTotal, ingredientsKnown, ingredientsTotal: lines.length },
        };
    }
    const fiberParts = [];
    for (const line of lines) {
        const grams = gramsOf(line);
        const weighted = grams && weightedFiber(line, grams);
        if (weighted) fiberParts.push(weighted);
    }
    nutrients.fiberWeightedLegacy = {
        value: fiberParts.length ? fiberParts.reduce((sum, part) => sum + part.value, 0) : null,
        low: fiberParts.length ? fiberParts.reduce((sum, part) => sum + part.low, 0) : null,
        high: fiberParts.length ? fiberParts.reduce((sum, part) => sum + part.high, 0) : null,
        status: fiberParts.some(part => part.status === 'estimated') ? 'estimated' : fiberParts.length ? 'calculated' : 'unknown',
        version: FIBER_WEIGHT_VERSION,
        coverage: { ingredientsKnown: fiberParts.length, ingredientsTotal: lines.length },
    };
    const mass = { rawG: 0, cookedG: 0, waterDeltaG: 0, fatAbsorbedG: 0, fatDiscardedG: 0 };
    for (const line of lines) {
        const basis = nutrientBasis(line);
        if (basis) addMass(mass, basis);
    }
    return {
        calculationVersion: CALCULATION_VERSION,
        countedLineIds: lines.map(line => line.lineId),
        nutrients,
        mass,
        adjustedCarbs: { ...adjustedCarbs(nutrients, input.carbConvention), version: ADJUSTED_CARB_VERSION },
        fodmapEquivalents: { ...fodmap(nutrients), version: FODMAP_EQUIVALENT_VERSION },
    };
}
