import { clearResearchJobs } from '../../../shared/nutrition/research/indexedDbResearchStore.js';
import { clearProfileCache } from '../../../shared/nutrition/profileCache.js';
export async function onIngredientAuthChange(prevUid, nextUid, clear = clearProfileCache, clearJobs = clearResearchJobs) {
    if (!nextUid || (prevUid && prevUid !== nextUid)) {
        try { await clearJobs(); } catch { /* Cache availability must not block auth. */ }
        try { await clear(); } catch { /* Cache availability must not block auth. */ }
    }
}
