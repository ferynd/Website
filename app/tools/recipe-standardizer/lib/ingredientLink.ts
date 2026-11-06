import { INGREDIENT_STORE_WRITES_ENABLED } from '@/public/shared/nutrition/capabilities.js';
import { IngredientWritesDisabledError, type ResolvedIngredientProfile } from '@/public/shared/nutrition/ingredientStore.js';
import { refCacheKey, sameRef, type IngredientProfileRef } from '@/public/shared/nutrition/ingredientRefs.js';
import type { NutrientKey } from '@/public/shared/nutrition/nutrientRegistry.js';
import { UNLINKED_NUTRITION, type NutritionLink } from './types';
import type { LinkAssessment } from './nutritionLink';
export type ProfilesState = Map<string, ResolvedIngredientProfile>;
export function confirmIngredientProfileLink(ref: IngredientProfileRef, nowMs: number, previous: NutritionLink): NutritionLink {
    if (!INGREDIENT_STORE_WRITES_ENABLED)
        throw new IngredientWritesDisabledError('Ingredient profile confirmation is disabled');
    return { ...UNLINKED_NUTRITION, matchedName: previous.matchedName, status: 'confirmed', needsUserReview: false, ingredientRef: ref, confirmedAtMs: nowMs };
}
export function assessIngredientLink(ref: IngredientProfileRef, profiles?: ProfilesState): LinkAssessment {
    const result = profiles?.get(refCacheKey(ref));
    const state = !profiles ? 'profile-unavailable' : !result || result.status === 'missing' ? 'profile-missing' : result.status === 'corrupt' ? 'profile-corrupt' : result.status === 'stale' ? 'profile-unavailable' : !result.revision || !sameRef(ref, result.ref) || result.revision.contentHash !== ref.contentHash ? 'profile-corrupt' : result.newerAvailable ? 'profile-newer-available' : 'confirmed-profile';
    return { state, food: null, currentName: null, profile: result };
}
export function profileContribution(result: ResolvedIngredientProfile | undefined, grams: number, key: NutrientKey): number | null {
    if (!result?.revision || result.status !== 'fresh' || !Number.isFinite(grams) || grams <= 0)
        return null;
    const value = result.revision.nutrients[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return null;
    const contribution = grams / 100 * value;
    return Number.isFinite(contribution) ? contribution : null;
}
