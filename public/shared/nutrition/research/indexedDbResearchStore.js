import { validateJob } from './researchJob.js';
export const RESEARCH_DB_NAME = 'nutrition-research-jobs-v1';
const handles = new Set();
let epoch = 0;
const requestResult = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
export async function clearResearchJobs({ idb = globalThis.indexedDB } = {}) {
    epoch++;
    for (const close of handles)
        close();
    handles.clear();
    if (!idb)
        return false;
    return new Promise(resolve => {
        const timer = setTimeout(() => finish(false), 1000);
        const finish = ok => { clearTimeout(timer); resolve(ok); };
        try {
            const req = idb.deleteDatabase(RESEARCH_DB_NAME);
            req.onsuccess = () => finish(true);
            req.onerror = () => finish(false);
            req.onblocked = () => { };
        }
        catch {
            finish(false);
        }
    });
}
/** Owner-exclusive local outbox. Unavailable storage fails visibly; no private fallback. */
export async function openResearchJobStore({ ownerUid, idb = globalThis.indexedDB } = {}) {
    if (!ownerUid || !idb)
        throw new Error('Research storage unavailable');
    let db, closed = false, handleEpoch = epoch;
    const close = () => { closed = true; db?.close(); handles.delete(close); };
    async function open() {
        const req = idb.open(RESEARCH_DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('records'))
                req.result.createObjectStore('records', { keyPath: 'key' });
        };
        db = await requestResult(req);
        if (handleEpoch !== epoch) {
            db.close();
            throw new Error('Research store closed during open');
        }
        db.onversionchange = close;
    }
    async function transaction(mode, action) {
        if (closed || handleEpoch !== epoch)
            throw new Error('Research store closed');
        return new Promise((resolve, reject) => {
            const tx = db.transaction('records', mode), records = tx.objectStore('records');
            let result, error;
            tx.oncomplete = () => error ? reject(error) : resolve(result);
            tx.onerror = () => reject(tx.error || error);
            tx.onabort = () => reject(error || tx.error);
            const req = records.get('owner');
            req.onsuccess = () => {
                try {
                    if (req.result && req.result.ownerUid !== ownerUid)
                        throw new Error('Research store owner changed');
                    action(records, value => { result = value; }, failure => { error = failure; tx.abort?.(); });
                }
                catch (e) {
                    error = e;
                    tx.abort?.();
                }
            };
            req.onerror = () => { error = req.error; };
        });
    }
    await open();
    handles.add(close);
    const ownerReq = db.transaction('records', 'readonly').objectStore('records').get('owner');
    const existing = await requestResult(ownerReq);
    if (existing && existing.ownerUid !== ownerUid) {
        if (!await clearResearchJobs({ idb }))
            throw new Error('Previous research owner could not be cleared');
        handleEpoch = epoch;
        closed = false;
        await open();
        handles.add(close);
    }
    await transaction('readwrite', s => s.put({ key: 'owner', ownerUid }));
    async function all() { return transaction('readonly', (s, done) => { const r = s.getAll(); r.onsuccess = () => done(r.result.filter(v => v.key !== 'owner').map(v => v.job)); }); }
    async function saveMany(entries) {
        for (const { job } of entries) {
            const errors = validateJob(job);
            if (errors.length)
                throw new TypeError(errors.join('; '));
            if (job.scope === 'private' && job.ownerUid !== ownerUid)
                throw new Error('Research owner mismatch');
        }
        return transaction('readwrite', (s, done, fail) => {
            const r = s.getAll();
            r.onsuccess = () => {
                const rows = new Map(r.result.map(row => [row.key, row.job]));
                if (entries.some(({ job, expectedVersion }) => expectedVersion !== undefined && (rows.get(job.jobId)?.version || 0) !== expectedVersion)) {
                    fail(new Error('Compare-and-swap conflict'));
                    return;
                }
                for (const { job } of entries)
                    s.put({ key: job.jobId, job });
            };
        });
    }
    return { close, saveMany, save: (job, options = {}) => saveMany([{ job, ...options }]),
        get: async (id) => (await all()).find(j => j.jobId === id) || null,
        getByKey: async (key) => (await all()).find(j => j.jobKey === key) || null,
        listByBatch: async (id) => (await all()).filter(j => j.parentBatchId === id),
        list: async ({ state, scope, cursor, limit = 25 } = {}) => { const rows = (await all()).filter(j => (!state || j.state === state) && (!scope || j.scope === scope) && (!cursor || j.jobId > cursor)).sort((a, b) => a.jobId.localeCompare(b.jobId)); const items = rows.slice(0, Math.max(1, Math.min(limit, 100))); return { items, cursor: rows.length > items.length ? items.at(-1).jobId : null }; }
    };
}
