import type { NutrientKey } from '../nutrientRegistry';
export type FdcMappingPolicy = 'exact' | 'convert' | 'gap';
export interface FdcNutrientMapping {
    readonly fdcNutrientId: number;
    readonly nutrientNumber: string;
    readonly key: NutrientKey;
    readonly sourceUnit: string;
    readonly policy: FdcMappingPolicy;
    readonly gapReason?: string;
    readonly note?: string;
}
export declare const ENERGY_PREFERENCE_ORDER: readonly number[];
export declare const FDC_NUTRIENT_ENTRIES: readonly FdcNutrientMapping[];
export declare function getFdcMapping(fdcNutrientId: number): FdcNutrientMapping | null;
export declare function getFdcMappingByNumber(nutrientNumber: string): FdcNutrientMapping | null;
export declare function validateFdcNutrientMappings(): string[];
