import { refCacheKey, sameRef } from './ingredientRefs.js';
import { verifyRevisionHash } from './ingredientProfile.js';
export const PROFILE_CACHE_LIMITS = Object.freeze({ revisions: 2000, conversions: 4000, bytes: 8 * 1024 * 1024, headTtlMs: 24 * 60 * 60 * 1000 });
const DB_NAME = 'nutrition-profile-cache-v1';
const STORES = ['meta', 'revisions', 'heads', 'conversions', 'pendingSaves'];
const connections = new Set();
const closeCallbacks = new Set();
let epoch = 0;
const requestResult = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
export async function clearProfileCache({ idb = globalThis.indexedDB } = {}) {
    epoch++;
    for (const close of closeCallbacks) {
        try { close(); } catch { /* Closing optional storage must not block auth. */ }
    }
    closeCallbacks.clear();
    for (const connection of connections) {
        try { connection.close(); } catch { /* Best effort. */ }
    }
    connections.clear();
    if (!idb)
        return false;
    return new Promise(resolve => {
        // Other tabs can keep deletion blocked indefinitely. Bound all outcomes,
        // including browsers that never dispatch a terminal request event.
        const timeout = setTimeout(() => finish(false), 1000);
        const finish = success => { clearTimeout(timeout); resolve(success); };
        try {
            const req = idb.deleteDatabase(DB_NAME);
            req.onsuccess = () => finish(true);
            req.onerror = () => finish(false);
            req.onblocked = () => { /* The timeout also bounds blocked deletion. */ };
        } catch { finish(false); }
    });
}
export async function openProfileCache({ ownerUid, idb = globalThis.indexedDB, limits = {} }) {
    const bounds = { ...PROFILE_CACHE_LIMITS, ...limits };
    let db, closed = false, cacheEpoch = epoch;
    const open = async () => {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => { for (const name of STORES)
            if (!req.result.objectStoreNames.contains(name))
                req.result.createObjectStore(name, { keyPath: 'key' }); };
        db = await requestResult(req);
        connections.add(db);
        db.onversionchange = () => { closed = true; db.close(); connections.delete(db); };
    };
    async function io(store, mode, action) {
        if (!db || closed || cacheEpoch !== epoch)
            return undefined;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const req = action(tx.objectStore(store));
            let result;
            req.onsuccess = () => { result = req.result; };
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    try {
        if (!ownerUid || !idb)
            throw new Error('Cache unavailable');
        await open();
        const owner = await io('meta', 'readonly', s => s.get('owner'));
        if (owner && owner.value !== ownerUid) {
            if (!await clearProfileCache({ idb }))
                throw new Error('Owner cache could not be cleared');
            cacheEpoch = epoch;
            await open();
        }
        await io('meta', 'readwrite', s => s.put({ key: 'owner', value: ownerUid }));
    }
    catch {
        db?.close();
        connections.delete(db);
        db = undefined;
    }
    const get = async (s, k) => { try {
        return await io(s, 'readonly', s => s.get(k));
    }
    catch {
        return undefined;
    } };
    const all = async (s) => { try {
        return await io(s, 'readonly', s => s.getAll()) ?? [];
    }
    catch {
        return [];
    } };
    const put = async (s, v) => { try {
        await io(s, 'readwrite', s => s.put(v));
    }
    catch { /* Offline cache is optional. */ } };
    const del = async (s, k) => { try {
        await io(s, 'readwrite', s => s.delete(k));
    }
    catch { /* Cache unavailable. */ } };
    const headKey = ref => ref.namespace + '|' + ref.variantId;
    async function evict() {
        const revisions = await all('revisions'), conversions = await all('conversions'), heads = await all('heads');
        const rows = [...revisions.map(v => ({ ...v, store: 'revisions' })), ...conversions.map(v => ({ ...v, store: 'conversions' })), ...heads.map(v => ({ ...v, store: 'heads' }))].sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.key.localeCompare(b.key));
        let bytes = rows.reduce((n, r) => n + new TextEncoder().encode(JSON.stringify(r)).length, 0);
        const counts = { revisions: revisions.length, conversions: conversions.length, heads: heads.length };
        for (const row of rows) {
            if (bytes <= bounds.bytes && counts[row.store] <= (bounds[row.store] ?? bounds.revisions))
                continue;
            await del(row.store, row.key);
            counts[row.store]--;
            bytes -= new TextEncoder().encode(JSON.stringify(row)).length;
        }
    }
    async function getRevision(ref) {
        const row = await get('revisions', refCacheKey(ref));
        if (!row)
            return { status: 'missing' };
        if (!sameRef({ ...ref, identityId: row.revision.identityId, variantId: row.revision.variantId, revision: row.revision.revision, contentHash: row.revision.contentHash }, ref) || !await verifyRevisionHash(row.revision)) {
            await del('revisions', row.key);
            return { status: 'corrupt' };
        }
        await put('revisions', { ...row, lastUsedAt: Date.now() });
        return { status: 'fresh', revision: row.revision };
    }
    async function revalidate(fetcher) {
        for (const row of await all('heads')) {
            try {
                const head = await fetcher(row.ref);
                if (head)
                    await put('heads', { ...row, head, checkedAt: Date.now(), lastUsedAt: Date.now() });
            }
            catch { /* Remains stale. */ }
        }
    }
    let onlineFetcher;
    const onOnline = () => { if (onlineFetcher)
        void revalidate(onlineFetcher); };
    globalThis.addEventListener?.('online', onOnline);
    const close = () => { closed = true; db?.close(); connections.delete(db); closeCallbacks.delete(close); globalThis.removeEventListener?.('online', onOnline); };
    closeCallbacks.add(close);
    return {
        getRevision,
        putRevision: async (ref, revision) => { if (!await verifyRevisionHash(revision) || revision.contentHash !== ref.contentHash || revision.identityId !== ref.identityId || revision.variantId !== ref.variantId || revision.revision !== ref.revision)
            return; await put('revisions', { key: refCacheKey(ref), revision, lastUsedAt: Date.now() }); await evict(); },
        getHead: async (ref) => { const row = await get('heads', headKey(ref)); if (row)
            await put('heads', { ...row, lastUsedAt: Date.now() }); return row ? { status: Date.now() - row.checkedAt >= bounds.headTtlMs ? 'stale' : 'fresh', head: row.head } : { status: 'missing' }; },
        putHead: async (ref, head) => { await put('heads', { key: headKey(ref), ref, head, checkedAt: Date.now(), lastUsedAt: Date.now() }); await evict(); },
        getConversions: async (namespace) => { const rows = (await all('conversions')).filter(r => r.namespace === namespace); for (const row of rows)
            await put('conversions', { ...row, lastUsedAt: Date.now() }); return rows.map(r => r.conversion); },
        putConversion: async (namespace, conversion) => { await put('conversions', { key: namespace + '|' + conversion.conversionId, namespace, conversion, lastUsedAt: Date.now() }); await evict(); },
        revalidate: async (fetcher) => { onlineFetcher = fetcher; await revalidate(fetcher); }, evict,
        putPendingSave: async (draft) => put('pendingSaves', { ...draft, key: draft.idempotencyKey }),
        listPendingSaves: async () => all('pendingSaves'), deletePendingSave: async (key) => del('pendingSaves', key),
        close,
    };
}
