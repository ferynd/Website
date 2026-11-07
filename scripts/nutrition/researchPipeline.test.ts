import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readManifest, validateManifest, stateToDims, selectNextBatch } from './manifestReader';
import { readMatchTable, validateMatchTable } from './matchTable';
import { readPinnedBulk, indexBulk, createFdcBulkAdapter } from './fdcBulkReader';
import { createFileResearchStore, createFileSourceCache, assertLocalPath } from './fileResearchStore';
import { createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { createResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { coverageReport } from './coverageReport';
const temp: string[] = [];
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); vi.unstubAllGlobals(); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct62-')); temp.push(p); return p; }
const fixture = 'scripts/fixtures/nutrition/fdc/apple-bulk.json';
it('validates the 1114 queued identities without values, using the shared state vocabulary', async () => {
    const entries = await readManifest();
    expect(entries).toHaveLength(1114);
    expect(entries.every(e => !stateToDims(e.state).needsReview)).toBe(true);
    const bad = structuredClone(entries);
    Object.assign(bad[0], { nutrients: { protein: 2 } });
    expect(() => validateManifest({ schemaVersion: 1, entries: bad })).toThrow('values');
    expect(() => validateManifest({ schemaVersion: 1, entries: [entries[0], entries[0]] })).toThrow('Invalid manifest');
    expect(selectNextBatch(entries, [], {})).toHaveLength(25);
    expect(stateToDims('alien').needsReview).toBe(true);
});
it('ships an empty match table and requires reviewed unique matches or shared-source justification', async () => {
    expect(await readMatchTable()).toEqual([]);
    const raw = JSON.parse(await readFile('scripts/fixtures/nutrition/match-table-mini.json', 'utf8'));
    expect(await validateMatchTable(raw)).toHaveLength(4);
    raw.entries.push({ ...raw.entries[0] });
    await expect(validateMatchTable(raw)).rejects.toThrow('Duplicate');
    raw.entries[4].manifestId = 'other';
    await expect(validateMatchTable(raw)).rejects.toThrow('justification');
});
it('refuses unpinned/mismatched/unlabeled bulk files and caches a pinned synthetic fixture', async () => {
    const root = await dir(), food = JSON.parse(await readFile(fixture, 'utf8')), file = path.join(root, 'bulk.json');
    await writeFile(file, JSON.stringify({ foods: [food] }));
    const pin = { id: 'fixture', release: 'fixture-v1', sha256: null as string | null, fixtureOnly: true };
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('unpinned');
    pin.sha256 = 'sha256:' + '0'.repeat(64);
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('checksum');
    pin.sha256 = 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
    const cache = createMemorySourceCache();
    expect(await indexBulk(file, pin, cache)).toBe(1);
    const adapter = createFdcBulkAdapter({ cache, release: pin.release, matches: [] });
    expect((await adapter.fetch(String(food.fdcId))).fdcId).toBe(food.fdcId);
    delete food._fixture;
    await writeFile(file, JSON.stringify({ foods: [food] }));
    pin.sha256 = 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('unlabeled');
});
it('uses atomic file CAS, group validation, persistent source checksums and active locks', async () => {
    const root = await dir(), store = await createFileResearchStore(root), job = await createResearchJob({ target: { manifestId: 'synthetic', dims: { state: 'raw' } } });
    await store.save(job, { expectedVersion: 0 });
    await expect(store.save({ ...job, version: 2 }, { expectedVersion: 0 })).rejects.toThrow('Compare-and-swap');
    expect((await store.get(job.jobId))!.version).toBe(1);
    const second = await createResearchJob({ target: { manifestId: 'second' } });
    await expect(store.saveMany!([{ job: { ...job, version: 2 }, expectedVersion: 1 }, { job: second, expectedVersion: 5 }])).rejects.toThrow('Compare-and-swap');
    expect(await store.get(second.jobId)).toBeNull();
    expect((await store.get(job.jobId))!.version).toBe(1);
    const cache = await createFileSourceCache(root), fetch = vi.fn(async () => ({ synthetic: true }));
    await cache.getOrFetch('fixture', fetch);
    await (await createFileSourceCache(root)).getOrFetch('fixture', fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const sources = path.join(root, 'sources'), [name] = await readdir(sources);
    await writeFile(path.join(sources, name), JSON.stringify({ data: { changed: true }, checksum: 'sha256:' + '0'.repeat(64) }));
    await expect(cache.get('fixture')).rejects.toThrow('checksum');
    await writeFile(path.join(root, '.lock'), JSON.stringify({ pid: process.pid }));
    await expect(store.save({ ...job, version: 2 })).rejects.toThrow('locked');
});
it('rejects public paths including symlink aliases before creating files', async () => {
    await expect(assertLocalPath('public/research-out')).rejects.toThrow('outside public');
    const root = await dir();
    await symlink(path.resolve('public'), path.join(root, 'alias'));
    await expect(createFileResearchStore(path.join(root, 'alias', 'nested'))).rejects.toThrow('outside public');
});
it('aggregates every pass for a manifest id and keeps an approved profile beside a later blocked pass', () => {
    const entry = (id: string) => ({ id, name: id, category: 'fruit', kind: 'generic', state: 'raw', priority: 1, sourceStrategy: 'usda-first', status: 'queued' as const });
    const job = (id: string, state: 'approved' | 'blocked', quality: Record<string, { status: string; qualifier?: string }>) => ({
        scope: 'curated' as const,
        state,
        target: { manifestId: id, targetKind: 'catalog' as const, dims: { state: 'raw' as const } },
        attempts: [{ attemptId: 'a', adapter: 'manual', outcome: state === 'blocked' ? 'blocked' as const : 'success' as const, timestamp: '2026-11-06' }],
        requests: [],
        blocked: state === 'blocked' ? { code: 'match_not_found', needs: 'iodine source' } : null,
        proposal: { revisionDraft: { nutrientMeta: { quality } } },
    });
    const approved = job('apple', 'approved', { protein: { status: 'measured' }, iodine: { status: 'unknown', qualifier: 'gap:not_reported_by_source' } });
    const later = job('apple', 'blocked', { protein: { status: 'unknown', qualifier: 'gap:not_requested' }, iodine: { status: 'unknown', qualifier: 'gap:not_reported_by_source' } });
    const pear = job('pear', 'blocked', { protein: { status: 'unknown', qualifier: 'gap:not_reported_by_source' } });
    const report = coverageReport([entry('apple'), entry('pear')], [approved, later, pear] as unknown as ResearchJob[]);
    expect(report.json.groups.all.approved).toBe(1);
    expect(report.json.groups.all.blocked).toBe(1);
    expect(report.json.groups.all.remaining).toBe(1);
    expect(report.json.blocked.map(row => row.id)).toEqual(['pear']);
    expect(report.json.nutrients.protein.measured).toBe(1);
    expect(report.json.nutrients.protein.unknown).toBe(1);
    expect(report.json.nutrients.iodine.unknown).toBe(1);
    expect(report.markdown).toContain('1/2 approved');
    expect(report.markdown).not.toContain('apple: match_not_found');
});
it('serializes concurrent writers with CAS and never reports private jobs in public coverage', async () => {
    const root = await dir(), store = await createFileResearchStore(root), j = await createResearchJob({ target: { manifestId: 'synthetic' } });
    await store.save(j);
    const outcomes = await Promise.allSettled([store.save({ ...j, version: 2 }, { expectedVersion: 1 }), store.save({ ...j, version: 2 }, { expectedVersion: 1 })]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const privateJob = { ...j, scope: 'private' as const, ownerUid: 'secret' };
    const report = coverageReport(await readManifest(), [privateJob]);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(report.json.groups.all.total).toBe(1114);
});
it('does not import the operator-only API adapter from app/public', async () => {
    const walk = async (p: string): Promise<string[]> => { const list = await readdir(p, { withFileTypes: true }); const nested = await Promise.all(list.filter(e => e.name !== 'node_modules').map(e => e.isDirectory() ? walk(path.join(p, e.name)) : /\.[jt]sx?$/.test(e.name) ? [path.join(p, e.name)] : [])); return nested.flat(); };
    for (const file of [...await walk('app'), ...await walk('public/shared'), ...await walk('public/tools/CalorieTracker/services')])
        expect(await readFile(file, 'utf8')).not.toMatch(/from\s+['"][^'"]*fdcApiAdapter/);
});
it.each(['neither', 'first', 'second', 'both'])('checks shared FDC records across bulk/API transports with %s justifications', async which => {
    const raw = JSON.parse(await readFile('scripts/fixtures/nutrition/match-table-mini.json', 'utf8'));
    const first = { ...raw.entries[0] }, second = { ...first, manifestId: 'other-identity', adapter: 'fdc_api' };
    if (which === 'first' || which === 'both') first.sharedJustification = 'Reviewed shared record';
    if (which === 'second' || which === 'both') second.sharedJustification = 'Reviewed shared record';
    const table = { schemaVersion: 1, entries: [first, second] };
    if (which === 'both') expect(await validateMatchTable(table)).toHaveLength(2);
    else await expect(validateMatchTable(table)).rejects.toThrow('Shared FDC record requires justification');
    // A distinct release is separate evidence.
    second.release += '-next';
    expect(await validateMatchTable(table)).toHaveLength(2);
});
