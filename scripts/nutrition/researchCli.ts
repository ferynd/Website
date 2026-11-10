import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryResearchStore, createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { createResearchService } from '../../public/shared/nutrition/research/researchService.js';
import { parentBatchIdFor, passIdFor } from '../../public/shared/nutrition/research/researchJob.js';
import { buildResearchPackets, canonicalRequestBody, copyableResearchPacket } from '../../public/shared/nutrition/research/researchPacket.js';
import { createManualAdapter, createLabelAdapter } from '../../public/shared/nutrition/research/manualAdapters.js';
import { validateProposal } from '../../public/shared/nutrition/research/researchValidator.js';
import { assertCuratedMatchTable, buildReviewPacket } from '../../public/shared/nutrition/research/researchReview.js';
import { stageCatalog } from '../../public/shared/nutrition/research/stagedCatalog.js';
import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJobStore, SourceCache, ResearchAdapter, FetchResearchAdapter } from '../../public/shared/nutrition/research/researchPorts.js';
import { readManifest, selectNextBatch, stateToDims } from './manifestReader';
import { readMatchTable, validateMatchTable, matchFor } from './matchTable';
import { createFileResearchStore, createFileSourceCache, assertLocalPath } from './fileResearchStore';
import { indexBulk, createFdcBulkAdapter } from './fdcBulkReader';
import { suggestFromBulk } from './matchSuggest';
import { createFdcApiAdapter } from './fdcApiAdapter';
import { coverageReport } from './coverageReport';
import { RESEARCH_CONFIG } from './researchConfig';
export { canonicalRequestBody };
/** This export is also used to assert CLI/browser byte parity. */
export const packetForJobs = buildResearchPackets;
const COMMANDS: readonly string[] = ['plan', 'index', 'run', 'retry', 'validate', 'review', 'stage', 'coverage', 'suggest', 'packet', 'import-packet'];
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
/**
 * The release a planned pass claims. An explicit --dataset/--release must
 * agree with every reviewed bulk match in the batch. Without one, the pass
 * names the sorted set of the batch's match-entry releases ('+'-joined), so a
 * mixed Foundation + SR Legacy batch never claims a single release; a batch
 * with no reviewed matches stays 'unconfigured'.
 */
