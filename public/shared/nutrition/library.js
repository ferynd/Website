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
    const active = cursor ? sources.filter(source => cursor[source.scope]) : sources;
    const pages = await Promise.all(active.map(async source => {
        try {
            const page = await source.search(query, { pageSize: size, cursor: cursor?.[source.scope] || null });
            const raw = page?.items || [];
            return { scope: source.scope, items: raw.slice(0, size), cursor: raw.length > size ? null : (page?.cursor || null), error: null };
        } catch {
            return { scope: source.scope, items: [], cursor: null, error: 'search_failed' };
        }
    }));
    const byVariant = new Map();
    for (const page of pages) {
        for (const item of page.items) {
            const id = item.variantId || item.ref?.variantId;
            if (!id) continue;
            const curatedId = page.scope === 'private' ? item.overrides?.variantId || item.ref?.overrides?.variantId : null;
            const key = curatedId || id;
            const existing = byVariant.get(key);
            if (existing?.scope === 'private' && page.scope !== 'private') continue;
            byVariant.set(key, { ...item, scope: page.scope, variantId: id });
        }
    }
    const items = [...byVariant.values()].sort((a, b) => String(a.canonicalName || '').localeCompare(String(b.canonicalName || '')) || String(a.variantId).localeCompare(String(b.variantId)));
    return {
        items,
        cursor: Object.fromEntries(sources.map(source => [source.scope, pages.find(page => page.scope === source.scope)?.cursor || null])),
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
    const missingConversions = conversions.some(item => item?.kind === 'household' || item?.unit === 'cup') ? [] : ['household'];
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
    const revision = (base?.revision || 0) + 1;
    const variantId = base?.variantId || patch.variantId || 'profile';
    const { contentHash: _oldHash, revisionId: _oldRevisionId, ...rest } = base || {};
    const quality = { ...(base?.nutrientMeta?.quality || {}) };
    for (const key of Object.keys(patch.nutrients || {}))
        if (!quality[key]) quality[key] = { status: 'measured' };
    return {
        ok: true,
        writes: false,
        staged: true,
        committed: false,
        diaryUntouched: true,
        draft: {
            ...rest,
            ownerUid,
            variantId,
            nutrients,
            nutrientMeta: { ...(base?.nutrientMeta || {}), quality },
            revision,
            revisionId: `${variantId}~r${revision}`,
            supersedes: base?.revision ? { revision: base.revision, ...(base.revisionId ? { revisionId: base.revisionId } : {}), ...(base.contentHash ? { contentHash: base.contentHash } : {}) } : null,
            source: patch.source || base?.sources || null,
            basis: patch.basis || base?.basis || { kind: 'per_100g_edible', state: 'unspecified' },
        },
    };
}

export function commitLibraryEdit() {
    return { ok: false, error: 'writes_disabled', writes: INGREDIENT_STORE_WRITES_ENABLED, committed: false, diaryUntouched: true };
}

/** Research selected fields through the shared #62 packet. Nothing is saved. */
export async function researchLibraryFields({ lineId = null, name = 'ingredient', missingFields = [], revisionsByLine = {}, ref = null, ownerUid = null, namespace = null } = {}) {
    const id = lineId || String(name || 'profile').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'profile';
    let resolution = buildResolution({
        lines: [{ lineId: id, name, grams: 100, quantityBasis: 'estimated', variant: {} }],
        matches: [{ lineId: id, outcome: ref ? 'exact' : 'missing', ref }],
        revisionsByLine,
    });
    const lookup = lookupOfficial(resolution, id, { outcome: 'not_found', unresolvedFields: missingFields });
    if (!lookup.ok) return { ok: false, error: lookup.error, modelCalls: 0 };
    resolution = lookup.state;
    const packet = await researchPacket(resolution, [id], { ...(ownerUid ? { ownerUid } : {}), ...(namespace ? { namespace } : {}) });
    return packet.ok ? { ...packet, modelCalls: 0, writes: false, staged: true } : { ...packet, modelCalls: 0, writes: false };
}
