import { normalizeIdentityName } from './ingredientIds.js';
import { compareVariants } from './ingredientVariants.js';
export function rankCandidates(input, candidates) {
    return candidates.map(c => ({ ...c, compatibility: compareVariants(input.dims ?? {}, c.dims ?? {}), score: normalizeIdentityName(c.canonicalName ?? '') === normalizeIdentityName(input.name ?? '') ? 1 : 0.5 })).sort((a, b) => b.score - a.score || String(a.variantId).localeCompare(String(b.variantId)));
}
export async function matchIngredient(input, { privateSearch, curatedSearch, confirmedRefs = [] }) {
    if (input.ref && confirmedRefs.some(r => r.contentHash === input.ref.contentHash && r.variantId === input.ref.variantId && r.namespace === input.ref.namespace && r.revision === input.ref.revision))
        return { kind: 'exact', ref: input.ref };
    const groups = await Promise.all([privateSearch(input.name), curatedSearch(input.name)]);
    const candidates = rankCandidates(input, groups.flatMap(g => g.items ?? g));
    const exact = candidates.filter(c => c.ref && c.compatibility === 'exact' && c.aliases?.some(a => a.kind === 'confirmed' && normalizeIdentityName(a.text) === normalizeIdentityName(input.name)));
    return exact.length === 1 ? { kind: 'exact', ref: exact[0].ref } : { kind: 'candidates', needsReview: true, candidates };
}
