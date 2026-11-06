import type { VariantDims } from './ingredientVariants';
export const INGREDIENT_COLLECTIONS: Readonly<{
    identities: 'ingredientIdentities';
    variants: 'ingredientVariants';
    revisions: 'ingredientRevisions';
    conversions: 'ingredientConversions';
}>;
export const CURATED_CATALOG_ID: 'nutrition-curated';
export interface IdentityInput {
    canonicalName: string;
    category: string;
    kind: string;
    aliases?: Array<{
        text: string;
        kind: 'confirmed' | 'search';
    }>;
}
export function normalizeIdentityName(name: string): string;
export function identityKeyV1(identity: IdentityInput): string;
export function variantKeyV1(dims: Partial<VariantDims>): string;
export function privateIdentityId(identity: IdentityInput | string): Promise<string>;
export function privateVariantId(identityId: string, dims: Partial<VariantDims>): Promise<string>;
export function overrideVariantId(catalogId: string, variantId: string): Promise<string>;
export function revisionIdFor(variantId: string, n: number): string;
export function conversionIdFor(content: unknown): Promise<string>;
export function isValidFirestoreDocId(id: unknown): id is string;
export function buildSearchTokens(name: string, aliases?: Array<string | {
    text: string;
}>): string[];
