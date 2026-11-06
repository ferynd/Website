import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemoryResearchStore, createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { createResearchService } from '../../public/shared/nutrition/research/researchService.js';
import { parentBatchIdFor, passIdFor } from '../../public/shared/nutrition/research/researchJob.js';
import { buildResearchPackets, canonicalRequestBody, copyableResearchPacket } from '../../public/shared/nutrition/research/researchPacket.js';
import { createManualAdapter, createLabelAdapter } from '../../public/shared/nutrition/research/manualAdapters.js';
import { validateProposal } from '../../public/shared/nutrition/research/researchValidator.js';
import { buildReviewPacket } from '../../public/shared/nutrition/research/researchReview.js';
import { stageCatalog } from '../../public/shared/nutrition/research/stagedCatalog.js';
import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJobStore, SourceCache } from '../../public/shared/nutrition/research/researchPorts.js';
import { readManifest, selectNextBatch, stateToDims } from './manifestReader';
import { readMatchTable } from './matchTable';
import { createFileResearchStore, createFileSourceCache, assertLocalPath } from './fileResearchStore';
import { readPinnedBulk, indexBulk, createFdcBulkAdapter } from './fdcBulkReader';
import { createFdcApiAdapter } from './fdcApiAdapter';
import { coverageReport } from './coverageReport';
import { RESEARCH_CONFIG } from './researchConfig';
export { canonicalRequestBody };
/** This export is also used to assert CLI/browser byte parity. */
export const packetForJobs = buildResearchPackets;
async function allJobs(store: ResearchJobStore) {
    const jobs: ResearchJob[] = [];
    let cursor: string | null | undefined;
    do {
        const page = await store.list({ limit: 100, cursor: cursor || undefined });
        jobs.push(...page.items);
        cursor = page.cursor;
    } while (cursor);
    return jobs;
}
export async function researchCli(args: string[], { output = (v: unknown) => process.stdout.write(typeof v === 'string' ? v + '\n' : Array.isArray(v) && v.length && v.every(item => typeof item.copyable === 'string') ? v.map(item => item.copyable).join('\n\n') + '\n' : JSON.stringify(v, null, 2) + '\n'), fetch: fetcher = globalThis.fetch }: {
    output?: (v: unknown) => void;
    fetch?: typeof fetch;
} = {}) {
    const argv = args[0] === '--' ? args.slice(1) : args;
    const command = argv[0];
    if (!['plan', 'index', 'run', 'retry', 'validate', 'review', 'stage', 'coverage', 'suggest', 'packet', 'import-packet'].includes(command))
        throw new Error('Expected plan/index/run/retry/validate/review/stage/coverage/suggest/packet/import-packet');
    const flags: Record<string, string | boolean> = {};
    const booleanFlags = ['write', 'live', 'attest', 'include-label-evidence'];
    const valueFlags = ['store', 'out', 'wave', 'max', 'batch', 'job', 'source', 'input', 'file', 'dataset', 'manifest-id', 'reviewer', 'hash', 'ack', 'decide', 'release', 'fields', 'verify-source'];
    for (let i = 1; i < argv.length; i++) {
        const flag = argv[i].replace(/^--/, '');
        if (!argv[i].startsWith('--') || (!booleanFlags.includes(flag) && !valueFlags.includes(flag)))
            throw new Error('Unknown flag');
        if (booleanFlags.includes(flag))
            flags[flag] = true;
        else {
            if (!argv[i + 1] || argv[i + 1].startsWith('--'))
                throw new Error('Flag requires a value: ' + flag);
            flags[flag] = argv[++i];
        }
    }
    const str = (key: string) => typeof flags[key] === 'string' ? flags[key] as string : undefined;
    if (flags.write && !str('store'))
        throw new Error('--write requires --store');
    if (str('out'))
        await assertLocalPath(str('out')!);
    if (str('source') === 'fdc-api' && !flags.live)
        throw new Error('fdc-api requires --live');
    if (str('source') === 'fdc-api' && !process.env.FDC_API_KEY)
        throw new Error('FDC_API_KEY is required');
    // Dry runs load persisted records into memory and never alter the file store/cache.
    let store: ResearchJobStore = createMemoryResearchStore(), cache: SourceCache = createMemorySourceCache();
    if (str('store')) {
        const files = await createFileResearchStore(str('store')!);
        if (flags.write) {
            store = files;
            cache = await createFileSourceCache(str('store')!);
        }
        else {
            for (const j of await allJobs(files))
                await store.save(j);
            const disk = await createFileSourceCache(str('store')!), memory = cache;
            cache = { ...memory, get: async (key) => await memory.get(key) || await disk.get(key), has: async (key) => await memory.has(key) || await disk.has(key), getOrFetch: async <T>(key: string, fetcher: () => Promise<T>) => { const row = await disk.get(key); return row ? { ...row, data: row.data as T, cached: true } : memory.getOrFetch(key, fetcher); } };
        }
    }
    const entries = await readManifest(), matches = await readMatchTable();
    const release = str('release') || 'unconfigured';
    const adapters = [createManualAdapter(), createLabelAdapter(), createFdcBulkAdapter({ cache, release, matches }), createFdcApiAdapter({ live: flags.live === true, fetch: fetcher, matches })];
    const service = createResearchService({ store, sourceCache: cache, adapters });
    const jobs = await allJobs(store);
    let selected = str('job') ? jobs.filter(j => j.jobId === str('job')) : str('batch') ? jobs.filter(j => j.parentBatchId === str('batch')) : jobs;
    const requireSelected = () => {
        if (!selected.length)
            throw new Error('No matching jobs; use plan first with --write --store');
    };
    let result: unknown;
    switch (command) {
        case 'plan': {
            const next = selectNextBatch(entries, jobs, { wave: str('wave'), max: Number(str('max') || 25) });
            const parentBatchId = await parentBatchIdFor({ priority: next[0]?.priority, category: next[0]?.category, manifestIds: next.map(e => e.id) });
            const fields = str('fields')?.split(',') || '*';
            const planned = [];
            for (const e of next) {
                const { dims, needsReview } = stateToDims(e.state);
                const passId = await passIdFor({ parentBatchId, adapter: str('source') || 'fdc_bulk', sourceRelease: release });
                planned.push(await service.enqueue({ parentBatchId, passId, sourceRelease: release, fields, target: { ...e, manifestId: e.id, canonicalName: e.name, dims, needsReview, catalogState: e.state } }));
            }
            result = { dryRun: !flags.write, parentBatchId, jobs: planned };
            break;
        }
        case 'index': {
            const pin = RESEARCH_CONFIG.datasets.find(d => d.id === str('dataset'));
            if (!pin || !str('file'))
                throw new Error('--dataset and --file required');
            result = { count: await indexBulk(str('file')!, pin, cache), dryRun: !flags.write };
            break;
        }
        case 'run': {
            requireSelected();
            const source = str('source');
            if (!['fdc-bulk', 'fdc-api', 'manual', 'label'].includes(source || ''))
                throw new Error('--source required');
            const input = str('input') ? JSON.parse(await readFile(str('input')!, 'utf8')) : null;
            result = await Promise.all(selected.map(j => service.runJob(j.jobId, { adapterId: source!.replace('-', '_'), context: { manualRecord: input, labelRecord: input } })));
            break;
        }
        case 'retry': {
            if (!str('job')) throw new Error('retry requires --job');
            requireSelected();
            result = { dryRun: !flags.write, job: await service.retryJob(str('job')!) };
            break;
        }
        case 'packet': {
            requireSelected();
            selected = selected.filter(j => j.state === 'queued');
            const packets = await service.prepareRequest(selected.map(j => j.jobId), { includeLabelEvidence: flags['include-label-evidence'] === true });
            result = packets.map(request => ({ request, copyable: copyableResearchPacket(request) }));
            break;
        }
        case 'import-packet': {
            if (!str('input'))
                throw new Error('--input required');
            result = await service.acceptResponse(await readFile(str('input')!, 'utf8'));
            break;
        }
        case 'validate': {
            requireSelected();
            result = await Promise.all(selected.map(async (j) => {
                const validation = await validateProposal(j);
                if (flags.write)
                    await store.save({ ...j, validation, version: j.version + 1 }, { expectedVersion: j.version });
                return { jobId: j.jobId, validation };
            }));
            break;
        }
        case 'review': {
            requireSelected();
            if (selected.length !== 1)
                throw new Error('review requires --job');
            const job = selected[0];
            if (str('verify-source')) {
                result = await service.attestSource(job.jobId, str('verify-source')!, str('reviewer') || '');
                break;
            }
            if (str('decide'))
                result = await service.review(job.jobId, { decision: str('decide') as 'approve' | 'reject' | 'block', reviewer: str('reviewer') || '', approvedContentHash: str('hash'), acknowledgedWarnings: str('ack')?.split('|') || [], attestation: flags.attest === true });
            else
                result = buildReviewPacket(job);
            break;
        }
        case 'stage': {
            requireSelected();
            const staged = await stageCatalog(selected);
            if (flags.write) {
                if (!str('out'))
                    throw new Error('stage --write requires --out');
                const out = await assertLocalPath(str('out')!);
                await mkdir(out, { recursive: true });
                for (const [name, data] of Object.entries({ ...staged.files, 'manifest.json': staged.manifest })) {
                    const file = path.join(out, name);
                    await mkdir(path.dirname(file), { recursive: true });
                    await writeFile(file, JSON.stringify(data) + '\n', { mode: 0o600 });
                }
            }
            result = { dryRun: !flags.write, ...staged };
            break;
        }
        case 'coverage':
            result = coverageReport(entries, jobs);
            break;
        case 'suggest': {
            if (!str('manifest-id'))
                throw new Error('--manifest-id required');
            const entry = entries.find(e => e.id === str('manifest-id'));
            if (!entry)
                throw new Error('Unknown manifest ID');
            // Suggestions are candidates, never automatic match-table edits.
            const pin = RESEARCH_CONFIG.datasets.find(d => d.id === str('dataset'));
            const foods = pin && str('file') ? await readPinnedBulk(str('file')!, pin) : [];
            result = { manifestId: entry.id, reviewOnly: true, candidates: foods.filter(f => String(f.description).toLowerCase().includes(entry.name.toLowerCase())).map(f => ({ fdcId: f.fdcId, description: f.description })) };
            break;
        }
    }
    output(result);
    return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    researchCli(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
