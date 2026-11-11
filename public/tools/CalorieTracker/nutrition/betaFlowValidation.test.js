// V5 / #79 local evidence: the seven beta flows chained in one narrative, in order, against one in-memory
// fake port (never Firestore). Both write flags are mocked on only inside this file; the real
// capabilities.js keeps them false, and the last test asserts that. Synthetic values only.
// Runbook and results: docs/nutrition/beta-validation.md.
import { beforeAll, describe, expect, it, vi } from 'vitest';
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../shared/nutrition/capabilities.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        get INGREDIENT_STORE_WRITES_ENABLED() { return flags.enabled; },
        get NUTRIENT_V2_WRITES_ENABLED() { return flags.enabled; },
    };
});
import { emptyStagedRecord } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { createIngredientStore } from '../../../shared/nutrition/ingredientStore.js';
import { createMealStore } from '../../../shared/nutrition/mealStore.js';
import { commitLibraryEdit, researchLibraryFields, stageLibraryEdit } from '../../../shared/nutrition/library.js';
import {
    applyResearchResponse, calculateWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, lookupWorkspace, matchWorkspace,
    packetWorkspace, reviewWorkspace, saveWorkspace,
} from '../../../shared/nutrition/importWorkspace.js';
import { fakePort } from './ingredientFixtures.js';
import { responseFor } from './researchPacketFixtures.js';

const OWNER = 'owner';
const NAMESPACE = 'default-app-id';
const PREFIX = 'artifacts/' + NAMESPACE + '/users/' + OWNER + '/';
const GRAIN = { canonicalName: 'Synthetic grain', category: 'grain', kind: 'food' };
const RAW = { state: 'raw' };
const BASIS = { kind: 'per_100g_edible', state: 'raw' };
const LABEL = { type: 'label', title: 'Synthetic pack label', version: 'pack-2026-03', publishedAt: '2026-03-01', accessedAt: '2026-11-10' };
const ALLOWED_COLLECTIONS = ['ingredientIdentities', 'ingredientVariants', 'ingredientRevisions', 'mealRecords', 'mealRecordVersions'];

const list = (title, ingredients) => ({ kind: 'nutrition.ingredientList', schemaVersion: 1, registryVersion: 2, meal: { title, kind: 'single_portion', servings: { count: 1 } }, ingredients });
const line = (lineId, g) => ({ lineId, name: lineId, quantity: { g, basis: 'measured' }, variant: { state: 'raw' } });
const stage = (base, patch) => stageLibraryEdit({ scope: 'private', ownerUid: OWNER, viewerUid: OWNER, base, patch });
const docKey = (collection, id) => PREFIX + collection + '/' + id;
const canonical = value => JSON.stringify(value);

function cacheFor(pending, extra = {}) {
    return {
        getRevision: async () => ({ status: 'missing' }), putRevision: async () => { }, putConversion: async () => { }, getConversions: async () => [],
        getHead: async () => ({ status: 'missing' }), putHead: async () => { },
        putPendingSave: async (d) => pending.set(d.idempotencyKey, d), deletePendingSave: async (k) => pending.delete(k), listPendingSaves: async () => [...pending.values()],
        ...extra,
    };
}

// Shared chain state. Each step consumes what the step before it produced.
const chain = {};
let port, store, mealStore, ingredientPending, mealPending, curated, catalog;

beforeAll(async () => {
    port = fakePort();
    ingredientPending = new Map();
    mealPending = new Map();
    // A synthetic curated profile served by a fake catalog (no network).
    const record = emptyStagedRecord();
    for (const [key, value] of Object.entries({ calories: 120, protein: 12, fat: 1 })) { record.values[key] = value; record.quality[key] = { status: 'measured' }; }
    const draft = await buildRevisionDraft({
        identityId: 'synthetic-legume', variantId: 'legume', stagedRecord: record, basis: BASIS,
        fieldProvenance: { calories: { sourceKey: 'catalog' }, protein: { sourceKey: 'catalog' }, fat: { sourceKey: 'catalog' } },
        sources: { catalog: { type: 'curated_catalog', title: 'Synthetic curated release', version: 'cur-1' } },
    });
    curated = {
        revision: { ...draft, revision: 1, revisionId: 'legume~r1' },
        ref: { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: 'synthetic-legume', variantId: 'legume', revision: 1, revisionId: 'legume~r1', contentHash: draft.contentHash },
    };
    curated.snapshot = structuredClone(curated.revision);
    catalog = {
        getVariant: async (id) => id === 'legume' ? { headRevision: 1, headRevisionId: 'legume~r1', headContentHash: draft.contentHash } : null,
        getRevision: async (id) => id === 'legume' ? structuredClone(curated.revision) : null,
        getConversions: async () => [],
    };
    store = createIngredientStore({ port, namespace: NAMESPACE, ownerUid: OWNER, catalog, cache: cacheFor(ingredientPending) });
    mealStore = createMealStore({ port, namespace: NAMESPACE, ownerUid: OWNER, cache: cacheFor(mealPending) });
});

