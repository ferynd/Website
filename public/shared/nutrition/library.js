import { INGREDIENT_STORE_WRITES_ENABLED } from './capabilities.js';
import { PROFILE_FIELDS } from './research/profileFields.js';
import { buildResolution, lookupOfficial, researchPacket } from './resolution.js';

/** Library reads and stages. Private production writes stay on the ingredient-store flag. */
export function libraryCapabilities() {
    return Object.freeze({
        affectedMeals: false,
        curatedWrites: false,
        privateWrites: INGREDIENT_STORE_WRITES_ENABLED,
        directAi: false,
    });
}

function pageSizeOf(pageSize) {
    const size = Math.floor(pageSize || 25);
    return Math.max(1, Math.min(25, size));
}

/** Merge private and curated search pages. A private hit wins over the same variant. */
export async function searchLibrary({ query = '', sources = [], pageSize = 25, cursor = null } = {}) {
    const size = pageSizeOf(pageSize);
    const pages = await Promise.all(sources.map(async source => {
        try {
            const page = await source.search(query, { pageSize: size, cursor: cursor?.[source.scope] || null });
            return { scope: source.scope, items: page?.items || [], cursor: page?.cursor || null, error: null };
        } catch {
            return { scope: source.scope, items: [], cursor: null, error: 'search_failed' };
        }
    }));
    const byVariant = new Map();
    for (const page of pages) {
        for (const item of page.items) {
            const id = item.variantId || item.ref?.variantId;
            if (!id) continue;
            const existing = byVariant.get(id);
            if (!existing || page.scope === 'private') byVariant.set(id, { ...item, scope: page.scope, variantId: id });
        }
    }
    const items = [...byVariant.values()].sort((a, b) => String(a.canonicalName || '').localeCompare(String(b.canonicalName || '')) || String(a.variantId).localeCompare(String(b.variantId))).slice(0, size);
    return {
        items,
        cursor: Object.fromEntries(pages.map(page => [page.scope, page.cursor])),
        errors: pages.filter(page => page.error).map(page => page.scope),
        modelCalls: 0,
    };
}

/** Missing fields and missing conversions stay separate. Curated profiles are read-only. */
export function reviewLibraryProfile({ revision = null, conversions = [], scope = 'private', ownerUid = null, viewerUid = null } = {}) {
    if (scope === 'private' && ownerUid && viewerUid && ownerUid !== viewerUid) return { ok: false, error: 'owner_mismatch', writes: false };
    const nutrients = revision?.nutrients || {};
    const quality = revision?.nutrientMeta?.quality || {};
    const missingFields = PROFILE_FIELDS.filter(key => quality[key]?.status === 'not_applicable' ? false : nutrients[key] == null);
    const missingConversions = conversions.length ? [] : ['household'];
    return {
        ok: true,
        missingFields,
        missingConversions,
        provenance: revision?.fieldProvenance || {},
        revision: revision?.revision || null,
        readOnly: scope !== 'private',
        affectedMeals: { available: false, reason: 'affected meals need ingredient-graph references from #64 Part B' },
        writes: false,
        diaryUntouched: true,
        modelCalls: 0,
    };
}

export function filterLibraryGaps(rows = [], kind = 'all') {
    if (kind === 'fields') return rows.filter(row => row.missingFields?.length);
    if (kind === 'conversions') return rows.filter(row => row.missingConversions?.length);
    return [...rows];
}

/** A private edit is a new staged revision. It does not write and does not touch diary snapshots. */
export function stageLibraryEdit({ scope = 'private', ownerUid, viewerUid, base = null, patch = {} } = {}) {
    if (scope !== 'private') return { ok: false, error: 'curated_read_only', writes: false, diaryUntouched: true };
    if (!viewerUid || viewerUid !== ownerUid) return { ok: false, error: 'owner_mismatch', writes: false, diaryUntouched: true };
    const nutrients = { ...(base?.nutrients || {}), ...(patch.nutrients || {}) };
    return {
        ok: true,
        writes: false,
        staged: true,
        committed: false,
        diaryUntouched: true,
        draft: {
            ...(base || {}),
            ownerUid,
            nutrients,
            revision: (base?.revision || 0) + 1,
            supersedes: base?.revision ? { revision: base.revision, contentHash: base.contentHash || null } : null,
            source: patch.source || base?.sources || null,
            basis: patch.basis || base?.basis || { kind: 'per_100g_edible', state: 'unspecified' },
        },
    };
}

export function commitLibraryEdit() {
    return { ok: false, error: 'writes_disabled', writes: INGREDIENT_STORE_WRITES_ENABLED, committed: false, diaryUntouched: true };
}

/** Research selected fields through the shared #62 packet. Nothing is saved. */
export async function researchLibraryFields({ lineId = 'profile', name = 'ingredient', missingFields = [], revisionsByLine = {}, ref = null } = {}) {
    let resolution = buildResolution({
        lines: [{ lineId, name, grams: 100, quantityBasis: 'estimated', variant: {} }],
        matches: [{ lineId, outcome: ref ? 'exact' : 'missing', ref }],
        revisionsByLine,
    });
    const lookup = lookupOfficial(resolution, lineId, { outcome: 'not_found', unresolvedFields: missingFields });
    if (!lookup.ok) return { ok: false, error: lookup.error, modelCalls: 0 };
    resolution = lookup.state;
    const packet = await researchPacket(resolution, [lineId]);
    return packet.ok ? { ...packet, modelCalls: 0, writes: false, staged: true } : { ...packet, modelCalls: 0, writes: false };
}
