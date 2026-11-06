export interface IngredientProfileRef {
    refVersion: 1;
    scope: 'private' | 'curated';
    namespace: string;
    identityId: string;
    variantId: string;
    revision: number;
    revisionId: string;
    contentHash: string;
}
export interface CuratedVariantRef {
    catalogId: 'nutrition-curated';
    variantId: string;
    revision: number;
}
export function parseIngredientRef(raw: unknown, path?: string, warnings?: string[]): IngredientProfileRef | null;
export function refCacheKey(ref: IngredientProfileRef): string;
export function sameRef(a: IngredientProfileRef | null, b: IngredientProfileRef | null): boolean;