export function planReleaseFor(manifestIds: readonly string[], matches: Parameters<typeof matchFor>[0], explicit?: string) {
    const releases = [...new Set(manifestIds.map(id => matchFor(matches, id, 'fdc_bulk')?.sourceRelease).filter((r): r is string => !!r))].sort();
    if (explicit) {
        const other = releases.filter(r => r !== explicit);
        if (other.length)
            throw new Error(`plan release ${explicit} conflicts with reviewed match release(s) ${other.join(', ')}; omit --dataset/--release to plan a mixed-release batch`);
        return explicit;
    }
    return releases.length ? releases.join('+') : 'unconfigured';
}
export async function researchCli(args: string[], { output = (v: unknown) => process.stdout.write(typeof v === 'string' ? v + '\n' : Array.isArray(v) && v.length && v.every(item => typeof item.copyable === 'string') ? v.map(item => item.copyable).join('\n\n') + '\n' : JSON.stringify(v, null, 2) + '\n'), fetch: fetcher = globalThis.fetch, fdcBulkAdapter, matchTable }: {
    output?: (v: unknown) => void;
    fetch?: typeof fetch;
    fdcBulkAdapter?: ResearchAdapter & FetchResearchAdapter;
    /**
     * Tests only: a match-table document validated exactly like the reviewed
     * file. Deliberately not a CLI flag, so an operator cannot point a run at an
     * unreviewed overlay table.
     */
    matchTable?: unknown;
} = {}) {
    const argv = args[0] === '--' ? args.slice(1) : args;
    const command = argv[0];
    if (!COMMANDS.includes(command))
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
    const entries = await readManifest(), matches = matchTable === undefined ? await readMatchTable() : await validateMatchTable(matchTable);
    const pin = RESEARCH_CONFIG.datasets.find(d => d.id === str('dataset'));
    const release = str('release') || pin?.release || 'unconfigured';
    if (fdcBulkAdapter && fdcBulkAdapter.id !== 'fdc_bulk')
        throw new Error('Injected offline adapter must use fdc_bulk');
    const adapters = [createManualAdapter(), createLabelAdapter(), fdcBulkAdapter || createFdcBulkAdapter({ cache, release, matches }), createFdcApiAdapter({ live: flags.live === true, fetch: fetcher, matches })];
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
            const planRelease = planReleaseFor(next.map(e => e.id), matches, str('release') || pin?.release);
            const passId = await passIdFor({ parentBatchId, adapter: str('source') || 'fdc_bulk', sourceRelease: planRelease });
            const planned = [];
            for (const e of next) {
                const { dims, needsReview } = stateToDims(e.state);
                planned.push(await service.enqueue({ parentBatchId, passId, sourceRelease: planRelease, fields, target: { ...e, manifestId: e.id, canonicalName: e.name, dims, needsReview, catalogState: e.state } }));
            }
            result = { dryRun: !flags.write, parentBatchId, sourceRelease: planRelease, jobs: planned };
            break;
        }
        case 'index': {
            const pin = RESEARCH_CONFIG.datasets.find(d => d.id === str('dataset'));
            if (!pin || !str('file'))
                throw new Error('--dataset and --file required');
            result = { ...await indexBulk(str('file')!, pin, cache), dryRun: !flags.write };
            break;
        }
        case 'run': {
            requireSelected();
            const source = str('source');
            if (!['fdc-bulk', 'fdc-api', 'manual', 'label'].includes(source || ''))
                throw new Error('--source required');
            const input = str('input') ? JSON.parse(await readFile(str('input')!, 'utf8')) : null;
            if (input && !str('job'))
                throw new Error('--input requires exactly one --job');
            const ran = [];
            for (const j of selected)
                ran.push(await service.runJob(j.jobId, { adapterId: source!.replace('-', '_'), context: { manualRecord: input, labelRecord: input } }));
            result = ran;
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
            const validated = [];
            for (const j of selected) {
                const validation = await validateProposal(j);
                if (flags.write)
                    await store.save({ ...j, validation, version: j.version + 1 }, { expectedVersion: j.version });
                validated.push({ jobId: j.jobId, validation });
            }
            result = validated;
            break;
        }
        case 'review': {
            requireSelected();
            if (selected.length !== 1)
                throw new Error('review requires --job');
            const job = selected[0];
            if (str('verify-source')) {
                if (job.scope === 'private' && !str('source')) {
                    result = await service.attestSource(job.jobId, str('verify-source')!, str('reviewer') || '');
                } else {
                    const source = str('source') || 'fdc-bulk';
                    let sourceIndex: Record<string, unknown> | null = null;
                    if (!['fdc-bulk', 'fdc-api'].includes(source))
                        throw new Error('Source verification requires fdc-bulk or fdc-api');
                    if (source === 'fdc-bulk' && str('file')) {
                        if (!pin) throw new Error('--file requires a pinned --dataset');
                        if (release !== pin.release) throw new Error('--release must match the dataset pin');
                        // Report the same value-free BulkIndexReport as `index` (PR #213), so the
                        // records skipped from this release are visible next to the verification.
                        sourceIndex = { dataset: pin.id, release: pin.release, ...await indexBulk(str('file')!, pin, cache) };
                    }
                    const verified = await service.verifySource(job.jobId, str('verify-source')!, source.replace('-', '_'), { matches });
                    result = sourceIndex ? { ...verified, sourceIndex } : verified;
                }
                break;
            }
            if (str('decide')) {
                if (str('decide') === 'approve')
                    assertCuratedMatchTable(job, matches);
                result = await service.review(job.jobId, { decision: str('decide') as 'approve' | 'reject' | 'block', reviewer: str('reviewer') || '', approvedContentHash: str('hash'), acknowledgedWarnings: str('ack')?.split('|') || [], attestation: flags.attest === true });
            }
            else
                result = await buildReviewPacket(job, { matches });
            break;
        }
        case 'stage': {
            requireSelected();
            const approved = selected.filter(j => j.state === 'approved');
            if (!approved.length)
                throw new Error('No approved jobs to stage');
            const staged = await stageCatalog(approved, { matches });
            if (flags.write) {
                if (!str('out'))
                    throw new Error('stage --write requires --out');
                const out = await assertLocalPath(str('out')!);
                await mkdir(out, { recursive: true });
                // A second batch must not replace manifest.json and leave the
                // earlier shards on disk but unlisted. Use a fresh directory.
                if ((await readdir(out)).length)
                    throw new Error('stage --write refuses a non-empty --out');
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
            // The audit path tolerates (and counts) records the parser rejects,
            // so the real Foundation release can be searched.
            const pin = RESEARCH_CONFIG.datasets.find(d => d.id === str('dataset'));
            const found = pin && str('file') ? await suggestFromBulk(str('file')!, pin, entry, Number(str('max') || 20)) : { candidates: [], skippedRecords: 0, skippedFdcIds: [] };
            result = { manifestId: entry.id, reviewOnly: true, dataset: pin?.id ?? null, release: pin?.release ?? null, ...found };
            break;
        }
    }
    output(result);
    return result;
}
/**
 * vite-node consumes the script path (and a bare `--`), so its own binary is
 * argv[1] and the CLI command is argv[2]; a plain `node` launch passes the
 * script itself. Requiring a known command under vite-node keeps another
 * vite-node script that imports this module from running it by accident.
 */
export function isResearchCliEntry(argv: readonly string[], scriptFilePath: string) {
    const launcher = argv[1];
    if (!launcher)
        return false;
    if (['vite-node', 'vite-node.mjs'].includes(path.basename(launcher))) {
        const command = argv[2] === '--' ? argv[3] : argv[2];
        return COMMANDS.includes(command);
    }
    const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    return real(launcher) === real(scriptFilePath);
}
if (isResearchCliEntry(process.argv, fileURLToPath(import.meta.url))) {
    researchCli(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
