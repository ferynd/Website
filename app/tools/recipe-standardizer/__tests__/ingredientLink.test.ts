import { expect, it } from 'vitest';
import { assessIngredientLink, confirmIngredientProfileLink, profileContribution } from '../lib/ingredientLink';
import { IngredientWritesDisabledError } from '@/public/shared/nutrition/ingredientStore.js';
import { refCacheKey } from '@/public/shared/nutrition/ingredientRefs.js';
import { UNLINKED_NUTRITION } from '../lib/types';
import { ingredientFixture } from './ingredientFixtures';
it('blocks confirmation while writes are off', async () => {
    const { ref } = await ingredientFixture();
    expect(() => confirmIngredientProfileLink(ref, 10, UNLINKED_NUTRITION)).toThrow(IngredientWritesDisabledError);
});
it('assesses all profile states and preserves unknown as null', async () => {
    const { ref, resolved } = await ingredientFixture();
    expect(assessIngredientLink(ref).state).toBe('profile-unavailable');
    expect(assessIngredientLink(ref, new Map()).state).toBe('profile-missing');
    for (const [status, state] of [['corrupt', 'profile-corrupt'], ['stale', 'profile-unavailable'], ['missing', 'profile-missing'], ['fresh', 'confirmed-profile']] as const) {
        expect(assessIngredientLink(ref, new Map([[refCacheKey(ref), { ...resolved, status }]])).state).toBe(state);
    }
    expect(assessIngredientLink(ref, new Map([[refCacheKey(ref), { ...resolved, newerAvailable: true }]])).state).toBe('profile-newer-available');
    expect(profileContribution(resolved, 50, 'protein')).toBe(5);
    expect(profileContribution(resolved, 50, 'calories')).toBeNull();
});
