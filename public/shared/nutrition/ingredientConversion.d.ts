import type { IngredientProfileRef } from './ingredientRefs';
import type { SourceRecord } from './ingredientProfile';
export interface IngredientConversion {
    schemaVersion: 1;
    conversionId: string;
    variantRef: IngredientProfileRef;
    kind: 'household' | 'density' | 'piece' | 'package';
    unit: string;
    unitQualifier?: string;
    amount: number;
    grams?: number;
    gramsPerMl?: number;
    state: string;
    source: SourceRecord;
    confidence: number;
    range?: {
        min: number;
        max: number;
    };
    supersedes?: string | null;
    ownerUid?: string;
    createdAt?: unknown;
}
export function validateConversion(doc: unknown): string[];
export function buildConversion(input: Omit<IngredientConversion, 'schemaVersion' | 'conversionId'>): Promise<IngredientConversion>;
export function toGrams(quantity: number, unit: string, qualifier: string | null, conversions: IngredientConversion[], state: string): {
    grams: number;
    conversionId: string | null;
} | {
    error: 'missing_conversion' | 'state_mismatch';
};
