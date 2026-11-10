import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { researchCli, packetForJobs, isResearchCliEntry } from './researchCli';
import { createFileResearchStore } from './fileResearchStore';
import { buildResearchPackets, canonicalRequestBody } from '../../public/shared/nutrition/research/researchPacket.js';
import type { ResearchRequest } from '../../public/shared/nutrition/research/researchPacket.js';
import { packetFixture, responseFor } from '../../public/tools/CalorieTracker/nutrition/researchPacketFixtures.js';
import { createResearchJob, transition, passIdFor } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { reviewContentHash } from '../../public/shared/nutrition/research/researchReview.js';
import { emptyStagedRecord, V2_KEYS } from '../../public/shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../public/shared/nutrition/ingredientProfile.js';
import { buildConversion } from '../../public/shared/nutrition/ingredientConversion.js';
import { CURATED_CATALOG_ID } from '../../public/shared/nutrition/ingredientIds.js';
const temp: string[] = [];
const output = () => { };
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); vi.unstubAllEnvs(); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct62-cli-')); temp.push(p); return p; }
it('CLI/app build identical canonical bodies/digests, with new IDs per issue', async () => {
    const root = await dir();
    await researchCli(['plan', '--max', '3', '--fields', 'protein', '--write', '--store', root], { output });
    const store = await createFileResearchStore(root), { items: jobs } = await store.list();
    const app = await buildResearchPackets(jobs), cli = await packetForJobs(jobs);
    expect(cli.map(canonicalRequestBody)).toEqual(app.map(canonicalRequestBody));
    expect(cli.map(r => r.requestDigest)).toEqual(app.map(r => r.requestDigest));
    expect(cli[0].requestId).not.toBe(app[0].requestId);
});
it('plan/packet/import/review/coverage are dry-run by default and never fetch', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--store', root, '--max', '1'], { output, fetch });
    expect(await readdir(root)).toEqual([]);
    await researchCli(['plan', '--store', root, '--max', '1', '--fields', 'protein', '--write'], { output, fetch });
    const file = path.join(root, 'jobs.json'), before = await readFile(file, 'utf8');
    const capture: unknown[] = [];
    await researchCli(['packet', '--store', root], { output: v => capture.push(v), fetch });
    expect(await readFile(file, 'utf8')).toBe(before);
    await researchCli(['packet', '--store', root, '--write'], { output: v => capture.push(v), fetch });
    const packet = (capture[1] as {
        request: Parameters<typeof responseFor>[0];
    }[])[0].request;
    const response = path.join(root, 'response.json');
    await writeFile(response, JSON.stringify(responseFor(packet)));
    const issued = await readFile(file, 'utf8');
    await researchCli(['import-packet', '--store', root, '--input', response], { output, fetch });
    expect(await readFile(file, 'utf8')).toBe(issued);
    await researchCli(['import-packet', '--store', root, '--input', response, '--write'], { output, fetch });
    const store = await createFileResearchStore(root), job = (await store.list()).items[0];
    expect(job.state).toBe('needs_review');
    await researchCli(['review', '--store', root, '--job', job.jobId], { output, fetch });
    await researchCli(['coverage', '--store', root], { output, fetch });
    expect(fetch).not.toHaveBeenCalled();
});
it('refuses fdc-api without --live and writes without --store; curated manifest remains empty', async () => {
    const fetch = vi.fn();
    await expect(researchCli(['run', '--source', 'fdc-api'], { output, fetch })).rejects.toThrow('--live');
    await expect(researchCli(['plan', '--write'], { output, fetch })).rejects.toThrow('--store');
    expect(fetch).not.toHaveBeenCalled();
    const manifest = JSON.parse(await readFile('public/shared/nutrition/catalog/nutrition-curated/manifest.json', 'utf8'));
    expect(manifest.profileCount).toBe(0);
});
it('retry requires a job, previews without persistence, and only --write requeues blocked jobs', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--max', '1', '--write', '--store', root], { output, fetch });
    const store = await createFileResearchStore(root), job = (await store.list()).items[0];
    const blocked = transition(job, 'blocked', { blocked: { code: 'match_not_found', needs: 'fix table' }, match: { sourceId: 'obsolete' } });
    await store.save(blocked, { expectedVersion: job.version });
    const file = path.join(root, 'jobs.json'), before = await readFile(file, 'utf8');
    await expect(researchCli(['retry', '--store', root], { output, fetch })).rejects.toThrow('--job');
    const preview = await researchCli(['retry', '--job', job.jobId, '--store', root], { output, fetch }) as { dryRun: boolean; job: typeof job };
    expect(preview.dryRun).toBe(true);
    expect(preview.job).toMatchObject({ state: 'queued', blocked: null, match: null });
    expect(await readFile(file, 'utf8')).toBe(before);
    await researchCli(['retry', '--job', job.jobId, '--store', root, '--write'], { output, fetch });
    expect(await store.get(job.jobId)).toMatchObject({ state: 'queued', blocked: null, match: null, version: blocked.version + 1 });
    await expect(researchCli(['retry', '--job', job.jobId, '--store', root, '--write'], { output, fetch })).rejects.toThrow('blocked job');
    expect(fetch).not.toHaveBeenCalled();
});
it('packet without --batch partitions persisted jobs by parent and uses their own pass IDs', async () => {
    const root = await dir();
    await researchCli(['plan', '--max', '1', '--fields', 'protein', '--write', '--store', root], { output });
    await researchCli(['plan', '--max', '1', '--fields', 'protein', '--write', '--store', root], { output });
    const store = await createFileResearchStore(root), before = (await store.list()).items;
    expect(new Set(before.map(j => j.parentBatchId)).size).toBe(2);
    const packets = await researchCli(['packet', '--store', root, '--write'], { output }) as { request: ResearchRequest }[];
    expect(packets).toHaveLength(2);
    for (const { request } of packets) {
        const jobs = await Promise.all(request.targets.map(t => store.get(t.targetId)));
        expect(new Set(jobs.map(j => j!.parentBatchId)).size).toBe(1);
        const passId = await passIdFor({ parentBatchId: jobs[0]!.parentBatchId!, adapter: 'assistant-packet', sourceRelease: request.requestId, purpose: request.purpose });
        expect(jobs.every(j => j!.passId === passId)).toBe(true);
    }
});
function offlineBulkAdapter(permit = 'CC0 fixture license') {
    const fetched: string[] = [];
    return {
        fetched,
        adapter: {
            id: 'fdc_bulk',
            scope: ['curated', 'private'] as ('curated' | 'private')[],
            runsIn: ['cli'] as 'cli'[],
            requiresSecret: false,
            release: async () => 'fixture',
            match: async () => null,
            fetch: async (id: string) => { fetched.push(id); return { fdcId: id }; },
            toSourceResult: async () => ({
                type: 'fdc', recordId: '9900001', dataType: 'Foundation', description: 'Synthetic apple',
                release: 'fixture-v1', accessedAt: '2026-11-06', permittedUse: permit, originalBasis: 'per_100g_edible',
                nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }],
            }),
        },
    };
}
it('curated --verify-source refetches through a deterministic adapter and never attests', async () => {
    const f = await packetFixture();
    f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    f.response.results[0].unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    const disk = await createFileResearchStore(root);
    await disk.save(accepted, { expectedVersion: 0 });
    const file = path.join(root, 'jobs.json'), before = await readFile(file, 'utf8');
    await expect(researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1', '--reviewer', 'should-not-attest'], { output, fetch })).rejects.toThrow('Pinned bulk record not indexed');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await disk.get(accepted.jobId))?.proposal?.sourceVerification?.s1?.status).toBe('unverified');
    const offline = offlineBulkAdapter();
    const preview = await researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1'], { output, fetch, fdcBulkAdapter: offline.adapter }) as ResearchJob;
    expect(offline.fetched).toEqual(['9900001']);
    expect(preview.proposal?.sourceVerification?.s1).toMatchObject({ status: 'verified', method: 'deterministic_refetch' });
    const sourceKey = preview.proposal!.assistantSourceKeys!.s1;
    expect(preview.proposal!.revisionDraft!.sources[sourceKey].permittedUse).toBe('CC0 fixture license');
    expect(preview.validation?.isValid).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(before);
    await researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1', '--write'], { output, fetch, fdcBulkAdapter: offline.adapter });
    const saved = await disk.get(accepted.jobId);
    expect(saved?.proposal?.sourceVerification?.s1?.method).toBe('deterministic_refetch');
    expect(saved?.proposal?.revisionDraft?.sources[sourceKey].permittedUse).toBe('CC0 fixture license');
    expect(saved?.validation?.errors?.some((error: string) => error.includes('unresolved permittedUse'))).toBe(false);
    const warnings = saved!.validation?.warnings || [];
    const approveArgs = ['review', '--store', root, '--job', accepted.jobId, '--decide', 'approve', '--reviewer', 'reviewer', '--hash', await reviewContentHash(saved!), '--write'];
    if (warnings.length)
        approveArgs.push('--ack', warnings.join('|'));
    const approved = await researchCli(approveArgs, { output, fetch, fdcBulkAdapter: offline.adapter }) as ResearchJob;
    expect(approved.state).toBe('approved');
    expect(approved.review?.approvedContentHash).toBe(await reviewContentHash(saved!));
    vi.stubEnv('FDC_API_KEY', '');
    await expect(researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1', '--source', 'fdc-api'], { output, fetch, fdcBulkAdapter: offline.adapter })).rejects.toThrow('--live');
    await expect(researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1', '--source', 'fdc-api', '--live'], { output, fetch, fdcBulkAdapter: offline.adapter })).rejects.toThrow('FDC_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
});
it('runs and validates a multi-job batch with --write without losing the store lock', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--max', '3', '--fields', 'protein', '--write', '--store', root], { output, fetch });
    const store = await createFileResearchStore(root);
    const planned = (await store.list()).items;
    expect(planned.length).toBe(3);
    const ran = await researchCli(['run', '--source', 'fdc-bulk', '--store', root, '--write'], { output, fetch }) as ResearchJob[];
    expect(ran).toHaveLength(3);
    expect(ran.every(j => j.state === 'blocked')).toBe(true);
    const validated = await researchCli(['validate', '--store', root, '--write'], { output, fetch }) as { jobId: string }[];
    expect(validated).toHaveLength(3);
    const saved = (await store.list()).items;
    expect(saved).toHaveLength(3);
    expect(saved.every(j => j.validation)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
});
it('requires exactly one --job when run --input is set', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--max', '2', '--fields', 'protein', '--write', '--store', root], { output, fetch });
    const store = await createFileResearchStore(root);
    const jobs = (await store.list()).items;
    expect(jobs).toHaveLength(2);
    const input = path.join(root, 'apple.json');
    await writeFile(input, JSON.stringify({ recordId: 'apple', originalBasis: 'per_100g_edible', nutrients: { protein: 2 } }));
    const manual = path.join(root, 'manual.json');
    await writeFile(manual, JSON.stringify({ recordId: 'apple', source: { type: 'manual' }, nutrients: { protein: { value: 2, unit: 'g', status: 'measured' } } }));
    await expect(researchCli(['run', '--source', 'label', '--input', input, '--store', root, '--write'], { output, fetch })).rejects.toThrow('--input requires exactly one --job');
    await expect(researchCli(['run', '--source', 'manual', '--input', manual, '--batch', jobs[0].parentBatchId ?? '', '--store', root], { output, fetch })).rejects.toThrow('--input requires exactly one --job');
    expect((await store.list()).items.every(j => j.state === 'queued')).toBe(true);
    const ran = await researchCli(['run', '--source', 'label', '--input', input, '--job', jobs[0].jobId, '--store', root, '--write'], { output, fetch }) as ResearchJob[];
    expect(ran).toHaveLength(1);
    expect(ran[0].proposal?.revisionDraft?.nutrients?.protein).toBe(2);
    expect((await store.get(jobs[1].jobId))?.state).toBe('queued');
    expect(fetch).not.toHaveBeenCalled();
});
async function approvedCatalogJob(manifestId: string) {
    const staged = emptyStagedRecord();
    for (const key of V2_KEYS) {
        staged.values[key] = null;
        staged.quality[key] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    }
    staged.values.protein = 0.26;
    staged.quality.protein = { status: 'measured' };
    staged.values.calories = 52;
    staged.quality.calories = { status: 'measured' };
    const draft = await buildRevisionDraft({
        identityId: manifestId, variantId: manifestId, stagedRecord: staged,
        basis: { kind: 'per_100g_edible', state: 'raw' },
        fieldProvenance: { protein: { sourceKey: 'src-1' }, calories: { sourceKey: 'src-1' } },
        sources: { 'src-1': { type: 'fdc', datasetId: 'Foundation', recordId: '9900001', title: 'Fixture', version: 'fixture', accessedAt: '2026-11-06', permittedUse: 'CC0 1.0' } },
    });
    const conv = await buildConversion({
        variantRef: { refVersion: 1, scope: 'curated', namespace: 'catalog:' + CURATED_CATALOG_ID, identityId: manifestId, variantId: manifestId, revision: 1, revisionId: manifestId + '~r1', contentHash: draft.contentHash },
        kind: 'household', unit: 'cup', amount: 1, grams: 125, state: 'raw',
        source: { type: 'fdc', version: 'fixture', accessedAt: '2026-11-06', permittedUse: 'CC0 1.0' },
        confidence: 1,
    });
    const job = await createResearchJob({ target: { manifestId, canonicalName: 'Fixture food', category: 'fruit', kind: 'generic', dims: { state: 'raw' } }, sourceRelease: 'fixture' });
    job.proposal = { revisionDraft: draft, conversions: [conv], gaps: { carbs: 'not_reported_by_source' } };
    job.review = { checklistVersion: 1, decision: 'approve', reviewer: 'reviewer', reviewedAt: '2026-11-06T12:00:00Z', approvedContentHash: await reviewContentHash(job), acknowledgedWarnings: [] };
    job.state = 'approved';
    return job;
}
it('stages approved jobs and skips the others', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--max', '2', '--write', '--store', root], { output, fetch });
    await expect(researchCli(['stage', '--store', root], { output, fetch })).rejects.toThrow('No approved jobs to stage');
    const store = await createFileResearchStore(root);
    const approved = await approvedCatalogJob('stage-filter-fixture');
    await store.save(approved);
    const staged = await researchCli(['stage', '--store', root], { output, fetch }) as { records: { identity: { category: string; kind: string }; variant: { variantId: string } }[] };
    expect(staged.records.map(record => record.variant.variantId)).toEqual(['stage-filter-fixture']);
    expect(staged.records[0].identity).toMatchObject({ category: 'fruit', kind: 'generic' });
    expect(fetch).not.toHaveBeenCalled();
});
it('refuses stage --write into a non-empty --out', async () => {
    const root = await dir(), out = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await writeFile(path.join(out, 'manifest.json'), '{}\n');
    const store = await createFileResearchStore(root);
    await store.save(await approvedCatalogJob('stage-out-fixture'));
    await expect(researchCli(['stage', '--store', root, '--write', '--out', out], { output, fetch })).rejects.toThrow('non-empty --out');
    expect(await readFile(path.join(out, 'manifest.json'), 'utf8')).toBe('{}\n');
    const fresh = await dir();
    await researchCli(['stage', '--store', root, '--write', '--out', fresh], { output, fetch });
    expect(await readdir(fresh)).toContain('manifest.json');
    await expect(researchCli(['stage', '--store', root, '--write', '--out', fresh], { output, fetch })).rejects.toThrow('non-empty --out');
    expect(fetch).not.toHaveBeenCalled();
});
it('private --verify-source without --source keeps reviewer attestation', async () => {
    const f = await packetFixture({ scope: 'private' });
    const [accepted] = await f.service.acceptResponse(f.response);
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    const disk = await createFileResearchStore(root);
    await disk.save(accepted, { expectedVersion: 0 });
    const offline = offlineBulkAdapter();
    const attested = await researchCli(['review', '--store', root, '--job', accepted.jobId, '--verify-source', 's1', '--reviewer', 'pat', '--write'], { output, fetch, fdcBulkAdapter: offline.adapter }) as ResearchJob;
    expect(offline.fetched).toEqual([]);
    expect(attested.proposal?.sourceVerification?.s1).toMatchObject({ status: 'verified', method: 'reviewer_attestation', reviewer: 'pat' });
    const sourceKey = attested.proposal!.assistantSourceKeys!.s1;
    expect(attested.proposal!.revisionDraft!.sources[sourceKey].permittedUse).toBe('review_required');
    expect(fetch).not.toHaveBeenCalled();
});
it('treats a vite-node launch with a CLI command as the entry, and nothing else', () => {
    const script = path.resolve('scripts/nutrition/researchCli.ts');
    // vite-node removes the script path and a bare `--`, so its binary is argv[1].
    expect(isResearchCliEntry(['/usr/bin/node', '/repo/node_modules/.bin/vite-node', 'suggest', '--manifest-id', 'x'], script)).toBe(true);
    expect(isResearchCliEntry(['/usr/bin/node', '/repo/node_modules/vite-node/vite-node.mjs', '--', 'plan'], script)).toBe(true);
    expect(isResearchCliEntry(['/usr/bin/node', script, 'plan'], script)).toBe(true);
    // Another vite-node script importing this module, vitest, or a bare import does not run it.
    expect(isResearchCliEntry(['/usr/bin/node', '/repo/node_modules/.bin/vite-node'], script)).toBe(false);
    expect(isResearchCliEntry(['/usr/bin/node', '/repo/node_modules/.bin/vite-node', '--report'], script)).toBe(false);
    expect(isResearchCliEntry(['/usr/bin/node', '/repo/node_modules/vitest/vitest.mjs', 'run'], script)).toBe(false);
    expect(isResearchCliEntry(['/usr/bin/node'], script)).toBe(false);
});
