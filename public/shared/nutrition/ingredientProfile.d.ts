import type { StagedNutrientRecord, NutrientKey, NutrientQuality } from './nutrientRegistry';
export interface SourceRecord {
    type: 'fdc' | 'label' | 'manufacturer' | 'manual' | 'comparable' | 'legacy_food' | 'curated_catalog';
    datasetId?: string;
    recordId?: string;
    title?: string;
    url?: string;
    version?: string;
    publishedAt?: string;
    accessedAt?: string;
    originalBasis?: string;
    permittedUse?: string;
    checksum?: string;
}
export interface FieldProvenance {
    sourceKey: string;
    sourceNutrientId?: string;
    derivation?: string;
    comparatorRef?: string;
    confidence?: number;
    range?: {
        min: number;
        max: number;
    };
}
export interface RevisionDraft {
    schemaVersion: 1;
    identityId: string;
    variantId: string;
    basis: {
        kind: 'per_100g_edible';
        state: string;
    };
    nutrients: Partial<Record<NutrientKey, number | null>>;
    nutrientMeta: {
        registryVersion: 2;
        quality: Partial<Record<NutrientKey, NutrientQuality>>;
        fiberMeaning?: string;
        carbConvention?: string;
    };
    fieldProvenance: Partial<Record<NutrientKey, FieldProvenance>>;
    sources: Record<string, SourceRecord>;
    basedOn: unknown;
    supersedes: {
        revision: number;
        revisionId: string;
        contentHash: string;
    } | null;
    contentHash: string;
}
export interface IngredientRevision extends RevisionDraft {
    ownerUid: string;
    revision: number;
    revisionId: string;
    idempotencyKey: string;
    createdAt: unknown;
}
export function buildRevisionDraft(input: {
    identityId: string;
    variantId: string;
    stagedRecord: StagedNutrientRecord;
    fieldProvenance?: RevisionDraft['fieldProvenance'];
    sources?: RevisionDraft['sources'];
    basis: RevisionDraft['basis'];
    basedOn?: unknown;
    base?: IngredientRevision | null;
}): Promise<RevisionDraft>;
export function validateRevision(doc: unknown): string[];
export function revisionToStagedRecord(doc: RevisionDraft): StagedNutrientRecord;
export function verifyRevisionHash(doc: unknown): Promise<boolean>;
export function legacyFoodAsProfile(foodDoc: unknown, foodId: string, namespace: string): {
    foodId: string;
    namespace: string;
    basis: {
        kind: 'legacy_per_unit';
        state: string;
    };
    stagedRecord: StagedNutrientRecord;
};
