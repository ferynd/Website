import { createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
import { filterLibraryGaps, libraryCapabilities, researchLibraryFields, reviewLibraryProfile, searchLibrary } from '../../../shared/nutrition/library.js';
import { getIngredientStore } from '../services/ingredientStore.js';

const text = (node, value) => { if (node) node.textContent = value == null ? '' : String(value); };

function row(parent, value) {
    const node = document.createElement('p');
    node.textContent = value;
    parent.append(node);
}

async function sources() {
    const list = [];
    try {
        const catalog = createCuratedCatalogSource();
        await catalog.open();
        list.push({ scope: 'curated', search: (query, page) => catalog.search(query, page) });
    } catch { /* The curated catalog can be absent offline. */ }
    try {
        const store = await getIngredientStore();
        list.push({ scope: 'private', search: (query, page) => store.searchPrivate(query, page), close: () => store.close() });
    } catch { /* Signed-out search still shows the curated page. */ }
    return list;
}

/** Tracker library tab. Values are text. Profile writes stay off. */
export function wireLibrary(getUid) {
    let rows = [];
    let cursor = null;
    let selected = null;
    const output = () => document.getElementById('library-output');
    const render = (items) => {
        const node = output();
        if (!node) return;
        node.replaceChildren();
        const caps = libraryCapabilities();
        text(document.getElementById('library-capability'), `Library on · private writes ${caps.privateWrites ? 'on' : 'off'} · affected meals off`);
        const kind = document.getElementById('library-filter')?.value || 'all';
        for (const item of filterLibraryGaps(items, kind)) {
            row(node, `${item.canonicalName || item.name || item.lineId} · ${item.scope || 'review'} · ${item.variantId || ''}`);
            if (item.missingFields) row(node, `Missing fields: ${item.missingFields.length}`);
            if (item.missingConversions) row(node, `Missing conversions: ${item.missingConversions.join(', ') || 'none'}`);
            if (item.revision) row(node, `Revision: ${item.revision}`);
            if (item.provenance && Object.keys(item.provenance).length) row(node, `Provenance: ${Object.entries(item.provenance).map(([key, value]) => `${key} ${value?.sourceKey || ''}`.trim()).join('; ')}`);
            if (item.conversions?.length) row(node, `Conversions: ${item.conversions.map(conversion => [conversion.kind, conversion.unit, conversion.grams].filter(part => part != null && part !== '').join(' ')).join('; ')}`);
            if (item.ref) {
                const choose = document.createElement('button');
                choose.type = 'button';
                choose.className = 'btn btn-secondary btn-sm';
                choose.textContent = selected === item ? `Selected ${item.canonicalName || item.variantId}` : `Select ${item.canonicalName || item.variantId}`;
                choose.addEventListener('click', () => { selected = item; text(document.getElementById('library-message'), `Selected ${item.canonicalName || item.variantId}`); render(rows); });
                node.append(choose);
            }
        }
    };
    let packetState = null;
    const runSearch = async (nextCursor) => {
        if (nextCursor && !Object.values(nextCursor).some(Boolean)) {
            text(document.getElementById('library-message'), 'No more results');
            return;
        }
        const list = await sources();
        let found;
        try {
            found = await searchLibrary({ query: document.getElementById('library-query')?.value || '', sources: list, pageSize: 25, cursor: nextCursor });
        } finally {
            for (const source of list) source.close?.();
        }
        cursor = found.cursor;
        const merged = new Map();
        for (const item of [...(nextCursor ? rows : []), ...found.items]) {
            const key = item.overrides?.variantId || item.variantId;
            const existing = merged.get(key);
            if (existing?.scope === 'private' && item.scope !== 'private') continue;
            merged.set(key, item);
        }
        rows = [...merged.values()];
        if (!nextCursor) selected = null;
        render(rows);
        text(document.getElementById('library-message'), found.errors.length ? `Search failed for ${found.errors.join(', ')}` : `${rows.length} results`);
    };
    document.getElementById('library-search')?.addEventListener('click', () => runSearch(null));
    document.getElementById('library-more')?.addEventListener('click', () => runSearch(cursor));
    document.getElementById('library-filter')?.addEventListener('change', () => render(rows));
    document.getElementById('library-review')?.addEventListener('click', async () => {
        const item = selected?.ref ? selected : null;
        if (!item) { text(document.getElementById('library-message'), 'Search and choose a profile first.'); return; }
        let revision = null;
        let conversions = [];
        try {
            const store = await getIngredientStore();
            try {
                revision = (await store.resolveRef(item.ref))?.revision || null;
                conversions = await store.getConversions(item.ref);
            } finally { store.close(); }
        } catch { /* Review still reports the gap when the profile cannot be read. */ }
        const review = reviewLibraryProfile({ revision, conversions, scope: item.scope || 'curated', ownerUid: item.ref?.ownerUid || null, viewerUid: getUid() });
        const updated = { ...item, ...review, conversions };
        rows = rows.map(row => row === item ? updated : row);
        selected = updated;
        render(rows.filter(row => row.ref || row.missingFields));
    });
    document.getElementById('library-research')?.addEventListener('click', async () => {
        const uid = getUid();
        if (!uid) { text(document.getElementById('library-message'), 'Sign in to research a private profile.'); return; }
        const name = selected?.canonicalName || document.getElementById('library-query')?.value || 'ingredient';
        const packet = await researchLibraryFields({ name, ownerUid: uid });
        packetState = packet.state || null;
        const box = document.getElementById('library-copy');
        if (box) box.value = packet.copyText || '';
        text(document.getElementById('library-message'), packet.ok ? 'Research packet copied below. It is not saved.' : packet.error);
    });
    document.getElementById('library-apply')?.addEventListener('click', async () => {
        if (!packetState) { text(document.getElementById('library-message'), 'Copy a research packet before applying a response.'); return; }
        const { applyResearchResponse } = await import('../../../shared/nutrition/importWorkspace.js');
        const applied = await applyResearchResponse({ resolution: packetState }, document.getElementById('library-response')?.value || '');
        if (applied.ok) packetState = applied.workspace.resolution;
        const staged = applied.workspace?.resolution?.items?.flatMap(item => Object.keys(item.nutrients || {})) || [];
        text(document.getElementById('library-message'), applied.ok ? `Response staged for review (${staged.join(', ') || 'no nutrient keys'}). It is not saved.` : (applied.error || 'invalid response'));
    });
}
