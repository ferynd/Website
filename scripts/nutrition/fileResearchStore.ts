import { mkdir, readFile, rename, open, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { validateJob } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJobStore, SourceCache } from '../../public/shared/nutrition/research/researchPorts.js';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
async function physicalPath(input: string): Promise<string> {
    try {
        return await realpath(input);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
        const parent = path.dirname(input);
        if (parent === input)
            return input;
        return path.join(await physicalPath(parent), path.basename(input));
    }
}
export async function assertLocalPath(input: string) {
    const resolved = await physicalPath(path.resolve(input)), publicRoot = await physicalPath(path.resolve('public'));
    if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep) || resolved.split(path.sep).includes('public'))
        throw new Error('Research paths must be outside public/');
    return resolved;
}
async function atomicJson(file: string, data: unknown) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.tmp-' + randomBytes(12).toString('hex');
    const handle = await open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify(data) + '\n');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(temp, file);
        const dir = await open(path.dirname(file), 'r');
        try {
            await dir.sync();
        }
        finally {
            await dir.close();
        }
    }
    finally {
        await unlink(temp).catch(() => { });
    }
}
async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return fallback;
        throw error;
    }
}
async function withLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lock = path.join(root, '.lock');
    let handle;
    try {
        handle = await open(lock, 'wx', 0o600);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error;
        // Never steal a lock based on age: two reclaimers can otherwise remove
        // a newly acquired lock and defeat CAS. The PID in the file supports
        // explicit operator recovery after checking that process has exited.
        throw new Error('Research store locked; inspect an abandoned .lock before retrying');
    }
    try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
        await handle.sync();
        return await fn();
    }
    finally {
        await handle.close();
        await unlink(lock);
    }
}
export async function createFileResearchStore(input: string): Promise<ResearchJobStore> {
    const root = await assertLocalPath(input), file = path.join(root, 'jobs.json');
    const read = () => readJson<ResearchJob[]>(file, []);
    async function saveMany(entries: {
        job: ResearchJob;
        expectedVersion?: number;
    }[]) {
        await assertLocalPath(root);
        await withLock(root, async () => {
            const rows = await read(), map = new Map(rows.map(j => [j.jobId, j]));
            for (const { job, expectedVersion } of entries) {
                const errors = validateJob(job);
                if (errors.length)
                    throw new TypeError(errors.join('; '));
                if (expectedVersion !== undefined && (map.get(job.jobId)?.version || 0) !== expectedVersion)
                    throw new Error('Compare-and-swap conflict');
            }
            for (const { job } of entries)
                map.set(job.jobId, job);
            await atomicJson(file, [...map.values()].sort((a, b) => a.jobId.localeCompare(b.jobId)));
        });
    }
    return { saveMany, save: (job, options = {}) => saveMany([{ job, ...options }]), get: async (id) => (await read()).find(j => j.jobId === id) || null, getByKey: async (key) => (await read()).find(j => j.jobKey === key) || null, listByBatch: async (id) => (await read()).filter(j => j.parentBatchId === id), list: async ({ state, scope, cursor, limit = 25 } = {}) => { const rows = (await read()).filter(j => (!state || j.state === state) && (!scope || j.scope === scope) && (!cursor || j.jobId > cursor)).sort((a, b) => a.jobId.localeCompare(b.jobId)); const items = rows.slice(0, Math.max(1, Math.min(100, limit))); return { items, cursor: rows.length > items.length ? items[items.length - 1].jobId : null }; } };
}
export async function createFileSourceCache(input: string): Promise<SourceCache> {
    const root = await assertLocalPath(input);
    const file = (key: string) => path.join(root, 'sources', createHash('sha256').update(key).digest('hex') + '.json');
    const digest = (data: unknown) => 'sha256:' + createHash('sha256').update(canonicalJson(data)).digest('hex');
    async function get(key: string) {
        const row = await readJson<{
            data: unknown;
            checksum: string;
        } | null>(file(key), null);
        if (row && digest(row.data) !== row.checksum)
            throw new Error('Source cache checksum mismatch');
        return row;
    }
    async function set(key: string, data: unknown, checksum?: string) {
        const actual = digest(data);
        if (checksum && actual !== checksum)
            throw new Error('Source cache checksum mismatch');
        await assertLocalPath(root);
        await withLock(root, () => atomicJson(file(key), { data, checksum: actual }));
    }
    return { get, set, has: async (key) => !!await get(key), getOrFetch: async <T>(key: string, fetcher: () => Promise<T>) => {
            const cached = await get(key);
            if (cached)
                return { ...cached, data: cached.data as T, cached: true };
            const data = await fetcher();
            await set(key, data);
            return { data, checksum: digest(data), cached: false };
        } };
}
