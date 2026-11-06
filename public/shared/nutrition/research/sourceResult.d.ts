import type { ProfileNutrientKey } from './profileFields';
import type { NutrientQuality, FiberMeaning, CarbConvention } from '../nutrientRegistry';
import type { SourceRecord, FieldProvenance } from '../ingredientProfile';
import type { VariantDims } from '../ingredientVariants';
import type { FdcSourceResult } from './fdcFood';
export declare const GAP_REASONS: readonly string[];
export interface NormalizationTarget {
    targetKind?: 'catalog' | 'private';
    manifestId?: string;
    identityId?: string;
    variantId?: string;
    variantRef?: any;
    dims?: VariantDims;
    baseRef?: any;
    requestedFields?: ProfileNutrientKey[] | '*';
}
export interface NormalizedProposal {
    sourceKey: string;
    sourceRecord: SourceRecord;
    sources: Record<string, SourceRecord>;
    nutrients: Record<ProfileNutrientKey, number | null>;
    nutrientMeta: {
        registryVersion: 2;
        quality: Record<ProfileNutrientKey, NutrientQuality>;
        fiberMeaning?: FiberMeaning;
        carbConvention?: CarbConvention;
    };
    fieldProvenance: Partial<Record<ProfileNutrientKey, FieldProvenance>>;
    conversions: any[];
    gaps: Partial<Record<ProfileNutrientKey, string>>;
    flags: string[];
    extractedStateWords: string[];
}
export declare function normalizeSourceResult(result: FdcSourceResult | any, target?: NormalizationTarget): NormalizedProposal;
