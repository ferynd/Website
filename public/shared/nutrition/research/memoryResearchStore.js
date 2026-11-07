import { canonicalJson, sha256Hex } from '../contentHash.js';
import { validateJob } from './researchJob.js';
export function createMemoryResearchStore() {
    const byId = new Map();
    const byKey = new Map();
    return {
        async get(jobId) {
            const job = byId.get(jobId);
            return job ? structuredClone(job) : null;
        },
        async getByKey(jobKey) {
            const jobId = byKey.get(jobKey);
            if (!jobId)
                return null;
            const job = byId.get(jobId);
            return job ? structuredClone(job) : null;
        },
        async save(job, { expectedVersion } = {}) {
            if (expectedVersion !== undefined) {
                const existing = byId.get(job.jobId);
                const currentVersion = existing ? existing.version : 0;
                if (currentVersion !== expectedVersion) {
                    const err = new Error(`Compare-and-swap conflict for job ${job.jobId}: expected version ${expectedVersion}, got ${currentVersion}`);
                    err.name = 'ConflictError';
                    err.code = 'conflict';
                    throw err;
                }
            }
            const errors = validateJob(job);
            if (errors.length) {
                throw new TypeError(`Cannot save invalid job: ${errors.join('; ')}`);
            }
            byId.set(job.jobId, structuredClone(job));
            if (job.jobKey) {
                byKey.set(job.jobKey, job.jobId);
            }
        },
        async saveMany(entries) {
            for (const { job, expectedVersion } of entries) {
                if ((byId.get(job.jobId)?.version || 0) !== expectedVersion)
                    throw new Error('Compare-and-swap conflict');
                const errors = validateJob(job);
                if (errors.length)
                    throw new TypeError(errors.join('; '));
            }
            for (const { job } of entries) {
                byId.set(job.jobId, structuredClone(job));
                byKey.set(job.jobKey, job.jobId);
            }
        },
        async listByBatch(batchId) {
            return [...byId.values()]
                .filter(j => j.parentBatchId === batchId)
                .map(j => structuredClone(j));
        },
        async list({ state, scope, cursor, limit = 25 } = {}) {
            let all = [...byId.values()];
            if (state)
                all = all.filter(j => j.state === state);
            if (scope)
                all = all.filter(j => j.scope === scope);
            all.sort((a, b) => a.jobId.localeCompare(b.jobId));
            if (cursor) {
                all = all.filter(j => j.jobId > cursor);
            }
            const capped = Math.max(1, Math.min(100, limit));
            const items = all.slice(0, capped).map(j => structuredClone(j));
            const nextCursor = all.length > capped ? items[items.length - 1].jobId : null;
            return { items, cursor: nextCursor };
        },
    };
}
export function createMemorySourceCache() {
    const cache = new Map();
    return {
        async getOrFetch(key, fetcher) {
            if (cache.has(key)) {
                const entry = cache.get(key);
                return {
                    data: structuredClone(entry.data),
                    checksum: entry.checksum,
                    cached: true,
                };
            }
            const data = await fetcher();
            const checksum = 'sha256:' + (await sha256Hex(canonicalJson(data)));
            cache.set(key, { data: structuredClone(data), checksum });
            return {
                data,
                checksum,
                cached: false,
            };
        },
        async get(key) {
            const entry = cache.get(key);
            if (!entry)
                return null;
            return {
                data: structuredClone(entry.data),
                checksum: entry.checksum,
            };
        },
        async set(key, data, checksum) {
            const cs = checksum || ('sha256:' + (await sha256Hex(canonicalJson(data))));
            cache.set(key, { data: structuredClone(data), checksum: cs });
        },
        async has(key) {
            return cache.has(key);
        },
        clear() {
            cache.clear();
        },
    };
}
