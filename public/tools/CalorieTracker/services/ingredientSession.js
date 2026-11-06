import { clearProfileCache } from '../../../shared/nutrition/profileCache.js';
export async function onIngredientAuthChange(prevUid, nextUid, clear = clearProfileCache) {
    if (!nextUid || (prevUid && prevUid !== nextUid)) {
        try { await clear(); } catch { /* Cache availability must not block auth. */ }
    }
}
