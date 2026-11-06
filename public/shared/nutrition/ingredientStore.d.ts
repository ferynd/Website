import type { IngredientFirestorePort } from './ingredientPort';
import type { IngredientProfileRef } from './ingredientRefs';
import type { IngredientRevision, RevisionDraft } from './ingredientProfile';
import type { IngredientConversion } from './ingredientConversion';
import type { IdentityInput } from './ingredientIds';
import type { VariantDims } from './ingredientVariants';
import type { ProfileCache } from './profileCache';
import type { CuratedCatalogSource } from './ingredientCatalog';
export class IdentityKeyCollisionError extends Error {
}
export class RevisionConflictError extends Error {
}
export class IngredientWritesDisabledError extends Error {
}
export class NeedsReviewError extends Error {
}
export interface ResolvedIngredientProfile {
    status: 'fresh' | 'stale' | 'missing' | 'corrupt';
    ref: IngredientProfileRef;
    revision?: IngredientRevision;
    newerAvailable?: boolean;
}
export interface CreateIngredientInput {
    identity: IdentityInput;
    variant: {
        dims: Partial<VariantDims>;
        overrides?: {
            catalogId: string;
            variantId: string;
            revision: number;
        } | null;
    };
    revisionDraft: RevisionDraft;
    conversions?: IngredientConversion[];
    confirmNew?: boolean;
    idempotencyKey?: string;
}
export interface SaveRevisionInput {
    variantId: string;
    baseRevision: number;
    revisionDraft: RevisionDraft;
}
export function createIngredientStore(options: {
    port: IngredientFirestorePort;
    namespace: string;
    ownerUid: string;
    cache?: ProfileCache;
    catalog?: CuratedCatalogSource;
    now?: () => number;
}): {
    close(): void;
    searchPrivate(q: string, options?: {
        pageSize?: number;
        cursor?: string;
    }): Promise<{
        items: Array<Record<string, any>>;
        cursor: string | null;
    }>;
    getIdentity(id: string): Promise<Record<string, any> | null>;
    listVariants(identityId: string): Promise<Array<Record<string, any>>>;
    resolveRef(ref: IngredientProfileRef): Promise<ResolvedIngredientProfile>;
    resolveEffectiveProfile(ref: IngredientProfileRef): Promise<ResolvedIngredientProfile>;
    createIngredient(payload: CreateIngredientInput): Promise<IngredientProfileRef>;
    saveRevision(payload: SaveRevisionInput): Promise<IngredientProfileRef>;
    addConversion(conversion: IngredientConversion): Promise<IngredientConversion>;
    updateIdentity(id: string, patch: Record<string, unknown>): Promise<void>;
    retireVariant(id: string): Promise<void>;
    listPendingSaves(): Promise<any[]>;
    retirePendingSave(key: string): Promise<void>;
    retryPendingSave(key: string, replacement?: any): Promise<IngredientProfileRef>;
};
export type IngredientStore = ReturnType<typeof createIngredientStore>;
