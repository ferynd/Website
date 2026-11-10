// #64 Part B: meal snapshots and meal versions. Both write flags are mocked on only inside this file; the
// real capabilities.js keeps them false. Writes go to the in-memory fake port, never Firestore. The diary
// functions are pure and are checked against plain day objects; services/firebase.js is not used.
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
import { CALCULATION_VERSION } from '../../../shared/nutrition/calculate.js';
import { FIT_VERSION } from '../../../shared/nutrition/fit.js';
import { emptyStagedRecord, LEGACY_V1_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { privateIdentityId, privateVariantId } from '../../../shared/nutrition/ingredientIds.js';
import { IngredientWritesDisabledError } from '../../../shared/nutrition/ingredientStore.js';
import {
    calculateWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, matchWorkspace, reviewWorkspace, saveWorkspace, WORKSPACE_SAVE_REASON,
} from '../../../shared/nutrition/importWorkspace.js';
import {
    buildMealSnapshot, exportMealRecord, importMealRecord, mealContent, mealRefOf, recalculateMealRecord, rebuildMealRecord, referencesForIngredient,
    useSavedMealForLine, verifyMealRecord,
} from '../../../shared/nutrition/mealSnapshot.js';
import { commitWorkspaceMeal, createMealStore, MealVersionConflictError } from '../../../shared/nutrition/mealStore.js';
import {
    buildDiaryMealEntry, checkMealEntryFreshness, diaryDayHash, NEW_DATA_NOTICE, planDiaryMealAdd, readDiaryItem, reportionDiaryMealEntry,
} from '../../../shared/nutrition/mealDiary.js';
import { normalizeEntry } from '../state/schema.js';
import { fakePort } from './ingredientFixtures.js';

const PREFIX = 'artifacts/default-app-id/users/owner/';

/** A private profile revision document and its pinned ref (synthetic values, no network). */
async function profile(name, values, dims, revision = 1) {
    const identity = { canonicalName: name, category: 'other', kind: 'food' };
    const identityId = await privateIdentityId(identity), variantId = await privateVariantId(identityId, dims);
    const stagedRecord = emptyStagedRecord();
    for (const [key, value] of Object.entries(values)) { stagedRecord.values[key] = value; stagedRecord.quality[key] = { status: 'measured' }; }
    const draft = await buildRevisionDraft({
        identityId, variantId, stagedRecord, basis: { kind: 'per_100g_edible', state: dims.state },
        fieldProvenance: Object.fromEntries(Object.keys(values).map(key => [key, { sourceKey: 'manual' }])),
        sources: { manual: { type: 'manual', title: 'Synthetic ' + name } },
    });
    const doc = { ...draft, ownerUid: 'owner', revision, revisionId: variantId + '~r' + revision, idempotencyKey: 'test', createdAt: 0 };
    const ref = { refVersion: 1, scope: 'private', namespace: 'default-app-id', identityId, variantId, revision, revisionId: doc.revisionId, contentHash: doc.contentHash };
    return { dims, revision: doc, ref };
}

let chicken, rice, bun, stock;
let port, store, pending;

function list(title, ingredients, extra = {}) {
    return { kind: 'nutrition.ingredientList', schemaVersion: 1, registryVersion: 2, meal: { title, kind: 'batch_recipe', servings: { count: 4 }, ...(extra.meal || {}) }, ingredients, ...(extra.knownFacts ? { knownFacts: extra.knownFacts } : {}) };
}
const line = (lineId, g, basis = 'measured', state = 'raw') => ({ lineId, name: lineId, quantity: { g, basis }, variant: { state } });

/** Import, match against the pinned profiles, calculate, fit, and review. */
async function reviewed(source, profiles, ownerUid = 'owner') {
    let step = importWorkspaceInput(createWorkspace(ownerUid).workspace, source);
    expect(step.ok, JSON.stringify(step.errors)).toBe(true);
    const lineRefs = {}, refDims = {}, docs = new Map();
    for (const [lineId, p] of Object.entries(profiles)) { lineRefs[lineId] = p.ref; refDims[lineId] = p.dims; docs.set(p.ref.revisionId, p.revision); }
    step = await matchWorkspace(step.workspace, { lineRefs, refDims, loadRevision: async ref => ({ revision: structuredClone(docs.get(ref.revisionId)) }) });
    step = calculateWorkspace(step.workspace);
    step = fitWorkspace(step.workspace);
    step = reviewWorkspace(step.workspace);
    expect(step.ok).toBe(true);
    return step.workspace;
}

const casseroleList = (chickenG = 400) => list('Casserole', [line('chicken', chickenG), line('rice', 300, 'estimated', 'cooked')], {
    meal: { yield: { cookedTotal: { g: 900, basis: 'measured' } } },
    knownFacts: [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 1000, unit: 'kcal' } } }],
});
const casserole = (chickenG) => reviewed(casseroleList(chickenG), { chicken, rice });
const burger = () => reviewed(list('Burger', [line('chicken', 150), line('bun', 80, 'measured', 'cooked')], { meal: { kind: 'single_portion', servings: { count: 1 } } }), { chicken, bun });
const versionDocs = () => [...port.docs.keys()].filter(key => key.startsWith(PREFIX + 'mealRecordVersions/'));

