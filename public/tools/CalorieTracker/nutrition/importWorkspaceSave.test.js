// V5 prerequisite: saveWorkspace() commits a reviewed workspace as a meal version when save is on. Both
// write flags are mocked only inside this file; the real capabilities.js keeps them false. Writes go to the
// in-memory fake port, never Firestore, and a save never writes a diary day. Synthetic values only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { privateIdentityId, privateVariantId } from '../../../shared/nutrition/ingredientIds.js';
import { IngredientWritesDisabledError } from '../../../shared/nutrition/ingredientStore.js';
import {
    calculateWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, matchWorkspace, reviewWorkspace, saveWorkspace, WORKSPACE_SAVE_REASON,
} from '../../../shared/nutrition/importWorkspace.js';
import { createMealStore } from '../../../shared/nutrition/mealStore.js';
import { fakePort } from './ingredientFixtures.js';

const PREFIX = 'artifacts/default-app-id/users/owner/';

async function profile(name, values, dims) {
    const identity = { canonicalName: name, category: 'other', kind: 'food' };
    const identityId = await privateIdentityId(identity), variantId = await privateVariantId(identityId, dims);
    const stagedRecord = emptyStagedRecord();
    for (const [key, value] of Object.entries(values)) { stagedRecord.values[key] = value; stagedRecord.quality[key] = { status: 'measured' }; }
    const draft = await buildRevisionDraft({
        identityId, variantId, stagedRecord, basis: { kind: 'per_100g_edible', state: dims.state },
        fieldProvenance: Object.fromEntries(Object.keys(values).map(key => [key, { sourceKey: 'manual' }])),
        sources: { manual: { type: 'manual', title: 'Synthetic ' + name } },
    });
    const doc = { ...draft, ownerUid: 'owner', revision: 1, revisionId: variantId + '~r1', idempotencyKey: 'test', createdAt: 0 };
    const ref = { refVersion: 1, scope: 'private', namespace: 'default-app-id', identityId, variantId, revision: 1, revisionId: doc.revisionId, contentHash: doc.contentHash };
    return { dims, revision: doc, ref };
}

const list = (title, ingredients) => ({ kind: 'nutrition.ingredientList', schemaVersion: 1, registryVersion: 2, meal: { title, kind: 'single_portion', servings: { count: 1 } }, ingredients });
const line = (lineId, g, state = 'raw') => ({ lineId, name: lineId, quantity: { g, basis: 'measured' }, variant: { state } });

async function reviewed(source, profiles) {
    let step = importWorkspaceInput(createWorkspace('owner').workspace, source);
    expect(step.ok, JSON.stringify(step.errors)).toBe(true);
    const lineRefs = {}, refDims = {}, docs = new Map();
    for (const [lineId, p] of Object.entries(profiles)) { lineRefs[lineId] = p.ref; refDims[lineId] = p.dims; docs.set(p.ref.revisionId, p.revision); }
    step = await matchWorkspace(step.workspace, { lineRefs, refDims, loadRevision: async ref => ({ revision: structuredClone(docs.get(ref.revisionId)) }) });
    step = reviewWorkspace(fitWorkspace(calculateWorkspace(step.workspace).workspace).workspace);
    expect(step.ok).toBe(true);
    return step.workspace;
}

let alpha, beta, port, store, pending;
const bowl = (alphaG = 120) => reviewed(list('Bowl', [line('alpha', alphaG), line('beta', 80, 'cooked')]), { alpha, beta });
const versionDocs = () => [...port.docs.keys()].filter(key => key.startsWith(PREFIX + 'mealRecordVersions/'));
const headDocs = () => [...port.docs.keys()].filter(key => key.startsWith(PREFIX + 'mealRecords/'));

beforeEach(async () => {
    flags.enabled = true;
    alpha = await profile('Alpha', { calories: 100, protein: 10, fat: 2 }, { state: 'raw' });
    beta = await profile('Beta', { calories: 200, protein: 4, carbs: 40, fat: 1 }, { state: 'cooked' });
    port = fakePort();
    pending = new Map();
    store = createMealStore({ port, namespace: 'default-app-id', ownerUid: 'owner', cache: {
        putPendingSave: async (d) => pending.set(d.idempotencyKey, d), deletePendingSave: async (k) => pending.delete(k), listPendingSaves: async () => [...pending.values()],
    } });
});

describe('saveWorkspace with save off', () => {
    it('returns the export-only result synchronously and touches no store', async () => {
        const workspace = await bowl();
        flags.enabled = false;
        const spy = vi.spyOn(store, 'saveMealVersion');
        const result = saveWorkspace(workspace, { store });
        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual(saveWorkspace(workspace));
        expect(result).toEqual({
            ok: true,
            workspace: { ...workspace, stage: 'save', exportCopy: result.workspace.exportCopy, committed: false, modelCalls: 0, capabilities: result.workspace.capabilities,
                save: { available: false, logged: false, reason: WORKSPACE_SAVE_REASON } },
        });
        expect(result.workspace.capabilities.save).toBe(false);
        expect(result.workspace.exportCopy.text).toContain('alpha');
        expect(spy).not.toHaveBeenCalled();
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });
});

