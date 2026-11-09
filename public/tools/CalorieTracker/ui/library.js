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
        list.push({ scope: 'private', search: async (query, page) => {
            try { return await store.searchPrivate(query, page); }
            catch { return { items: [], cursor: null }; }
        } });
    } catch { /* Signed-out search still shows the curated page. */ }
    return list;
}

/** Tracker library tab. Values are text. Profile writes stay off. */
export function wireLibrary(getUid) {
    let rows = [];
    let cursor = null;
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
        }
    };
    const runSearch = async (nextCursor) => {
        if (nextCursor && !Object.values(nextCursor).some(Boolean)) {
            text(document.getElementById('library-message'), 'No more results');
            return;
        }
        const found = await searchLibrary({ query: document.getElementById('library-query')?.value || '', sources: await sources(), pageSize: 25, cursor: nextCursor });
        cursor = found.cursor;
        const merged = new Map();
        for (const item of [...(nextCursor ? rows : []), ...found.items]) {
            const key = item.overrides?.variantId || item.variantId;
            const existing = merged.get(key);
            if (existing?.scope === 'private' && item.scope !== 'private') continue;
            merged.set(key, item);
        }
        rows = [...merged.values()];
        render(rows);
        text(document.getElementById('library-message'), found.errors.length ? `Search failed for ${found.errors.join(', ')}` : `${rows.length} results`);
    };
    document.getElementById('library-search')?.addEventListener('click', () => runSearch(null));
    document.getElementById('library-more')?.addEventListener('click', () => runSearch(cursor));
    document.getElementById('library-filter')?.addEventListener('change', () => render(rows));
    document.getElementById('library-review')?.addEventListener('click', () => {
        const review = reviewLibraryProfile({ revision: null, conversions: [], scope: 'curated' });
        rows = [{ name: 'Selected profile', scope: 'curated', ...review }];
        render(rows);
    });
    document.getElementById('library-research')?.addEventListener('click', async () => {
        const uid = getUid();
        if (!uid) { text(document.getElementById('library-message'), 'Sign in to research a private profile.'); return; }
        const packet = await researchLibraryFields({ name: document.getElementById('library-query')?.value || 'ingredient' });
        const box = document.getElementById('library-copy');
        if (box) box.value = packet.copyText || '';
        text(document.getElementById('library-message'), packet.ok ? 'Research packet copied below. It is not saved.' : packet.error);
    });
}
