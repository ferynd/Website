import { it, expect, describe, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCatalogShards } from '../../public/shared/nutrition/ingredientCatalog.js';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
import { CURATED_CATALOG_ID } from '../../public/shared/nutrition/ingredientIds.js';
import { emptyStagedRecord, V2_KEYS } from '../../public/shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../public/shared/nutrition/ingredientProfile.js';
import { buildConversion } from '../../public/shared/nutrition/ingredientConversion.js';
import { createResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { reviewContentHash } from '../../public/shared/nutrition/research/researchReview.js';
import { stageCatalog } from '../../public/shared/nutrition/research/stagedCatalog.js';
import {
    verifyCatalog, verifyAppendOnly, mergeCatalogRecords, combineCatalogs, readCatalogDirectory, catalogBucket, type CatalogInput,
} from './catalogIntegrity';
import { main, CatalogIntegrityCliError, DEFECTS_FOUND } from './catalogIntegrityCli';

const SHIPPED_DIR = 'public/shared/nutrition/catalog/nutrition-curated';
const temp: string[] = [];
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct63-v4-')); temp.push(p); return p; }

/** Synthetic catalog record in the shape toCatalogRecord produces; not nutrition data. */
function record(variantId: string, canonicalName: string, { revisions = 1, aliases = [] as string[] } = {}) {
    const hash = (n: number) => 'sha256:' + (variantId.length.toString(16) + n.toString(16)).padEnd(64, 'a');
    const revs = Array.from({ length: revisions }, (_, i) => ({ revision: i + 1, revisionId: `${variantId}~r${i + 1}`, contentHash: hash(i + 1), _fixture: 'synthetic' }));
    return {
        identity: { canonicalName, category: 'other', kind: 'generic', aliases },
        variant: { variantId, identityId: variantId, dims: { state: 'raw' }, headRevision: revisions, headRevisionId: `${variantId}~r${revisions}`, headContentHash: hash(revisions) },
        revisions: revs,
        conversions: [],
        research: { jobIds: [], passIds: [], gaps: {}, licenses: [], reviewer: 'fixture', checklistVersion: 1 },
    };
}
const build = (records: unknown[]): Promise<CatalogInput> => buildCatalogShards([...records].sort((a: any, b: any) => a.variant.variantId.localeCompare(b.variant.variantId)));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const codes = (defects: string[]) => defects.map(d => d.split(':')[0]);
const fileFor = (c: CatalogInput, kind: 'variantShards' | 'searchShards', id: string) => c.manifest[kind][catalogBucket(id)].file as string;
const sameBytes = (a: CatalogInput, b: CatalogInput) => {
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
    expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
    for (const f of Object.keys(a.files))
        expect(canonicalJson(a.files[f])).toBe(canonicalJson(b.files[f]));
};
const APPLE = () => record('apple-raw', 'Apple, raw', { aliases: ['fresh apple'] });
const OLIVE = () => record('olive-oil', 'Olive oil', { revisions: 2 });
const SALT = () => record('salt-table', 'Salt, table');

describe('verifyCatalog (#63 V4)', () => {
    it('verifies a valid two-record catalog with 0 defects and correct counts', async () => {
        const c = await build([APPLE(), OLIVE()]);
        const s = await verifyCatalog(c);
        expect(s.defects).toEqual([]);
        expect(s).toMatchObject({ profileCount: 2, variantIds: ['apple-raw', 'olive-oil'], revisionCount: 3 });
        expect(s.variantShardCount).toBe(Object.keys(c.manifest.variantShards).length);
        expect(s.searchShardCount).toBe(Object.keys(c.manifest.searchShards).length);
        expect(s.searchEntryCount).toBe(Object.values(c.manifest.searchShards).reduce((n: number, e: any) => n + (c.files[e.file] as unknown[]).length, 0));
    });
    it('verifies the empty catalog', async () => {
        expect(await verifyCatalog(await build([]))).toMatchObject({ profileCount: 0, searchEntryCount: 0, defects: [] });
    });
    it('flags tampered shard content', async () => {
        const c = await build([APPLE(), OLIVE()]);
        (c.files[fileFor(c, 'variantShards', 'apple-raw')] as any[])[0].identity.canonicalName = 'Changed';
        expect(codes((await verifyCatalog(c)).defects)).toContain('shard_hash_mismatch');
    });
    it('flags a manifest hash that disagrees with the filename, a missing shard, and a bad manifest', async () => {
        const c = await build([APPLE()]);
        const entry = c.manifest.variantShards[catalogBucket('apple-raw')];
        const renamed = clone(c);
        renamed.manifest.variantShards[catalogBucket('apple-raw')].file = entry.file.replace(/\.[a-f0-9]{64}\.json$/, '.' + 'b'.repeat(64) + '.json');
        renamed.files[renamed.manifest.variantShards[catalogBucket('apple-raw')].file] = renamed.files[entry.file];
        delete renamed.files[entry.file];
        expect(codes((await verifyCatalog(renamed)).defects)).toContain('shard_filename_hash_mismatch');
        const missing = clone(c);
        delete missing.files[entry.file];
        expect(codes((await verifyCatalog(missing)).defects)).toContain('shard_missing');
        const bad = clone(c);
        bad.manifest.catalogId = 'other';
        expect(codes((await verifyCatalog(bad)).defects)).toContain('manifest_schema');
    });
    it('flags a wrong manifest profileCount', async () => {
        const c = await build([APPLE(), OLIVE()]);
        c.manifest.profileCount = 3;
        expect(codes((await verifyCatalog(c)).defects)).toContain('profile_count_mismatch');
    });
    it('flags the same variantId twice across hand-assembled variant shards', async () => {
        const c = await build([APPLE()]);
        const file = fileFor(c, 'variantShards', 'apple-raw');
        (c.files[file] as unknown[]).push(APPLE());
        const s = await verifyCatalog(c);
        expect(s.defects).toContain('duplicate_variant:apple-raw');
        expect(s.profileCount).toBe(1);
    });
    it('flags a record in the wrong variant bucket', async () => {
        const c = await build([APPLE(), OLIVE()]);
        const apple = c.files[fileFor(c, 'variantShards', 'apple-raw')] as unknown[];
        (c.files[fileFor(c, 'variantShards', 'olive-oil')] as unknown[]).push(apple.pop());
        expect(codes((await verifyCatalog(c)).defects)).toContain('variant_bucket_mismatch');
    });
    it('flags a search entry pointing at a missing variant', async () => {
        const c = await build([APPLE(), OLIVE()]);
        const file = fileFor(c, 'searchShards', 'apple');
        (c.files[file] as any[])[0].variantId = 'ghost-food';
        expect((await verifyCatalog(c)).defects).toContain('search_unknown_variant:ghost-food');
    });
    it('flags a search entry whose ref is not the variant head', async () => {
        const c = await build([APPLE()]);
        (c.files[fileFor(c, 'searchShards', 'apple')] as any[])[0].ref.revision = 7;
        expect((await verifyCatalog(c)).defects).toContain('search_ref_mismatch:apple-raw');
    });
    it('flags a variant with no search entry', async () => {
        const c = await build([APPLE(), OLIVE()]);
        for (const entry of Object.values(c.manifest.searchShards) as any[])
            c.files[entry.file] = (c.files[entry.file] as any[]).filter(e => e.variantId !== 'olive-oil');
        const defects = (await verifyCatalog(c)).defects;
        expect(defects).toContain('search_missing_variant:olive-oil');
        expect(defects).not.toContain('search_missing_variant:apple-raw');
    });
    it('flags a record whose head revision is absent or disagrees', async () => {
        const absent = APPLE();
        absent.revisions = [];
        expect((await verifyCatalog(await build([absent]))).defects).toContain('head_revision_missing:apple-raw');
        const wrong = OLIVE();
        wrong.revisions[1].contentHash = 'sha256:' + 'c'.repeat(64);
        expect((await verifyCatalog(await build([wrong]))).defects).toContain('head_revision_mismatch:olive-oil');
    });
    it('flags an orphan unreferenced file', async () => {
        const c = await build([APPLE()]);
        c.files['variants/zz.' + 'd'.repeat(64) + '.json'] = [];
        expect(codes((await verifyCatalog(c)).defects)).toContain('orphan_file');
    });
    it('flags a dropped search shard through the rebuild check', async () => {
        const c = await build([APPLE(), OLIVE()]);
        const [bucket, entry] = Object.entries(c.manifest.searchShards).find(([b]) => b === catalogBucket('fresh'))! as [string, any];
        delete c.manifest.searchShards[bucket];
        delete c.files[entry.file];
        expect((await verifyCatalog(c)).defects).toContain('rebuild_mismatch:catalog');
    });
    it('reports ids and codes only, never record content', async () => {
        const c = await build([APPLE()]);
        (c.files[fileFor(c, 'variantShards', 'apple-raw')] as any[])[0].identity.canonicalName = 'SECRET-NAME';
        expect(JSON.stringify(await verifyCatalog(c))).not.toContain('SECRET-NAME');
    });
});

describe('verifyAppendOnly (#63 V4)', () => {
    it('accepts the first catalog plus one new record', async () => {
        const first = await build([APPLE(), OLIVE()]);
        const next = await build([APPLE(), OLIVE(), SALT()]);
        expect(await verifyAppendOnly(first, next)).toEqual({ added: ['salt-table'], preserved: 2, defects: [] });
    });
    it('flags a dropped previous profile', async () => {
        const result = await verifyAppendOnly(await build([APPLE(), OLIVE()]), await build([APPLE(), SALT()]));
        expect(result.defects).toContain('dropped_profile:olive-oil');
        expect(result.defects).toContain('dropped_search_entry:ol:olive-oil');
        expect(result.added).toEqual(['salt-table']);
        expect(result.preserved).toBe(1);
    });
    it('flags a previous record whose revision content changed', async () => {
        const altered = OLIVE();
        (altered.revisions[0] as any)._fixture = 'synthetic changed';
        const result = await verifyAppendOnly(await build([APPLE(), OLIVE()]), await build([APPLE(), altered]));
        expect(result.defects).toEqual(['changed_profile:olive-oil']);
        expect(result.preserved).toBe(1);
    });
    it('includes each side\'s own defects, prefixed', async () => {
        const broken = await build([APPLE()]);
        broken.manifest.profileCount = 5;
        const result = await verifyAppendOnly(broken, await build([APPLE()]));
        expect(result.defects).toContain('previous:profile_count_mismatch:manifest');
    });
});

describe('mergeCatalogRecords and combineCatalogs (#63 V4)', () => {
    it('dedupes an identical duplicate and sorts by variantId', () => {
        const merged = mergeCatalogRecords([OLIVE(), APPLE()], [APPLE(), SALT()]);
        expect(merged.map((r: any) => r.variant.variantId)).toEqual(['apple-raw', 'olive-oil', 'salt-table']);
    });
    it('throws on a conflicting duplicate instead of overwriting', () => {
        const changed = APPLE();
        changed.identity.canonicalName = 'Apple, changed';
        expect(() => mergeCatalogRecords([APPLE()], [changed])).toThrow(/Catalog record conflict: apple-raw/);
        expect(() => mergeCatalogRecords([APPLE(), changed], [])).toThrow(TypeError);
    });
    it('is idempotent: combine(combine(A, B), B) equals combine(A, B), and combine(A, empty) equals A', async () => {
        const a = await build([APPLE(), OLIVE()]);
        const b = await build([SALT()]);
        const ab = await combineCatalogs(a, b);
        expect((await verifyCatalog(ab)).profileCount).toBe(3);
        expect(await verifyAppendOnly(a, ab)).toEqual({ added: ['salt-table'], preserved: 2, defects: [] });
        sameBytes(await combineCatalogs(ab, b), ab);
        sameBytes(await combineCatalogs(a, await buildCatalogShards([])), a);
        sameBytes(await combineCatalogs(await buildCatalogShards([]), a), a);
    });
    it('throws when a new batch conflicts with a published profile', async () => {
        const changed = OLIVE();
        changed.revisions[0].contentHash = 'sha256:' + 'e'.repeat(64);
        await expect(combineCatalogs(await build([APPLE(), OLIVE()]), await build([changed]))).rejects.toThrow(/olive-oil/);
    });
    it('refuses to combine a catalog that has defects', async () => {
        const broken = await build([APPLE()]);
        broken.manifest.profileCount = 2;
        await expect(combineCatalogs(broken, await build([SALT()]))).rejects.toThrow(/previous catalog with defects/);
    });
});

/** The job factory from public/tools/CalorieTracker/nutrition/researchStaged.test.js; synthetic values. */
async function makeApprovedCuratedJob({ manifestId = 'apple-raw-with-skin', canonicalName = 'Apple, raw, with skin', category = 'fruits-fruit-juices', protein = 0.26, calories = 52 } = {}) {
    const staged = emptyStagedRecord();
    for (const k of V2_KEYS) {
        staged.values[k] = null;
        staged.quality[k] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    }
    staged.values.protein = protein;
    staged.quality.protein = { status: 'measured' };
    staged.values.calories = calories;
    staged.quality.calories = { status: 'measured' };
    const draft = await buildRevisionDraft({
        identityId: manifestId, variantId: manifestId, basis: { kind: 'per_100g_edible', state: 'raw' }, stagedRecord: staged,
        fieldProvenance: { protein: { sourceKey: 'src-1' }, calories: { sourceKey: 'src-1' } },
        sources: { 'src-1': { type: 'fdc', datasetId: 'Foundation', recordId: '9900001', title: 'Synthetic fixture', version: '2024-10-31', accessedAt: '2026-11-06', permittedUse: 'CC0 1.0' } },
    } as never);
    const conv = await buildConversion({
        schemaVersion: 1,
        variantRef: { refVersion: 1, scope: 'curated', namespace: 'catalog:' + CURATED_CATALOG_ID, identityId: manifestId, variantId: manifestId, revision: 1, revisionId: `${manifestId}~r1`, contentHash: draft.contentHash },
        kind: 'household', unit: 'cup', unitQualifier: 'sliced', amount: 1, grams: 125, state: 'raw',
        source: { type: 'fdc', version: '2024-10-31', accessedAt: '2026-11-06', permittedUse: 'CC0 1.0' }, confidence: 1,
    } as never);
    const job: any = await createResearchJob({
        scope: 'curated', targetKind: 'catalog', target: { manifestId, canonicalName, category, dims: { state: 'raw' }, aliases: ['fresh ' + manifestId.split('-')[0]] },
        sourceRelease: '2024-10-31', state: 'needs_review',
    } as never);
    job.proposal = { revisionDraft: draft, conversions: [conv], gaps: { carbs: 'not_reported_by_source' } };
    job.review = { checklistVersion: 1, decision: 'approve', reviewer: 'fixture', reviewedAt: '2026-11-06T12:00:00Z', approvedContentHash: await reviewContentHash(job), acknowledgedWarnings: [] };
    job.state = 'approved';
    return job;
}

describe('cumulative staging over stageCatalog (#63 V4)', () => {
    it('stages two batches separately, combines them, and keeps batch 1 intact', async () => {
        const batch1 = await stageCatalog([
            await makeApprovedCuratedJob({ manifestId: 'apple-raw-with-skin', canonicalName: 'Apple, raw, with skin' }),
            await makeApprovedCuratedJob({ manifestId: 'olive-oil-extra-virgin', canonicalName: 'Olive oil, extra virgin', calories: 884, protein: 0 }),
        ]);
        const batch2 = await stageCatalog([await makeApprovedCuratedJob({ manifestId: 'lentils-dry', canonicalName: 'Lentils, dry', calories: 350, protein: 25 })]);
        // stageCatalog is per-batch: batch 2 alone holds only its own profile.
        expect(batch2.manifest.profileCount).toBe(1);
        const one = { manifest: batch1.manifest, files: batch1.files }, two = { manifest: batch2.manifest, files: batch2.files };
        expect((await verifyCatalog(one)).defects).toEqual([]);
        const combined = await combineCatalogs(one, two);
        expect(combined.manifest.profileCount).toBe(3);
        expect((await verifyCatalog(combined)).defects).toEqual([]);
        expect(await verifyAppendOnly(one, combined)).toEqual({ added: ['lentils-dry'], preserved: 2, defects: [] });
        // A rerun of batch 2 changes nothing.
        sameBytes(await combineCatalogs(combined, two), combined);
        // Staging batch 2 on its own and publishing it would drop batch 1.
        expect((await verifyAppendOnly(one, two)).defects).toEqual(expect.arrayContaining(['dropped_profile:apple-raw-with-skin', 'dropped_profile:olive-oil-extra-virgin']));
    });
});

describe('shipped catalog (#63 V4)', () => {
    it('verifies the published catalog and is append-only against itself', async () => {
        const shipped = await readCatalogDirectory(SHIPPED_DIR);
        const s = await verifyCatalog(shipped);
        expect(s.defects).toEqual([]);
        // 14 A1 profiles plus 15 A2 profiles (#63-A-2).
        expect(s.profileCount).toBe(29);
        expect(s.variantIds).toHaveLength(29);
        expect(await verifyAppendOnly(shipped, shipped)).toEqual({ added: [], preserved: 29, defects: [] });
        sameBytes(await combineCatalogs(shipped, await buildCatalogShards([])), shipped);
    });
});

async function writeCatalog(root: string, c: CatalogInput) {
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(c.manifest));
    for (const [file, data] of Object.entries(c.files)) {
        await mkdir(path.join(root, path.dirname(file)), { recursive: true });
        await writeFile(path.join(root, file), JSON.stringify(data));
    }
    return root;
}

