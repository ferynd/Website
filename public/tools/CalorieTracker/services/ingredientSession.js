import { clearProfileCache } from '../../../shared/nutrition/profileCache.js';
export async function onIngredientAuthChange(prevUid, nextUid, clear = clearProfileCache) {
    if (!nextUid || prevUid !== nextUid)
        await clear();
}