beforeEach(async () => {
    flags.enabled = true;
    chicken = await profile('Chicken', { calories: 165, protein: 31, fat: 3.6 }, { state: 'raw' });
    rice = await profile('Rice', { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }, { state: 'cooked' });
    bun = await profile('Bun', { calories: 270, protein: 9, carbs: 50, fat: 4 }, { state: 'cooked' });
    stock = await profile('Stock', { calories: 20, protein: 2, sodium: 300 }, { state: 'cooked' });
    port = fakePort();
    pending = new Map();
    store = createMealStore({ port, namespace: 'default-app-id', ownerUid: 'owner', cache: {
        putPendingSave: async (d) => pending.set(d.idempotencyKey, d), deletePendingSave: async (k) => pending.delete(k), listPendingSaves: async () => [...pending.values()],
    } });
});

async function saved(workspace, options = {}) {
    const result = await commitWorkspaceMeal({ store, workspace, ...options });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return (await store.getMealVersion(result.mealRef)).record;
}

describe('meal snapshot', () => {
    it('pins every line to its profile revision and hash and keeps facts apart from calculated values', async () => {
        const workspace = await casserole();
        const built = await buildMealSnapshot(workspace);
        expect(built.ok, JSON.stringify(built)).toBe(true);
        const record = built.record;
        expect(record.lines.map(row => row.lineId)).toEqual(['chicken', 'rice']);
        for (const [row, p] of [[record.lines[0], chicken], [record.lines[1], rice]]) {
            expect(row.profile).toEqual({ kind: 'ingredient', ref: p.ref });
            expect(row.quantity).toMatchObject({ unit: 'g', gMin: null, gMax: null });
            expect(row.quantity.original).toMatchObject({ basis: row.lineId === 'rice' ? 'estimated' : 'measured' });
            expect(row.nutrients.calories.value).toBe(p.revision.nutrients.calories);
        }
        expect(record.lines[1].quantity.basis).toBe('estimated');
        // Known facts are what the user stated; calculated is what this site computed.
        expect(record.knownFacts).toHaveLength(1);
        expect(record.knownFacts[0]).toMatchObject({ factId: 'menu', provenance: 'user_stated' });
        expect(record.knownFacts[0].nutrients.calories.value).toBe(1000);
        expect(record.calculated).toEqual(JSON.parse(JSON.stringify(workspace.calculation)));
        expect(record.calculated.nutrients.calories.value).toBeGreaterThan(0);
        // #72 yield assumptions, fit, and versions.
        expect(record.assumptions).toMatchObject({ declaredCookedG: 900, mealWater: true });
        expect(record.lines.every(row => row.preparation.mealWater)).toBe(true);
        expect(record.calculated.mass.cookedG).toBeCloseTo(900, 3);
        expect(record.fit.fitVersion).toBe(FIT_VERSION);
        expect(record.versions).toMatchObject({ calculation: CALCULATION_VERSION, fit: FIT_VERSION, snapshot: 1 });
        expect(record.provenance.origins.map(row => row.lineId)).toEqual(['chicken', 'rice']);
        expect(record.review.comparisons[0].factId).toBe('menu');
        // Deterministic hash and idempotency key; the record reproduces its own totals.
        expect(record.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(record.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
        expect((await buildMealSnapshot(workspace)).record.contentHash).toBe(record.contentHash);
        expect(await verifyMealRecord(record)).toEqual([]);
        expect(recalculateMealRecord(record)).toEqual({ calculation: record.calculated, modelCalls: 0 });
        expect(built).toMatchObject({ writes: false, modelCalls: 0 });
        expect(port.docs.size).toBe(0);
    });

    it('rejects an unpinned line, a broken hash, and a workspace edited after review, and reports missing profiles as blockers', async () => {
        const { record } = await buildMealSnapshot(await casserole());
        const unpinned = structuredClone(record);
        unpinned.lines[0].profile.ref.revisionId = 'nope';
        expect(await verifyMealRecord(unpinned)).toEqual(['unpinned:chicken']);
        const tampered = structuredClone(record);
        tampered.calculated.nutrients.calories.value += 1;
        expect(await verifyMealRecord(tampered)).toEqual(['hash']);
        const edited = await casserole();
        edited.resolution = { ...edited.resolution, lines: edited.resolution.lines.map(row => row.lineId === 'chicken' ? { ...row, grams: 999 } : row) };
        expect((await buildMealSnapshot(edited)).error).toBe('calculation_stale');
        // A line with no profile yet is a blocker. Nothing is created and nothing is written.
        const missing = await reviewed(list('Soup', [line('chicken', 100), line('leek', 50, 'estimated')]), { chicken });
        const blocked = await commitWorkspaceMeal({ store, workspace: missing });
        expect(blocked).toMatchObject({ ok: false, error: 'unpinned_lines', committed: false, logged: false, blockers: [{ lineId: 'leek', reason: 'missing_profile' }] });
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });
});

describe('meal store', () => {
    it('dedupes an identical save, versions a changed graph, and keeps a stale-base save pending', async () => {
        const workspace = await casserole();
        const first = await commitWorkspaceMeal({ store, workspace });
        expect(first).toMatchObject({ ok: true, committed: true, logged: false, deduped: false });
        expect(first.mealRef).toMatchObject({ kind: 'meal', version: 1, namespace: 'default-app-id' });
        const again = await commitWorkspaceMeal({ store, workspace });
        expect(again).toMatchObject({ ok: true, committed: true, deduped: true, writes: false });
        expect(again.mealRef).toEqual(first.mealRef);
        expect(versionDocs()).toHaveLength(1);

        const changed = await commitWorkspaceMeal({ store, workspace: await casserole(450), baseVersion: 1 });
        expect(changed.ok, JSON.stringify(changed)).toBe(true);
        expect(changed.mealRef.mealId).toBe(first.mealRef.mealId);
        expect(changed.mealRef.version).toBe(2);
        const v2 = (await store.getMealVersion(changed.mealRef)).record;
        expect(v2.supersedes).toEqual({ version: 1, versionId: first.mealRef.versionId, contentHash: first.mealRef.contentHash });
        expect(v2.lines[0].quantity.g).toBe(450);
        expect(versionDocs()).toHaveLength(2);
        expect((await store.getMealHead(first.mealRef.mealId)).headVersion).toBe(2);

        // A second tab still on version 1 saves another change: conflict, kept in the outbox.
        const stale = await commitWorkspaceMeal({ store, workspace: await casserole(500), baseVersion: 1 });
        expect(stale).toMatchObject({ ok: false, error: 'meal_conflict', committed: false, logged: false, retained: true });
        const saves = await store.listPendingSaves();
        expect(saves).toHaveLength(1);
        expect(saves[0].payload.record.contentHash).toBe(stale.record.contentHash);
        expect(saves[0].payload.baseVersion).toBe(1);
        await expect(store.saveMealVersion(stale.record, { baseVersion: 1 })).rejects.toBeInstanceOf(MealVersionConflictError);
        expect(versionDocs()).toHaveLength(2);
        // The user reviews and retries on the current head.
        const retried = await store.retryPendingSave(saves[0].idempotencyKey, { record: stale.record, baseVersion: 2 });
        expect(retried.mealRef.version).toBe(3);
        expect(await store.listPendingSaves()).toHaveLength(0);
        // Saving a meal writes only meal documents, never a diary day.
        expect([...port.docs.keys()].every(key => key.startsWith(PREFIX + 'mealRecord'))).toBe(true);
    });

    it('leaves no partial record when the transaction fails, shows the failure, and commits cleanly on retry', async () => {
        const workspace = await casserole();
        port.failCommit = true;
        const failed = await commitWorkspaceMeal({ store, workspace });
        expect(failed).toMatchObject({ ok: false, error: 'save_failed', committed: false, logged: false, retained: true, message: 'Offline commit failure' });
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(1);
        port.failCommit = false;
        const retried = await store.retryPendingSave(failed.record.idempotencyKey);
        expect(retried.mealRef.version).toBe(1);
        expect(pending.size).toBe(0);
        expect(versionDocs()).toHaveLength(1);

        // A port that throws between the version write and the head write commits nothing.
        const brittle = fakePort();
        const run = brittle.runTransaction;
        brittle.runTransaction = fn => run.call(brittle, async tx => fn({ ...tx, set: (p, d) => { if (p.includes('/mealRecords/')) throw new Error('interrupted'); tx.set(p, d); } }));
        const other = createMealStore({ port: brittle, namespace: 'default-app-id', ownerUid: 'owner' });
        const interrupted = await commitWorkspaceMeal({ store: other, workspace });
        expect(interrupted).toMatchObject({ ok: false, error: 'save_failed', message: 'interrupted', committed: false });
        expect(brittle.docs.size).toBe(0);
    });

    it('lets a casserole and a burger share one profile revision with different quantities', async () => {
        const c = await saved(await casserole());
        const b = await saved(await burger());
        expect(c.mealId).not.toBe(b.mealId);
        expect(c.lines[0].profile.ref).toEqual(chicken.ref);
        expect(b.lines[0].profile.ref).toEqual(chicken.ref);
        const refs = referencesForIngredient([c, b], chicken.ref);
        expect(refs.map(row => [row.title, row.version, row.lines[0].grams]).sort()).toEqual([['Burger', 1, 150], ['Casserole', 1, 400]]);
        expect(referencesForIngredient([c, b], bun.ref).map(row => row.title)).toEqual(['Burger']);
        expect(referencesForIngredient([c, b], { ...chicken.ref, revision: 2 })).toEqual([]);
        expect(referencesForIngredient([c, b], { variantId: chicken.ref.variantId })).toHaveLength(2);
    });
});

describe('nested recipes', () => {
    async function sauceWorkspace(nested = null) {
        let workspace = await reviewed(list('Sauce', [line('stock', 200, 'measured', 'cooked'), ...(nested ? [line('extra', 50)] : [])]), { stock });
        if (nested) {
            const used = useSavedMealForLine(workspace, 'extra', nested);
            expect(used.ok).toBe(true);
            workspace = reviewWorkspace(used.workspace).workspace;
        }
        return workspace;
    }

    it('counts a nested meal once, through its own line, and rejects a cycle', async () => {
        const sauce = await saved(await sauceWorkspace());
        let bowl = await reviewed(list('Bowl', [line('rice', 200, 'measured', 'cooked'), line('sauce', 100)]), { rice });
        expect(bowl.resolution.items.find(item => item.lineId === 'sauce').kind).toBe('missing_profile');
        expect((await buildMealSnapshot(bowl)).error).toBe('unpinned_lines');
        bowl = reviewWorkspace(useSavedMealForLine(bowl, 'sauce', sauce).workspace).workspace;
        expect((await buildMealSnapshot(bowl)).blockers).toEqual([{ lineId: 'sauce', name: 'sauce', reason: 'nested_meal_unavailable' }]);
        const built = await buildMealSnapshot(bowl, { nestedMeals: [sauce] });
        expect(built.ok, JSON.stringify(built)).toBe(true);
        const record = built.record;
        expect(record.lines.map(row => row.lineId)).toEqual(['rice', 'sauce']);
        expect(record.lines[1].profile).toEqual({ kind: 'meal', mealRef: mealRefOf(sauce) });
        expect(record.graph.nestedMealIds).toEqual([sauce.mealId]);
        const expected = 200 / 100 * 130 + 100 / sauce.calculated.mass.cookedG * sauce.calculated.nutrients.calories.value;
        expect(record.calculated.nutrients.calories.value).toBeCloseTo(expected, 9);
        expect(record.calculated.nutrients.sodium.value).toBeCloseTo(100 / sauce.calculated.mass.cookedG * sauce.calculated.nutrients.sodium.value, 9);
        const savedBowl = await saved(bowl, { nestedMeals: [sauce] });

        // The sauce now tries to include the bowl, which already includes the sauce.
        const cyclic = await sauceWorkspace(savedBowl);
        const refused = await commitWorkspaceMeal({ store, workspace: cyclic, nestedMeals: [savedBowl], baseVersion: 1 });
        expect(refused).toMatchObject({ ok: false, error: 'nested_cycle', committed: false });
        const self = structuredClone(record);
        self.graph.nestedMealIds = [record.mealId];
        expect(await verifyMealRecord(self)).toContain('cycle');
    });
});

describe('diary connection', () => {
    it('builds a v1-shaped entry with mealRef and a frozen snapshot and re-portions without a model call', async () => {
        const record = await saved(await casserole());
        const built = buildDiaryMealEntry(record, { portion: { servings: 1 }, id: 'e1', timestamp: '2026-11-10T12:00:00.000Z' });
        expect(built).toMatchObject({ ok: true, modelCalls: 0, writes: false });
        const entry = built.entry;
        expect(entry).toMatchObject({ id: 'e1', name: 'Casserole', quantity: 1, timestamp: '2026-11-10T12:00:00.000Z', mealRef: mealRefOf(record) });
        for (const key of LEGACY_V1_KEYS) expect(typeof entry[key]).toBe('number');
        expect(entry.nutrientSchemaVersion).toBeUndefined();
        expect(entry.calories).toBeCloseTo(record.calculated.nutrients.calories.value / 4, 9);
        expect(Object.isFrozen(entry.mealSnapshot)).toBe(true);
        expect(Object.isFrozen(entry.mealSnapshot.nutrients.calories)).toBe(true);
        expect(entry.mealSnapshot.mealRef).toEqual(mealRefOf(record));
        expect(buildDiaryMealEntry({ ...record, version: undefined }, { id: 'x' }).error).toBe('meal_not_saved');

        const before = structuredClone(entry);
        const two = reportionDiaryMealEntry(entry, { servings: 2 });
        expect(two.modelCalls).toBe(0);
        expect(two.entry.calories).toBeCloseTo(entry.calories * 2, 9);
        expect(two.entry.protein).toBeCloseTo(entry.protein * 2, 9);
        const byWeight = reportionDiaryMealEntry(entry, { grams: record.calculated.mass.cookedG });
        expect(byWeight.entry.calories).toBeCloseTo(record.calculated.nutrients.calories.value, 9);
        expect(reportionDiaryMealEntry(entry, { grams: 0 }).error).toBe('invalid_portion');
        expect(structuredClone(entry)).toEqual(before);
    });

    it('refuses a day another tab changed, keeps flat items unchanged, and reports newer profile data without changing the entry', async () => {
        const record = await saved(await casserole());
        const { entry } = buildDiaryMealEntry(record, { portion: { servings: 1 }, id: 'meal-1', timestamp: 't' });
        const flat = { id: 'flat-1', name: 'Apple', quantity: 2, timestamp: 't0', calories: 52, protein: 0.3, carbs: 14, fat: 0.2 };
        const day = { calories: 104, protein: 0.6, carbs: 28, fat: 0.4, foodItems: [flat] };
        const readHash = await diaryDayHash(day);
        const otherTab = { ...day, calories: 204, foodItems: [...day.foodItems, { ...flat, id: 'flat-2' }] };
        expect(await planDiaryMealAdd(otherTab, entry, readHash)).toEqual({ ok: false, error: 'stale_day', writes: false });
        const dayBefore = structuredClone(day);
        const plan = await planDiaryMealAdd(day, entry, readHash);
        expect(plan.ok).toBe(true);
        expect(plan.writes).toBe(false);
        expect(day).toEqual(dayBefore);
        expect(plan.day.foodItems).toHaveLength(2);
        expect(plan.day.foodItems[0]).toBe(flat);
        expect(plan.day.calories).toBeCloseTo(104 + entry.calories, 9);
        expect(plan.dayHash).toBe(await diaryDayHash(plan.day));
        expect((await planDiaryMealAdd(plan.day, entry, plan.dayHash)).error).toBe('already_added');

        // Flat legacy items load unchanged through the shared reader and the tracker's entry normalizer.
        const flatCopy = structuredClone(flat);
        expect(readDiaryItem(flat)).toEqual({ kind: 'flat', item: flat, mealRef: null });
        expect(readDiaryItem(flat).item).toBe(flat);
        expect(readDiaryItem(entry)).toMatchObject({ kind: 'meal', mealRef: mealRefOf(record) });
        const normalized = normalizeEntry(plan.day);
        expect(normalized.foodItems[0]).toBe(flat);
        expect(normalized.foodItems[0]).toEqual(flatCopy);
        expect(normalized.foodItems[1]).toBe(entry);

        // A newer chicken revision shows a notice; the saved entry and its snapshot do not change.
        const snapshot = structuredClone(entry);
        expect(checkMealEntryFreshness(entry, { [chicken.ref.variantId]: 1 }).newDataAvailable).toBe(false);
        const fresh = checkMealEntryFreshness(entry, new Map([[chicken.ref.variantId, { headRevision: 2 }]]));
        expect(fresh).toMatchObject({ newDataAvailable: true, notice: NEW_DATA_NOTICE, modelCalls: 0, writes: false });
        expect(fresh.behind).toEqual([{ lineId: 'chicken', kind: 'ingredient', key: chicken.ref.variantId, pinned: 1, head: 2 }]);
        expect(structuredClone(entry)).toEqual(snapshot);

        // Recalculation happens only on an explicit rebuild, which makes a new record and a new entry.
        const chicken2 = await profile('Chicken', { calories: 200, protein: 30, fat: 8 }, { state: 'raw' }, 2);
        const recordBefore = structuredClone(record);
        const rebuilt = await rebuildMealRecord(record, { revisions: { chicken: { ref: chicken2.ref, revision: chicken2.revision } } });
        expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
        expect(rebuilt.modelCalls).toBe(0);
        expect(rebuilt.record.contentHash).not.toBe(record.contentHash);
        expect(rebuilt.record.lines[0].profile.ref).toEqual(chicken2.ref);
        expect(rebuilt.record.calculated.nutrients.calories.value).toBeGreaterThan(record.calculated.nutrients.calories.value);
        expect(rebuilt.record.review.needsReview).toBe(true);
        expect(await verifyMealRecord(rebuilt.record)).toEqual([]);
        expect(record).toEqual(recordBefore);
        expect(structuredClone(entry)).toEqual(snapshot);
        const next = await store.saveMealVersion(rebuilt.record, { baseVersion: 1 });
        expect(next.mealRef.version).toBe(2);
        expect(structuredClone(entry)).toEqual(snapshot);
        expect((await rebuildMealRecord(record, { revisions: { chicken: { ref: chicken2.ref, revision: { ...chicken2.revision, nutrients: { calories: 1 } } } } })).error).toBe('invalid_revision');
    });
});

describe('export and import', () => {
    it('round-trips a saved record with the same hash and rejects tampering', async () => {
        const record = await saved(await casserole());
        const json = exportMealRecord(record);
        const back = await importMealRecord(json);
        expect(back.ok).toBe(true);
        expect(back.record.contentHash).toBe(record.contentHash);
        expect(back.record).toEqual(record);
        expect(mealContent(back.record)).toEqual(mealContent(record));
        const body = JSON.parse(json);
        body.record.lines[0].quantity.g = 401;
        expect(await importMealRecord(JSON.stringify(body))).toMatchObject({ ok: false, error: 'hash_mismatch', writes: false });
        const newer = JSON.parse(json);
        newer.record.schemaVersion = 2;
        expect((await importMealRecord(newer)).error).toBe('newer_schema');
        expect((await importMealRecord('{not json')).error).toBe('invalid_json');
        expect((await importMealRecord({ kind: 'other', schemaVersion: 1, record })).error).toBe('invalid_export');
    });
});

describe('write flags off', () => {
    it('returns exactly the export-only save result and writes nothing', async () => {
        const workspace = await casserole();
        flags.enabled = false;
        const result = commitWorkspaceMeal({ store, workspace });
        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual(saveWorkspace(workspace));
        expect(result.workspace.save).toEqual({ available: false, logged: false, reason: WORKSPACE_SAVE_REASON });
        expect(result.workspace.committed).toBe(false);
        expect(result.workspace.exportCopy.text).toContain('chicken');
        expect(commitWorkspaceMeal()).toEqual(saveWorkspace(undefined));
        const { record } = await buildMealSnapshot(workspace);
        await expect(store.saveMealVersion(record)).rejects.toBeInstanceOf(IngredientWritesDisabledError);
        expect(port.docs.size).toBe(0);
        expect(pending.size).toBe(0);
    });

    it('keeps both write flags false in the real capabilities file', async () => {
        const real = await vi.importActual('../../../shared/nutrition/capabilities.js');
        expect(real.INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
        expect(real.NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    });
});
