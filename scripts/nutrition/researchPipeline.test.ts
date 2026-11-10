import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readManifest, validateManifest, stateToDims, selectNextBatch } from './manifestReader';
import { readMatchTable, validateMatchTable } from './matchTable';
import { readPinnedBulk, auditPinnedBulk, indexBulk, createFdcBulkAdapter } from './fdcBulkReader';
import { createFileResearchStore, createFileSourceCache, assertLocalPath } from './fileResearchStore';
import { createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { createResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { coverageReport } from './coverageReport';
import { RESEARCH_CONFIG } from './researchConfig';
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
it('indexes a synthetic SRLegacyFoods-shaped release and keeps the pin, label, duplicate, and parser checks', async () => {
    const root = await dir(), file = path.join(root, 'sr-legacy.json');
    const legacy = async (name: string) => ({ ...JSON.parse(await readFile(`scripts/fixtures/nutrition/fdc/${name}`, 'utf8')), dataType: 'SR Legacy' });
    const foods = [await legacy('legume-bulk.json'), await legacy('oil-bulk.json')];
    const write = async (body: unknown) => { await writeFile(file, JSON.stringify(body)); return 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex'); };
    const pin = { id: 'sr-legacy', release: 'fixture-sr-v1', sha256: await write({ _fixture: 'synthetic; not nutrition data', SRLegacyFoods: foods }), fixtureOnly: true };
    const cache = createMemorySourceCache();
    expect(await indexBulk(file, pin, cache)).toBe(2);
    for (const food of foods)
        expect((await cache.get(`fdc_bulk:${pin.release}:${food.fdcId}`))!.data.fdcId).toBe(food.fdcId);
    const adapter = createFdcBulkAdapter({ cache, release: pin.release, matches: [] });
    expect((await adapter.fetch(String(foods[1].fdcId))).dataType).toBe('SR Legacy');
    // The new key does not relax any other check.
    await writeFile(file, JSON.stringify({ _fixture: 'synthetic; not nutrition data', SRLegacyFoods: foods, extra: 1 }));
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('checksum');
    pin.sha256 = await write({ _fixture: 'synthetic; not nutrition data', SRLegacyFoods: [foods[0], foods[0]] });
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('Duplicate');
    pin.sha256 = await write({ SRLegacyFoods: foods.map(food => { const unlabeled = { ...food }; delete unlabeled._fixture; return unlabeled; }) });
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('unlabeled');
    const malformed = JSON.parse(await readFile('scripts/fixtures/nutrition/fdc/malformed-string-amount.json', 'utf8'));
    pin.sha256 = await write({ _fixture: 'synthetic; not nutrition data', SRLegacyFoods: [malformed] });
    await expect(readPinnedBulk(file, pin)).rejects.toThrow();
    pin.sha256 = await write({ _fixture: 'synthetic; not nutrition data', SRLegacyFood: foods });
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('Invalid bulk food array');
});
it('audits a mixed bulk file per record, value-free, while the strict reader still aborts', async () => {
    const root = await dir(), file = path.join(root, 'mixed.json');
    const load = async (name: string) => JSON.parse(await readFile(`scripts/fixtures/nutrition/fdc/${name}`, 'utf8'));
    const legume = await load('legume-bulk.json'), oil = await load('oil-bulk.json');
    // Sentinels: neither the description nor any nutrient amount may surface in the audit.
    const negative = { ...structuredClone(oil), fdcId: 9900777, description: 'SENTINEL-DESCRIPTION-q7x', foodNutrients: [
        { nutrient: { id: 1008, number: '208', name: 'Energy', unitName: 'kcal' }, amount: 987.654 },
        { nutrient: { id: 1005, number: '205', name: 'Carbohydrate, by difference', unitName: 'g' }, amount: -0.4321 },
    ] };
    const duplicate = { ...structuredClone(legume), description: 'SENTINEL-DUPLICATE-q7x' };
    const write = async (body: unknown) => { await writeFile(file, JSON.stringify(body)); return 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex'); };
    const pin = { id: 'fixture', release: 'fixture-audit-v1', sha256: await write({ _fixture: 'synthetic; not nutrition data', FoundationFoods: [legume, negative, oil, duplicate] }), fixtureOnly: true };
    const audit = await auditPinnedBulk(file, pin);
    const negativeCategory = 'Non-numeric amount for nutrient N in fdcId N: N';
    expect(audit).toMatchObject({ total: 4, parsedCount: 2, duplicateCount: 1 });
    expect(audit.foods.map(f => f.fdcId)).toEqual([legume.fdcId, oil.fdcId]);
    expect(audit.failures).toEqual([{ fdcId: 9900777, category: negativeCategory }, { fdcId: legume.fdcId, category: 'duplicate_fdc_id' }]);
    expect(audit.failureCategories).toEqual({ [negativeCategory]: 1, duplicate_fdc_id: 1 });
    const json = JSON.stringify({ ...audit, foods: undefined });
    for (const sentinel of ['SENTINEL', 'q7x', '987', '654', '4321'])
        expect(json).not.toContain(sentinel);
    expect(JSON.stringify(audit)).not.toContain('SENTINEL');
    // The strict path is unchanged: the same file still aborts.
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('Non-numeric amount');
    // Checksum enforcement, unpinned refusal, and the top-level shape still throw.
    await writeFile(file, JSON.stringify({ _fixture: 'synthetic; not nutrition data', FoundationFoods: [legume], extra: 1 }));
    await expect(auditPinnedBulk(file, pin)).rejects.toThrow('checksum');
    await expect(auditPinnedBulk(file, { ...pin, sha256: null })).rejects.toThrow('unpinned');
    pin.sha256 = await write({ _fixture: 'synthetic; not nutrition data', FoundationFood: [legume] });
    await expect(auditPinnedBulk(file, pin)).rejects.toThrow('Invalid bulk food array');
    // Unlabeled records are per-record failures under a fixture-only pin (no label rule otherwise),
    // a non-numeric string amount is redacted from its category, and an absent fdcId reports null.
    const unlabeled = { ...structuredClone(oil), fdcId: 9900778 };
    delete unlabeled._fixture;
    const malformed = await load('malformed-string-amount.json');
    const noId = structuredClone(legume);
    delete noId.fdcId;
    pin.sha256 = await write([legume, unlabeled, malformed, noId]);
    const labelled = await auditPinnedBulk(file, pin);
    expect(labelled).toMatchObject({ total: 4, parsedCount: 1, duplicateCount: 0 });
    expect(labelled.failures).toEqual([
        { fdcId: 9900778, category: 'Fixture-only reader refuses unlabeled data' },
        { fdcId: malformed.fdcId, category: 'Non-numeric amount for nutrient N in fdcId N: <redacted>' },
        { fdcId: null, category: 'Invalid or missing fdcId: undefined' },
    ]);
    expect(JSON.stringify(labelled.failures)).not.toContain('invalid-string');
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('unlabeled');
    const open = await auditPinnedBulk(file, { ...pin, fixtureOnly: false });
    expect(open.parsedCount).toBe(2);
    expect(open.foods.map(f => f.fdcId)).toEqual([legume.fdcId, 9900778]);
});
it('pins the Foundation and SR Legacy bulk releases in the exact format readPinnedBytes demands', async () => {
    const pinFormat = /^sha256:[a-f0-9]{64}$/;
    const byId = Object.fromEntries(RESEARCH_CONFIG.datasets.map(d => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual(['foundation', 'sr-legacy']);
    expect(byId.foundation).toMatchObject({ dataType: 'Foundation', release: '2026-10-29', fixtureOnly: false, fileName: 'FoodData_Central_foundation_food_json_2026-10-29.json' });
    expect(byId['sr-legacy']).toMatchObject({ dataType: 'SR Legacy', release: '2018-04', fixtureOnly: false, fileName: 'FoodData_Central_sr_legacy_food_json_2018-04.json' });
    for (const d of RESEARCH_CONFIG.datasets) {
        expect(d.sha256).toMatch(pinFormat);
        expect(d.archiveSha256).toMatch(pinFormat);
        expect(d.archiveSha256).not.toBe(d.sha256);
        expect(d.downloadUrl).toBe(`https://fdc.nal.usda.gov/fdc-datasets/${d.fileName.replace(/\.json$/, '.zip')}`);
    }
    // A wrong file never passes the live pin, and no API key lives in configuration.
    const root = await dir(), file = path.join(root, 'not-the-release.json');
    await writeFile(file, JSON.stringify({ SRLegacyFoods: [] }));
    await expect(readPinnedBulk(file, byId['sr-legacy'])).rejects.toThrow('checksum');
    expect(JSON.stringify(RESEARCH_CONFIG)).not.toMatch(/api[_-]?key|FDC_API_KEY/i);
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
