export const CALCULATION_VERSION: 2;
export const FIBER_WEIGHT_VERSION: 1;
export const ADJUSTED_CARB_VERSION: 1;
export const FODMAP_EQUIVALENT_VERSION: 1;
export const RESISTANT_STARCH_COEFFICIENT: number;
export const FIBER_CATEGORY_COEFFICIENTS: Readonly<Record<string, number>>;
export const FIBER_SUBTYPE_COEFFICIENTS: Readonly<Record<string, number>>;
export const POLYOL_COUNTED_FRACTIONS: Readonly<Record<string, number>>;
export function scalePerBasis(quantityGrams: number, amountPerBasis: number | null, basisGrams: number): number | null;
/** Every line except a compound parent that has children. */
export function countedLines<T extends { lineId?: string; parentLineId?: string | null }>(lines: T[]): T[];
export interface NutrientBasisLine {
    grams?: number | null;
    gMin?: number | null;
    gMax?: number | null;
    yieldRetention?: number | null;
    waterDeltaG?: number | null;
    fatAbsorbedG?: number | null;
    fatDiscardedG?: number | null;
    fatAbsorbedExternal?: boolean | null;
}
export interface NutrientBasis {
    g: number | null;
    gMin: number | null;
    gMax: number | null;
    rawG: number;
    cookedG: number;
    waterDeltaG: number;
    fatAbsorbedG: number;
    fatDiscardedG: number;
    retention: number;
}
/** Null when grams are missing or negative, or the retention is invalid. */
export function nutrientBasis(line: NutrientBasisLine): NutrientBasis | null;
export function calculateMeal(input?: { lines?: any[]; carbConvention?: string }): any;
