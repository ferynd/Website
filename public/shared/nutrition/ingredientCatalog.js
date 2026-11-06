import { contentHashOf } from './contentHash.js';
import { CURATED_CATALOG_ID, normalizeIdentityName, buildSearchTokens } from './ingredientIds.js';
const ROOT = '/shared/nutrition/catalog/' + CURATED_CATALOG_ID + '/';
const bucket = s => normalizeIdentityName(s).slice(0, 2).padEnd(2, '_').replace(/[^a-z0-9_-]/g, '_');
export async function buildCatalogShards(records) {
    const files = {}, search = {}, variants = {};
    for (const record of records) {
        const b = bucket(record.variant.variantId);
        (variants[b] ??= []).push(record);
        for (const token of buildSearchTokens(record.identity.canonicalName, record.identity.aliases))
            (search[bucket(token)] ??= new Map()).set(record.variant.variantId, { ...record.identity, ...record.variant, searchTokens: buildSearchTokens(record.identity.canonicalName, record.identity.aliases) });
    }
    const manifest = { schemaVersion: 1, catalogId: CURATED_CATALOG_ID, profileCount: records.length, searchShards: {}, variantShards: {} };
    for (const [kind, groups] of [['search', search], ['variants', variants]]) {
        for (const [b, items] of Object.entries(groups)) {
            const data = (items instanceof Map ? [...items.values()] : items).sort((a, b) => String(a.variantId ?? a.variant.variantId).localeCompare(String(b.variantId ?? b.variant.variantId)));
            const hash = await contentHashOf(data), file = kind + '/' + b + '.' + hash.slice(7) + '.json';
            files[file] = data;
            manifest[kind === 'search' ? 'searchShards' : 'variantShards'][b] = { file, contentHash: hash };
        }
    }
    return { manifest, files };
}
export function createCuratedCatalogSource({ fetchJson = async (url) => { const res = await fetch(url); if (!res.ok)
    throw new Error('Catalog unavailable'); return res.json(); }, maxShards = 32 } = {}) {
    let manifest;
    const lru = new Map();
    const open = async () => {
        if (!manifest) {
            const raw = await fetchJson(ROOT + 'manifest.json');
            if (raw.schemaVersion !== 1 || raw.catalogId !== CURATED_CATALOG_ID || !Number.isSafeInteger(raw.profileCount) || raw.profileCount < 0 || !raw.searchShards || !raw.variantShards)
                throw new Error('Invalid catalog manifest');
            manifest = raw;
        }
        return manifest;
    };
    const shard = async (entry) => {
        if (!entry)
            return [];
        if (!/^(search|variants)\/[a-z0-9_-]+\.[a-f0-9]{64}\.json$/.test(entry.file))
            throw new Error('Invalid shard path');
        if (lru.has(entry.file)) {
            const data = lru.get(entry.file);
            lru.delete(entry.file);
            lru.set(entry.file, data);
            return data;
        }
        const data = await fetchJson(ROOT + entry.file);
        if (await contentHashOf(data) !== entry.contentHash)
            throw new Error('Catalog shard hash mismatch');
        lru.set(entry.file, data);
        while (lru.size > Math.min(32, Math.max(1, maxShards)))
            lru.delete(lru.keys().next().value);
        return data;
    };
    async function getVariantRecord(id) { const m = await open(); return (await shard(m.variantShards[bucket(id)])).find(r => r.variant.variantId === id) ?? null; }
    return { open,
        search: async (q, { pageSize = 25, cursor } = {}) => {
            const m = await open(), normalized = normalizeIdentityName(q);
            if (!normalized)
                return { items: [], cursor: null };
            const tokens = normalized.split(/\s+/), buckets = [...new Set(tokens.map(bucket))].slice(0, 2);
            const rows = new Map();
            for (const b of buckets)
                for (const r of await shard(m.searchShards[b]))
                    if (tokens.every(t => r.searchTokens.some(s => s.startsWith(t))))
                        rows.set(r.variantId, r);
            const ordered = [...rows.values()].sort((a, b) => a.variantId.localeCompare(b.variantId)).filter(r => !cursor || r.variantId > cursor);
            const n = Math.max(1, Math.min(25, pageSize));
            return { items: ordered.slice(0, n), cursor: ordered.length > n ? ordered[n - 1].variantId : null };
        },
        getVariant: async (id) => (await getVariantRecord(id))?.variant ?? null,
        getRevision: async (id, n) => (await getVariantRecord(id))?.revisions.find(r => r.revision === n) ?? null,
        stats: () => ({ shards: lru.size, profileCount: manifest?.profileCount ?? 0 }),
    };
}