describe('saveWorkspace with save on', () => {
    it('commits a reviewed workspace once, never logs it, and clears the outbox', async () => {
        const workspace = await bowl();
        const promise = saveWorkspace(workspace, { store });
        expect(promise).toBeInstanceOf(Promise);
        const result = await promise;
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true, committed: true, logged: false, deduped: false });
        expect(result.mealRef).toMatchObject({ kind: 'meal', version: 1, namespace: 'default-app-id' });
        expect(result.workspace).toMatchObject({ stage: 'save', committed: true, mealRef: result.mealRef, modelCalls: 0, save: { available: true, logged: false, deduped: false } });
        expect(result.workspace.exportCopy.text).toContain('alpha');
        expect(result.workspace.capabilities.save).toBe(true);
        expect(versionDocs()).toHaveLength(1);
        expect(headDocs()).toHaveLength(1);
        expect(port.docs.size).toBe(2);
        expect(pending.size).toBe(0);
        expect((await store.getMealVersion(result.mealRef)).status).toBe('fresh');
    });

    it('dedupes the same workspace saved twice', async () => {
        const workspace = await bowl();
        const first = await saveWorkspace(workspace, { store });
        const again = await saveWorkspace(workspace, { store });
        expect(again).toMatchObject({ ok: true, committed: true, deduped: true, logged: false, writes: false });
        expect(again.mealRef).toEqual(first.mealRef);
        expect(versionDocs()).toHaveLength(1);
    });

    it('reports a stale base as a conflict and keeps the payload in the outbox', async () => {
        const first = await saveWorkspace(await bowl(), { store });
        const second = await saveWorkspace(await bowl(150), { store, baseVersion: 1 });
        expect(second.mealRef.version).toBe(2);
        const stale = await saveWorkspace(await bowl(180), { store, baseVersion: 1 });
        expect(stale).toMatchObject({ ok: false, error: 'meal_conflict', committed: false, logged: false, writes: false, modelCalls: 0, retained: true });
        expect(stale.exportCopy.text).toContain('alpha');
        const saves = await store.listPendingSaves();
        expect(saves).toHaveLength(1);
        expect(saves[0].payload.record.contentHash).toBe(stale.record.contentHash);
        expect(saves[0].payload.baseVersion).toBe(1);
        expect(versionDocs()).toHaveLength(2);
        expect(first.mealRef.mealId).toBe(second.mealRef.mealId);
    });

    it('surfaces snapshot blockers for a line without a profile and writes nothing', async () => {
        const workspace = await reviewed(list('Bowl', [line('alpha', 100), line('gamma', 50)]), { alpha });
        const result = await saveWorkspace(workspace, { store });
        expect(result).toMatchObject({ ok: false, error: 'unpinned_lines', committed: false, logged: false, writes: false, modelCalls: 0,
            blockers: [{ lineId: 'gamma', reason: 'missing_profile' }] });
        expect(result.exportCopy.text).toContain('gamma');
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });

    it('refuses with store_unavailable and keeps the export copy when no store is passed', async () => {
        const result = await saveWorkspace(await bowl());
        expect(result).toMatchObject({ ok: false, error: 'store_unavailable', committed: false, logged: false, writes: false, modelCalls: 0 });
        expect(result.exportCopy.text).toContain('alpha');
        expect(result.record.ownerUid).toBe('owner');
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });

    it('maps a store whose write flag is off to writes_disabled', async () => {
        const workspace = await bowl();
        const stub = { saveMealVersion: vi.fn(async () => { throw new IngredientWritesDisabledError('Meal writes are disabled'); }) };
        const result = await saveWorkspace(workspace, { store: stub });
        expect(stub.saveMealVersion).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ ok: false, error: 'writes_disabled', committed: false, logged: false, writes: false, modelCalls: 0 });
        expect(result.exportCopy.text).toContain('alpha');
        expect(port.docs.size).toBe(0);
    });
    it('retains the export in the workspace draft if a store rejects before queueing anything', async () => {
        const unavailable = {
            saveMealVersion: vi.fn(async () => { throw new Error('preflight failure'); }),
            listPendingSaves: vi.fn(async () => []),
        };
        const result = await saveWorkspace(await bowl(), { store: unavailable });
        expect(unavailable.saveMealVersion).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            ok: false, error: 'save_failed', committed: false, logged: false,
            writes: false, retained: false, workspace: { stage: 'save', committed: false },
        });
        expect(result.workspace.exportCopy).toEqual(result.exportCopy);
        expect(result.workspace.exportCopy.text).toContain('alpha');
        expect(result.workspace.save.reason).toContain('Export copy is available');
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });

    it('reports a genuine transaction failure as retained when its pending save exists', async () => {
        port.runTransaction = async () => { throw new Error('transaction unavailable'); };
        const result = await saveWorkspace(await bowl(), { store });
        expect(result).toMatchObject({
            ok: false, error: 'save_failed', committed: false, logged: false,
            writes: false, retained: true, workspace: { stage: 'save', committed: false },
        });
        expect(result.exportCopy.text).toContain('alpha');
        expect(result.workspace.exportCopy).toEqual(result.exportCopy);
        const saves = await store.listPendingSaves();
        expect(saves).toHaveLength(1);
        expect(saves[0].idempotencyKey).toBe(result.record.idempotencyKey);
        expect(port.docs.size).toBe(0);
    });

    it('returns a copyable fallback even when building an invalid snapshot throws', async () => {
        const workspace = await bowl();
        const broken = { ...workspace, resolution: { ...workspace.resolution, lines: null } };
        const result = await saveWorkspace(broken, { store });
        expect(result).toMatchObject({
            ok: false, error: 'save_failed', committed: false, logged: false,
            writes: false, retained: false, workspace: { committed: false },
        });
        expect(result.workspace.exportCopy).toEqual(result.exportCopy);
        expect(result.exportCopy.text).toContain('alpha');
        expect(port.docs.size).toBe(0);
    });

});
