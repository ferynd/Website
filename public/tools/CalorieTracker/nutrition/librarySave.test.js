// #69 Part B: private library saves. The write flag is mocked on only inside this file; the real
// capabilities.js keeps both write flags false. Writes go to the in-memory fake port, never Firestore.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../shared/nutrition/capabilities.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, get INGREDIENT_STORE_WRITES_ENABLED() { return flags.enabled; } };
});
import { createIngredientStore } from '../../../shared/nutrition/ingredientStore.js';
import { buildLibraryDraft, commitLibraryEdit, researchLibraryFields, stageLibraryEdit } from '../../../shared/nutrition/library.js';
import { applyResearchResponse } from '../../../shared/nutrition/importWorkspace.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { fakePort, fixture, identity, dims } from './ingredientFixtures.js';
import { responseFor } from './researchPacketFixtures.js';

const label = { type: 'label', title: 'Synthetic pack label', version: 'pack-2026-03', publishedAt: '2026-03-01', accessedAt: '2026-11-10' };
let port, store, pending, catalog;
const curated = {};

beforeEach(async () => {
    flags.enabled = true;
    port = fakePort();
    pending = new Map();
    // A synthetic curated profile served by a fake catalog (no network).
    const f = await fixture(12);
    const draft = await buildRevisionDraft({ ...f.input, identityId: 'synthetic-chicken', variantId: 'chicken', sources: { catalog: { type: 'curated_catalog', title: 'Synthetic curated release', version: 'cur-1' } }, fieldProvenance: { protein: { sourceKey: 'catalog' } } });
    curated.revision = { ...draft, revision: 1, revisionId: 'chicken~r1' };
    curated.ref = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: 'synthetic-chicken', variantId: 'chicken', revision: 1, revisionId: 'chicken~r1', contentHash: draft.contentHash };
    curated.snapshot = structuredClone(curated.revision);
    catalog = {
        getVariant: async (id) => id === 'chicken' ? { headRevision: 1, headRevisionId: 'chicken~r1', headContentHash: draft.contentHash } : null,
        getRevision: async (id) => id === 'chicken' ? structuredClone(curated.revision) : null,
        getConversions: async () => [],
    };
    store = createIngredientStore({ port, namespace: 'default-app-id', ownerUid: 'owner', catalog, cache: {
        getRevision: async () => ({ status: 'missing' }), putRevision: async () => { }, putConversion: async () => { }, getConversions: async () => [],
        getHead: async () => ({ status: 'missing' }), putHead: async () => { },
        putPendingSave: async (d) => pending.set(d.idempotencyKey, d), deletePendingSave: async (k) => pending.delete(k), listPendingSaves: async () => [...pending.values()],
    } });
});

/** Create revision 1 of the private Chicken profile (protein 10, manual source) and return its document. */
async function savedBase() {
    const ref = await store.createIngredient({ identity, variant: { dims }, revisionDraft: (await fixture(10)).draft, confirmNew: true });
    return { ref, base: (await store.resolveRef(ref)).revision };
}
const stage = (base, patch) => stageLibraryEdit({ scope: 'private', ownerUid: 'owner', viewerUid: 'owner', base, patch });
const docsSnapshot = () => JSON.stringify([...port.docs].sort());

describe('commit with the write flag off', () => {
    it('returns writes_disabled, writes nothing, and leaves the staged edit intact', async () => {
        flags.enabled = false;
        const { revision: base } = await fixture(10);
        const staged = stage({ ...base, ownerUid: 'owner' }, { nutrients: { fat: 2 }, source: label });
        const before = structuredClone(staged);
        const result = commitLibraryEdit({ store, staged, base: { ...base, ownerUid: 'owner' } });
        expect(result).toEqual({ ok: false, error: 'writes_disabled', writes: false, committed: false, diaryUntouched: true });
        expect(commitLibraryEdit()).toEqual(result);
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
        expect(staged).toEqual(before);
        expect(staged.readyForSave).toBe(false);
    });
});