describe('catalogIntegrityCli (#63 V4)', () => {
    it('verifies the shipped catalog by default and prints counts only', async () => {
        let out = '';
        const summary = await main(['node', 'cli'], { write: t => { out += t; } });
        expect(summary).toMatchObject({ profileCount: 29, defects: [] });
        expect(JSON.parse(out)).not.toHaveProperty('variantIds');
    });
    it('checks --previous/--next and --combine without writing, and fails on defects', async () => {
        const prev = await writeCatalog(await dir(), await build([APPLE(), OLIVE()]));
        const next = await writeCatalog(await dir(), await build([APPLE(), OLIVE(), SALT()]));
        const batch = await writeCatalog(await dir(), await build([SALT()]));
        const quiet = { write: () => {} };
        expect(await main(['node', 'cli', '--', '--previous', prev, '--next', next], quiet)).toMatchObject({ append: { added: ['salt-table'], preserved: 2, defects: [] } });
        expect(await main(['node', 'cli', '--', '--combine', prev, batch], quiet)).toMatchObject({ combined: { profileCount: 3, defects: [] }, append: { added: 1, preserved: 2 } });
        let out = '';
        await expect(main(['node', 'cli', '--', '--previous', next, '--next', prev], { write: t => { out += t; } })).rejects.toThrow(DEFECTS_FOUND);
        expect(out).toContain('dropped_profile:salt-table');
    });
    it('rejects bad usage and unreadable directories with a CLI error', async () => {
        await expect(main(['node', 'cli', '--', '--previous', 'x'], {})).rejects.toBeInstanceOf(CatalogIntegrityCliError);
        await expect(main(['node', 'cli', '--', '--combine', 'x'], {})).rejects.toBeInstanceOf(CatalogIntegrityCliError);
        await expect(main(['node', 'cli', '--', '--previous', path.join(await dir(), 'none'), '--next', path.join(await dir(), 'none')], {})).rejects.toThrow('could not be read');
    });
    it('does not open manifest paths outside the shard pattern', async () => {
        const root = await dir();
        const c = await build([APPLE()]);
        await writeCatalog(root, c);
        const manifest = clone(c.manifest);
        manifest.variantShards[catalogBucket('apple-raw')].file = '../../outside.json';
        await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
        const read = await readCatalogDirectory(root);
        expect(Object.keys(read.files)).not.toContain('../../outside.json');
        expect(codes((await verifyCatalog(read)).defects)).toEqual(expect.arrayContaining(['shard_path_invalid', 'shard_missing']));
    });
});
