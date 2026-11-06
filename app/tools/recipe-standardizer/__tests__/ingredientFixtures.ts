import { emptyStagedRecord } from '@/public/shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft, type IngredientRevision } from '@/public/shared/nutrition/ingredientProfile.js';
import type { IngredientProfileRef } from '@/public/shared/nutrition/ingredientRefs.js';
import type { ResolvedIngredientProfile } from '@/public/shared/nutrition/ingredientStore.js';
export async function ingredientFixture() {
    const stagedRecord = emptyStagedRecord();
    stagedRecord.values.protein = 10;
    stagedRecord.quality.protein = { status: 'measured' };
    const draft = await buildRevisionDraft({ identityId: 'chicken', variantId: 'chicken-raw', stagedRecord, basis: { kind: 'per_100g_edible', state: 'raw' }, sources: { test: { type: 'manual' } }, fieldProvenance: { protein: { sourceKey: 'test' } } });
    const revision: IngredientRevision = { ...draft, ownerUid: 'owner', revision: 1, revisionId: 'chicken-raw~r1', idempotencyKey: 'test', createdAt: 0 };
    const ref: IngredientProfileRef = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: 'chicken', variantId: 'chicken-raw', revision: 1, revisionId: revision.revisionId, contentHash: draft.contentHash };
    const resolved: ResolvedIngredientProfile = { status: 'fresh', ref, revision };
    return { ref, revision, resolved };
}