describe('private edit commits', () => {
    it('saves revision 2 that supersedes revision 1 and keeps unpatched fields and provenance', async () => {
        const { ref, base } = await savedBase();
        const staged = stage(base, {
            nutrients: {
                fat: 2.5,
                iron: { value: 1.2, status: 'measured', uncertainty: { min: 1, max: 1.4, roundingInterval: 0.1 }, confidence: 0.8, derivation: 'mean of two lab reads', comparator: 'none', source: { type: 'manual', title: 'Owner lab sheet', version: 'sheet-2', accessedAt: '2026-11-09' } },
            },
            source: label,
        });
        expect(staged.readyForSave).toBe(false);
        const result = await commitLibraryEdit({ store, staged, base });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result).toMatchObject({ committed: true, diaryUntouched: true, patchedFields: ['fat', 'iron'] });
        expect(result.ref.revision).toBe(2);
        const head = port.docs.get('artifacts/default-app-id/users/owner/ingredientVariants/' + ref.variantId);
        expect(head.headRevision).toBe(2);
        const saved = await store.resolveRef(result.ref);
        expect(saved.status).toBe('fresh');
        const next = saved.revision;
        expect(next.supersedes).toEqual({ revision: 1, revisionId: base.revisionId, contentHash: base.contentHash });
        // Unpatched: value, quality, provenance, and source are unchanged.
        expect(next.nutrients.protein).toBe(10);
        expect(next.nutrientMeta.quality.protein).toEqual(base.nutrientMeta.quality.protein);
        expect(next.fieldProvenance.protein).toEqual(base.fieldProvenance.protein);
        expect(next.sources.manual).toEqual(base.sources.manual);
        for (const key of Object.keys(base.nutrients).filter(key => !['fat', 'iron'].includes(key))) expect(next.nutrients[key]).toEqual(base.nutrients[key]);
        // Patched label value: label_reported with the label source and its version and dates.
        expect(next.nutrients.fat).toBe(2.5);
        expect(next.nutrientMeta.quality.fat).toEqual({ status: 'label_reported' });
        expect(next.sources[next.fieldProvenance.fat.sourceKey]).toEqual(label);
        // Patched manual value: its own source, uncertainty as range and rounding, confidence, derivation, comparator.
        expect(next.nutrientMeta.quality.iron).toEqual({ status: 'measured', roundingInterval: 0.1 });
        expect(next.fieldProvenance.iron).toMatchObject({ range: { min: 1, max: 1.4 }, confidence: 0.8, derivation: 'mean of two lab reads', comparatorRef: 'none' });
        expect(next.sources[next.fieldProvenance.iron.sourceKey]).toEqual({ type: 'manual', title: 'Owner lab sheet', version: 'sheet-2', accessedAt: '2026-11-09' });
        expect(pending.size).toBe(0);
    });

    it('returns revision_conflict for a second commit from the same base and keeps the draft pending', async () => {
        const { base } = await savedBase();
        const first = stage(base, { nutrients: { fat: 2 }, source: label });
        const second = stage(base, { nutrients: { fat: 3 }, source: label });
        expect((await commitLibraryEdit({ store, staged: first, base })).ok).toBe(true);
        const conflict = await commitLibraryEdit({ store, staged: second, base });
        expect(conflict).toMatchObject({ ok: false, error: 'revision_conflict', committed: false, retained: true, diaryUntouched: true });
        expect(conflict.staged).toBe(second);
        const saves = await store.listPendingSaves();
        expect(saves).toHaveLength(1);
        expect(saves[0].operation).toBe('saveRevision');
        expect(saves[0].payload.revisionDraft.contentHash).toBe(conflict.draft.contentHash);
        expect(saves[0].payload.baseRevision).toBe(1);
    });

    it('refuses curated scope and owner mismatch without writing', async () => {
        const { base } = await savedBase();
        const before = docsSnapshot();
        expect(await commitLibraryEdit({ store, staged: stageLibraryEdit({ scope: 'curated', ownerUid: 'owner', viewerUid: 'owner', base }), base })).toMatchObject({ ok: false, error: 'curated_read_only' });
        expect(await commitLibraryEdit({ store, staged: stage(base, { nutrients: { fat: 2 }, source: label }), base, scope: 'curated' })).toMatchObject({ ok: false, error: 'curated_read_only' });
        expect(await commitLibraryEdit({ store, staged: stageLibraryEdit({ scope: 'private', ownerUid: 'owner', viewerUid: 'someone-else', base }), base })).toMatchObject({ ok: false, error: 'owner_mismatch' });
        expect(await commitLibraryEdit({ store, staged: stage(base, { nutrients: { fat: 2 }, source: label }), base: { ...base, ownerUid: 'someone-else' } })).toMatchObject({ ok: false, error: 'owner_mismatch' });
        expect(docsSnapshot()).toBe(before);
    });
});