describe('V5 beta flow validation (chained, fake port)', () => {
    it('flow 1: a missing ingredient is researched through the copy/paste packet flow and nothing is written', async () => {
        let step = importWorkspaceInput(createWorkspace(OWNER).workspace, list('Grain probe', [line('grain', 100)]));
        expect(step.ok, JSON.stringify(step.errors)).toBe(true);
        step = await matchWorkspace(step.workspace, {});
        expect(step.workspace.match.lines[0].outcome).toBe('missing');
        // A packet is refused until the official-lookup step has been visited, and that step is not_performed.
        expect((await packetWorkspace(step.workspace, ['grain'])).error).toBe('official_lookup_required');
        step = lookupWorkspace(step.workspace, ['grain']);
        const packet = await packetWorkspace(step.workspace, ['grain']);
        expect(packet.ok, packet.error).toBe(true);
        expect(packet.workspace.packet.modelCalls).toBe(0);
        const request = packet.workspace.resolution.pendingRequests[0];
        const response = responseFor(request);
        const result = response.results[0];
        result.identityMatch.description = 'Synthetic grain';
        result.sources[0] = { sourceId: 's1', type: 'fdc', title: 'Synthetic grain fixture', url: 'https://example.test/grain', recordId: '9900101', version: 'fixture-v1', publishedAt: '2026-01-15', accessedAt: '2026-11-11' };
        const measured = { calories: [350, 'kcal'], protein: [12, 'g'], carbs: [70, 'g'], fat: [2, 'g'] };
        for (const [key, [value, unit]] of Object.entries(measured)) result.nutrients[key] = { value, unit, status: 'measured', sourceIds: ['s1'] };
        result.unresolved = result.unresolved.filter(entry => !(entry.field in measured)).map(entry => entry.field === 'iron' ? { field: 'iron', reason: 'Not stated by any source' } : entry);
        const applied = await applyResearchResponse(packet.workspace, JSON.stringify(response));
        expect(applied.ok, JSON.stringify(applied.errors)).toBe(true);
        const item = applied.workspace.resolution.items.find(row => row.lineId === 'grain');
        expect(item.source).toBe('packet');
        expect(item.nutrients.protein).toMatchObject({ value: 12, status: 'measured', requestId: request.requestId });
        expect(item.nutrients.iron).toMatchObject({ value: null, status: 'unknown' });
        expect(item.researchEvidence[0].unresolved).toContainEqual({ field: 'iron', reason: 'Not stated by any source' });
        expect(applied.workspace.committed).toBe(false);
        expect(port.docs.size).toBe(0);
        chain.research = { item, requestId: request.requestId };
    });

    it('flow 2 + 7a: the researched result is saved as a new private profile (revision 1) through commitLibraryEdit', async () => {
        const { item, requestId } = chain.research;
        const create = { identity: GRAIN, variant: { dims: RAW }, basis: BASIS, confirmNew: true };
        const result = await commitLibraryEdit({ store, staged: stage(null, { research: item }), create });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result).toMatchObject({ committed: true, writes: true, diaryUntouched: true });
        expect(result.ref).toMatchObject({ scope: 'private', namespace: NAMESPACE, revision: 1 });
        const resolved = await store.resolveRef(result.ref);
        expect(resolved.status).toBe('fresh');
        const rev1 = resolved.revision;
        expect(rev1.supersedes).toBeNull();
        expect(rev1.ownerUid).toBe(OWNER);
        expect(rev1.basis).toEqual(BASIS);
        expect(rev1.nutrients).toMatchObject({ calories: 350, protein: 12, carbs: 70, fat: 2 });
        expect(rev1.nutrientMeta.quality.protein).toEqual({ status: 'measured' });
        expect(rev1.fieldProvenance.protein).toEqual({ sourceKey: requestId + ':s1' });
        expect(rev1.sources[requestId + ':s1']).toMatchObject({ type: 'fdc', recordId: '9900101', version: 'fixture-v1', permittedUse: 'review_required' });
        // Unknown stays unknown, never zero.
        expect(rev1.nutrients.iron).toBeNull();
        expect(rev1.nutrientMeta.quality.iron).toEqual({ status: 'unknown', qualifier: 'gap:Not stated by any source' });
        expect(port.docs.get(docKey('ingredientVariants', result.ref.variantId)).headRevision).toBe(1);
        expect(port.docs.has(docKey('ingredientIdentities', result.ref.identityId))).toBe(true);
        expect(ingredientPending.size).toBe(0);
        chain.rev1 = { ref: result.ref, doc: rev1, stored: canonical(port.docs.get(docKey('ingredientRevisions', result.ref.revisionId))) };
    });

    it('flows 3 + 4: a missing micronutrient is filled as revision 2 and every unchanged field stays byte-identical', async () => {
        const { ref, doc: rev1 } = chain.rev1;
        // Pinned research for exactly the missing field.
        const packet = await researchLibraryFields({ name: GRAIN.canonicalName, ownerUid: OWNER, ref, revision: rev1, missingFields: ['iron'] });
        expect(packet.ok, packet.error).toBe(true);
        expect(packet.pendingJobs[0].target.baseRef).toEqual(ref);
        const request = packet.state.pendingRequests[0];
        const response = responseFor(request);
        const result = response.results[0];
        result.identityMatch.description = 'Synthetic grain';
        result.sources[0] = { sourceId: 's1', type: 'fdc', title: 'Synthetic mineral fixture', url: 'https://example.test/minerals', recordId: '9900202', version: 'fixture-v2', publishedAt: '2026-02-01', accessedAt: '2026-11-11' };
        result.nutrients.iron = { value: 2.1, unit: 'mg', status: 'measured', sourceIds: ['s1'], qualifier: 'lab' };
        result.unresolved = [];
        const applied = await applyResearchResponse({ resolution: packet.state }, JSON.stringify(response));
        expect(applied.ok, JSON.stringify(applied.errors)).toBe(true);
        const item = applied.workspace.resolution.items[0];
        expect(item.baseRevision.contentHash).toBe(rev1.contentHash);
        const fill = stage(item.baseRevision, { research: item });
        // A second editor stages from the same revision 1 before the fill is committed (flow 5 commits it).
        chain.stale = stage(rev1, { nutrients: { fat: 3 }, source: LABEL });

        const saved = await commitLibraryEdit({ store, staged: fill, base: item.baseRevision });
        expect(saved.ok, JSON.stringify(saved)).toBe(true);
        expect(saved.patchedFields).toEqual(['iron']);
        expect(saved.ref).toMatchObject({ scope: 'private', revision: 2, variantId: ref.variantId, identityId: ref.identityId });
        const rev2 = (await store.resolveRef(saved.ref)).revision;
        expect(rev2.supersedes).toEqual({ revision: 1, revisionId: rev1.revisionId, contentHash: rev1.contentHash });
        expect(rev2.contentHash).not.toBe(rev1.contentHash);
        // The filled field: value, status, and its own versioned source.
        expect(rev2.nutrients.iron).toBe(2.1);
        expect(rev2.nutrientMeta.quality.iron).toEqual({ status: 'measured', qualifier: 'lab' });
        expect(rev2.fieldProvenance.iron).toEqual({ sourceKey: request.requestId + ':s1' });
        expect(rev2.sources[request.requestId + ':s1']).toMatchObject({ recordId: '9900202', version: 'fixture-v2', publishedAt: '2026-02-01' });
        // Every other field: value, quality, and per-field provenance byte-identical to revision 1.
        const others = Object.keys(rev1.nutrients).filter(key => key !== 'iron');
        expect(others.length).toBeGreaterThan(20);
        for (const key of others) {
            expect(canonical(rev2.nutrients[key]), key).toBe(canonical(rev1.nutrients[key]));
            expect(canonical(rev2.nutrientMeta.quality[key]), key).toBe(canonical(rev1.nutrientMeta.quality[key]));
            expect(canonical(rev2.fieldProvenance[key]), key).toBe(canonical(rev1.fieldProvenance[key]));
        }
        for (const [key, source] of Object.entries(rev1.sources)) expect(canonical(rev2.sources[key]), key).toBe(canonical(source));
        expect(rev2.basis).toEqual(rev1.basis);
        // Revision 1 itself is untouched in the store, and the head moved to 2.
        expect(canonical(port.docs.get(docKey('ingredientRevisions', ref.revisionId)))).toBe(chain.rev1.stored);
        expect(port.docs.get(docKey('ingredientVariants', ref.variantId)).headRevision).toBe(2);
        expect((await store.resolveRef(ref)).newerAvailable).toBe(true);
        chain.rev2 = { ref: saved.ref, doc: rev2, stored: canonical(port.docs.get(docKey('ingredientRevisions', saved.ref.revisionId))) };
    });

    it('flow 5: the concurrent stale-base edit conflicts, keeps its draft in the outbox, and changes nothing', async () => {
        const before = canonical([...port.docs].sort());
        const conflict = await commitLibraryEdit({ store, staged: chain.stale, base: chain.rev1.doc });
        expect(conflict).toMatchObject({ ok: false, error: 'revision_conflict', committed: false, retained: true, diaryUntouched: true });
        expect(conflict.staged).toBe(chain.stale);
        expect(conflict.draft.nutrients.fat).toBe(3);
        const saves = await store.listPendingSaves();
        expect(saves).toHaveLength(1);
        expect(saves[0]).toMatchObject({ operation: 'saveRevision', payload: { variantId: chain.rev1.ref.variantId, baseRevision: 1 } });
        expect(saves[0].payload.revisionDraft.contentHash).toBe(conflict.draft.contentHash);
        expect(canonical([...port.docs].sort())).toBe(before);
        expect(port.docs.get(docKey('ingredientVariants', chain.rev1.ref.variantId)).headRevision).toBe(2);
        expect(port.docs.has(docKey('ingredientRevisions', chain.rev1.ref.variantId + '~r3'))).toBe(false);
        expect((await store.resolveRef(chain.rev2.ref)).revision.nutrients.fat).toBe(2);
    });

    it('flows 6 + 7a: a private override saved through commitLibraryEdit wins over the curated record for its owner only', async () => {
        expect((await store.resolveEffectiveProfile(curated.ref)).ref.scope).toBe('curated');
        const create = { identity: { canonicalName: 'Synthetic legume', category: 'legume', kind: 'food' }, variant: { dims: RAW, overrides: { catalogId: 'nutrition-curated', variantId: 'legume', revision: 1 } }, basedOn: curated.ref, confirmNew: true };
        const result = await commitLibraryEdit({ store, staged: stage(null, { nutrients: { fat: 4 }, source: LABEL }), base: curated.revision, create });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.ref).toMatchObject({ scope: 'private', revision: 1, identityId: 'synthetic-legume' });
        expect(result.ref.variantId).toMatch(/^ov-/);
        const effective = await store.resolveEffectiveProfile(curated.ref);
        expect(effective.ref).toEqual(result.ref);
        expect(effective.revision.nutrients.fat).toBe(4);
        expect(effective.revision.nutrientMeta.quality.fat).toEqual({ status: 'label_reported' });
        expect(effective.revision.nutrients.protein).toBe(12);
        expect(effective.revision.fieldProvenance.protein).toEqual({ sourceKey: 'catalog' });
        expect(effective.revision.basedOn).toEqual(curated.ref);
        // The curated record is unchanged, and another user still resolves the curated view.
        expect(curated.revision).toEqual(curated.snapshot);
        const other = createIngredientStore({ port, namespace: NAMESPACE, ownerUid: 'other-user', catalog, cache: cacheFor(new Map()) });
        const otherView = await other.resolveEffectiveProfile(curated.ref);
        expect(otherView.ref).toEqual(curated.ref);
        expect(otherView.revision.nutrients.fat).toBe(1);
        expect([...port.docs.keys()].some(key => key.includes('/users/other-user/'))).toBe(false);
        chain.override = { ref: result.ref };
    });

    it('flow 7b: saveWorkspace commits a meal pinned to revision 2 and the override (committed, logged: false, no diary write)', async () => {
        const grainRef = chain.rev2.ref, legumeRef = chain.override.ref;
        let step = importWorkspaceInput(createWorkspace(OWNER).workspace, list('Beta bowl', [line('grain', 150), line('legume', 100)]));
        expect(step.ok, JSON.stringify(step.errors)).toBe(true);
        step = await matchWorkspace(step.workspace, {
            lineRefs: { grain: grainRef, legume: legumeRef }, refDims: { grain: RAW, legume: RAW },
            loadRevision: async ref => store.resolveRef(ref),
        });
        step = reviewWorkspace(fitWorkspace(calculateWorkspace(step.workspace).workspace).workspace);
        expect(step.ok).toBe(true);
        const nutrients = step.workspace.calculation.nutrients;
        // 150 g of revision 2 plus 100 g of the private override.
        expect(nutrients.protein.value).toBeCloseTo(12 * 1.5 + 12, 6);
        expect(nutrients.fat.value).toBeCloseTo(2 * 1.5 + 4, 6);
        expect(nutrients.iron.value).toBeCloseTo(2.1 * 1.5, 6);
        const ingredientDocs = canonical([...port.docs].filter(([key]) => key.includes('/ingredient')).sort());

        const promise = saveWorkspace(step.workspace, { store: mealStore });
        expect(promise).toBeInstanceOf(Promise);
        const saved = await promise;
        expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, committed: true, logged: false, deduped: false, writes: true, modelCalls: 0 });
        expect(saved.workspace.save).toMatchObject({ available: true, logged: false });
        const fetched = await mealStore.getMealVersion(saved.mealRef);
        expect(fetched.status).toBe('fresh');
        const pins = Object.fromEntries(fetched.record.lines.map(row => [row.lineId, row.profile]));
        expect(pins.grain).toEqual({ kind: 'ingredient', ref: grainRef });
        expect(pins.legume).toEqual({ kind: 'ingredient', ref: legumeRef });
        expect(fetched.record.calculated.nutrients.iron.value).toBeCloseTo(2.1 * 1.5, 6);
        // The meal save wrote exactly one head and one version, touched no ingredient document, and wrote no diary.
        expect([...port.docs.keys()].filter(key => key.startsWith(PREFIX + 'mealRecords/'))).toHaveLength(1);
        expect([...port.docs.keys()].filter(key => key.startsWith(PREFIX + 'mealRecordVersions/'))).toHaveLength(1);
        expect(canonical([...port.docs].filter(([key]) => key.includes('/ingredient')).sort())).toBe(ingredientDocs);
        for (const key of port.docs.keys()) {
            expect(key.startsWith(PREFIX), key).toBe(true);
            expect(ALLOWED_COLLECTIONS, key).toContain(key.slice(PREFIX.length).split('/')[0]);
        }
        expect(mealPending.size).toBe(0);
        // The revision-1 and revision-2 documents are still byte-identical at the end of the chain.
        expect(canonical(port.docs.get(docKey('ingredientRevisions', chain.rev1.ref.revisionId)))).toBe(chain.rev1.stored);
        expect(canonical(port.docs.get(docKey('ingredientRevisions', chain.rev2.ref.revisionId)))).toBe(chain.rev2.stored);
        // The only retained ingredient draft is still the flow-5 loser.
        expect(ingredientPending.size).toBe(1);
    });

    it('the shipped capabilities keep both write flags false (the mock is local to this file)', async () => {
        const actual = await vi.importActual('../../../shared/nutrition/capabilities.js');
        expect(actual.INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
        expect(actual.NUTRIENT_V2_WRITES_ENABLED).toBe(false);
        // With the local mock off, the same save path is export-only and synchronous.
        flags.enabled = false;
        try {
            expect(commitLibraryEdit({ store, staged: stage(chain.rev2.doc, { nutrients: { fat: 5 }, source: LABEL }), base: chain.rev2.doc })).toMatchObject({ ok: false, error: 'writes_disabled' });
        } finally { flags.enabled = true; }
    });
});