describe('private override of a curated profile', () => {
    it('creates a private override that resolveEffectiveProfile prefers; the curated record is untouched', async () => {
        expect((await store.resolveEffectiveProfile(curated.ref)).ref.scope).toBe('curated');
        const staged = stage(null, { nutrients: { fat: 4 }, source: label });
        const create = { identity: { canonicalName: 'Chicken', category: 'meat', kind: 'food' }, variant: { dims, overrides: { catalogId: 'nutrition-curated', variantId: 'chicken', revision: 1 } }, basedOn: curated.ref, confirmNew: true };
        const result = await commitLibraryEdit({ store, staged, base: curated.revision, create });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.ref).toMatchObject({ scope: 'private', revision: 1, identityId: 'synthetic-chicken' });
        expect(result.ref.variantId).toMatch(/^ov-/);
        const effective = await store.resolveEffectiveProfile(curated.ref);
        expect(effective.ref).toEqual(result.ref);
        expect(effective.revision.nutrients.fat).toBe(4);
        // The copied curated field keeps its value, quality, and curated source.
        expect(effective.revision.nutrients.protein).toBe(12);
        expect(effective.revision.fieldProvenance.protein).toEqual({ sourceKey: 'catalog' });
        expect(effective.revision.sources.catalog).toEqual(curated.snapshot.sources.catalog);
        expect(effective.revision.basedOn).toEqual(curated.ref);
        expect(curated.revision).toEqual(curated.snapshot);
        expect([...port.docs.keys()].some(key => key.includes('chicken~r') || key.endsWith('/chicken'))).toBe(false);
        expect([...port.docs.keys()].some(key => key.includes('/ingredientIdentities/'))).toBe(false);
    });
});

describe('research result save', () => {
    async function appliedResearch(base, ref) {
        const packet = await researchLibraryFields({ name: 'Chicken', ownerUid: 'owner', ref, revision: base, missingFields: ['fat', 'sodium', 'iron'] });
        expect(packet.ok, packet.error).toBe(true);
        const request = packet.state.pendingRequests[0];
        const response = responseFor(request);
        const result = response.results[0];
        result.sources[0] = { sourceId: 's1', type: 'fdc', title: 'Synthetic fixture', url: 'https://example.test/synthetic', recordId: '9900001', version: 'fixture-v1', publishedAt: '2026-01-15', accessedAt: '2026-11-06' };
        result.sources.push({ sourceId: 'c1', type: 'composition_db', title: 'Synthetic comparable table', url: 'https://example.test/comparable', recordId: 'cmp-7', version: 'cmp-2026.1', publishedAt: '2026-02-01', accessedAt: '2026-11-07' });
        result.nutrients.sodium = { value: 70, unit: 'mg', status: 'measured', sourceIds: ['s1'], qualifier: 'lab', roundingInterval: 1 };
        result.nutrients.fat = { value: 300, unit: 'mg', status: 'estimated_from_comparable', sourceIds: ['c1'], comparator: { name: 'Synthetic thigh', sourceId: 'c1', transferReason: 'Same cut and state' }, derivation: 'Comparable raw thigh', range: { min: 200, max: 400 }, confidence: 0.6 };
        result.nutrients.iron = { value: null, unit: 'mg', status: 'unknown', sourceIds: [] };
        result.unresolved = [{ field: 'iron', reason: 'Not stated by any source' }];
        result.assumptions = ['Raw, skinless'];
        const applied = await applyResearchResponse({ resolution: packet.state }, JSON.stringify(response));
        expect(applied.ok, JSON.stringify(applied.errors)).toBe(true);
        return { item: applied.workspace.resolution.items[0], requestId: request.requestId };
    }

    it('keeps source, unit basis, status, uncertainty, confidence, comparator, derivation, version, and dates', async () => {
        const { ref, base } = await savedBase();
        const { item, requestId } = await appliedResearch(base, ref);
        expect(item.baseRevision.contentHash).toBe(base.contentHash);
        const staged = stage(item.baseRevision, { research: item });
        const result = await commitLibraryEdit({ store, staged, base: item.baseRevision });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.ref.revision).toBe(2);
        const next = (await store.resolveRef(result.ref)).revision;
        expect(next.basis).toEqual({ kind: 'per_100g_edible', state: 'raw' });
        // Measured field: registry unit (mg), status, qualifier, rounding, and its fdc source.
        expect(next.nutrients.sodium).toBe(70);
        expect(next.nutrientMeta.quality.sodium).toEqual({ status: 'measured', qualifier: 'lab', roundingInterval: 1 });
        expect(next.fieldProvenance.sodium).toEqual({ sourceKey: requestId + ':s1' });
        expect(next.sources[requestId + ':s1']).toEqual({ type: 'fdc', title: 'Synthetic fixture', url: 'https://example.test/synthetic', recordId: '9900001', version: 'fixture-v1', publishedAt: '2026-01-15', accessedAt: '2026-11-06', permittedUse: 'review_required' });
        // Comparable estimate: normalized to grams, with range, confidence, comparator, and derivation.
        expect(next.nutrients.fat).toBe(0.3);
        expect(next.nutrientMeta.quality.fat).toEqual({ status: 'estimated_from_comparable' });
        expect(next.fieldProvenance.fat).toEqual({ sourceKey: requestId + ':c1', derivation: 'Comparable raw thigh', comparatorRef: JSON.stringify({ name: 'Synthetic thigh', sourceId: 'c1', transferReason: 'Same cut and state' }), confidence: 0.6, range: { min: 0.2, max: 0.4 } });
        expect(next.sources[requestId + ':c1']).toEqual({ type: 'comparable', title: 'Synthetic comparable table', url: 'https://example.test/comparable', recordId: 'cmp-7', version: 'cmp-2026.1', publishedAt: '2026-02-01', accessedAt: '2026-11-07', permittedUse: 'review_required' });
        // Explicit unknown stays null with its reason.
        expect(next.nutrients.iron).toBeNull();
        expect(next.nutrientMeta.quality.iron).toEqual({ status: 'unknown', qualifier: 'gap:Not stated by any source' });
        expect(next.fieldProvenance.iron).toBeUndefined();
        // Unpatched base field is unchanged.
        expect(next.nutrients.protein).toBe(10);
        expect(next.fieldProvenance.protein).toEqual(base.fieldProvenance.protein);
        // What the revision cannot hold is reported, not dropped.
        expect(result.unrepresented).toContainEqual({ field: `sources.${requestId}:c1.type`, reason: expect.any(String), value: 'composition_db' });
        expect(result.unrepresented).toContainEqual({ field: 'assumptions', reason: expect.any(String), value: 'Raw, skinless' });
    });

    it('builds the same draft without writing when only previewed', async () => {
        const { ref, base } = await savedBase();
        const { item } = await appliedResearch(base, ref);
        const before = docsSnapshot();
        const built = await buildLibraryDraft({ staged: stage(item.baseRevision, { research: item }), base: item.baseRevision });
        expect(built).toMatchObject({ ok: true, readyForSave: true, writes: false, patchedFields: ['fat', 'iron', 'sodium'] });
        expect(docsSnapshot()).toBe(before);
    });
});

describe('research packet field selection', () => {
    it('pins the selected ref and revision and requests exactly the chosen fields', async () => {
        const { ref, base } = await savedBase();
        const packet = await researchLibraryFields({ name: 'Chicken', ownerUid: 'owner', ref, revision: base, missingFields: ['sodium', 'fat'] });
        expect(packet.ok, packet.error).toBe(true);
        const [job] = packet.pendingJobs;
        expect(job.target.baseRef).toEqual(ref);
        expect(job.target.baseRevision.revision).toBe(1);
        expect(job.target.baseRevision.contentHash).toBe(ref.contentHash);
        expect(job.target.identityId).toBe(ref.identityId);
        expect(job.target.variantId).toBe(ref.variantId);
        expect(job.pendingRequest.baseRef).toEqual(ref);
        expect(job.requestedFields).toEqual(['sodium', 'fat']);
        const [target] = packet.packets[0].targets;
        expect(target.targetId).toBe(job.jobId);
        expect(target.requestedFields).toEqual(['fat', 'sodium']);
        expect(Object.keys(target.expectedUnits).sort()).toEqual(['fat', 'sodium']);
        // A stale revision for the ref is refused rather than silently researched.
        expect((await researchLibraryFields({ name: 'Chicken', ownerUid: 'owner', ref, missingFields: ['fat'] })).error).toBe('base_revision_required');
        // Without a selection the packet is today's unpinned, all-fields packet.
        const bare = await researchLibraryFields({ name: 'Chicken', ownerUid: 'owner' });
        expect(bare.pendingJobs[0].target.baseRef).toBeUndefined();
        expect(bare.packets[0].targets[0].requestedFields).toBe('*');
        expect(packet.writes).toBe(false);
    });
});

describe('cancel without saving', () => {
    it('leaves the store unchanged when a staged edit is never committed', async () => {
        const { ref, base } = await savedBase();
        const before = docsSnapshot();
        const staged = stage(base, { nutrients: { fat: 9 }, source: label });
        expect(staged.ok).toBe(true);
        expect(docsSnapshot()).toBe(before);
        expect(pending.size).toBe(0);
        expect((await store.resolveRef(ref)).revision.nutrients.fat).toBeNull();
        expect(port.docs.get('artifacts/default-app-id/users/owner/ingredientVariants/' + ref.variantId).headRevision).toBe(1);
    });
});
