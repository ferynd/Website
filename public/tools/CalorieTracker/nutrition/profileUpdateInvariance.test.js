// V6 profile-update invariance (James's 2026-11-10 rollout decision V6): updating an ingredient profile
// never silently changes a saved meal record or a historical diary entry. A profile update lands as a NEW
// revision; saved meals and diary entries change only through the explicit rebuildMealRecord path.
//
// Pure functions only. The write flags are NOT mocked here: the real capabilities.js keeps both false,
// nothing is written, and the flag-gated meal / ingredient stores are not exercised (that live-store path
// is covered by the #79 beta validation). A "saved" meal is the pure record plus the unhashed store fields
// the meal store adds (namespace, version, versionId), stamped here exactly as mealStore.saveMealVersion
// would. All profiles and values are synthetic.
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, contentHashOf } from '../../../shared/nutrition/contentHash.js';
import { emptyStagedRecord, LEGACY_V1_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft, validateRevision, verifyRevisionHash } from '../../../shared/nutrition/ingredientProfile.js';
import { privateIdentityId, privateVariantId } from '../../../shared/nutrition/ingredientIds.js';
import { calculateWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, matchWorkspace, reviewWorkspace } from '../../../shared/nutrition/importWorkspace.js';
import {
    buildMealSnapshot, mealContent, mealRefOf, mealVersionIdFor, rebuildMealRecord, recalculateMealRecord, referencesForIngredient, verifyMealRecord,
} from '../../../shared/nutrition/mealSnapshot.js';
import {
    buildDiaryMealEntry, checkMealEntryFreshness, diaryDayHash, NEW_DATA_NOTICE, planDiaryMealAdd, readDiaryItem, reportionDiaryMealEntry,
} from '../../../shared/nutrition/mealDiary.js';
import * as capabilities from '../../../shared/nutrition/capabilities.js';

const NAMESPACE = 'default-app-id';
const OWNER = 'owner';

/** Synthetic ingredient A, revision 1 and the updated revision 2 (different values, same variant). */
const A_R1 = { calories: 150, protein: 20, carbs: 0, fat: 7 };
const A_R2 = { calories: 210, protein: 18, carbs: 4, fat: 13 };
/** Synthetic ingredient B, never updated. */
const B_R1 = { calories: 120, protein: 3, carbs: 25, fat: 1 };

async function variantOf(name, state) {
    const identityId = await privateIdentityId({ canonicalName: name, category: 'other', kind: 'food' });
    return { identityId, variantId: await privateVariantId(identityId, { state }), state };
}

/** A revision draft from synthetic values. `base` is the revision it supersedes (the update path). */
async function draftFor(variant, values, base = null) {
    const stagedRecord = emptyStagedRecord();
    for (const [key, value] of Object.entries(values)) { stagedRecord.values[key] = value; stagedRecord.quality[key] = { status: 'measured' }; }
    return buildRevisionDraft({
        identityId: variant.identityId, variantId: variant.variantId, stagedRecord, base,
        basis: { kind: 'per_100g_edible', state: variant.state },
        fieldProvenance: Object.fromEntries(Object.keys(values).map(key => [key, { sourceKey: 'manual' }])),
        sources: { manual: { type: 'manual', title: 'Synthetic profile' } },
    });
}

/** A stored revision document and its pinned ref, shaped as ingredientStore stores them. */
function stored(draft, revision) {
    const doc = { ...draft, ownerUid: OWNER, revision, revisionId: draft.variantId + '~r' + revision, idempotencyKey: 'test-r' + revision, createdAt: 0 };
    const ref = { refVersion: 1, scope: 'private', namespace: NAMESPACE, identityId: doc.identityId, variantId: doc.variantId, revision, revisionId: doc.revisionId, contentHash: doc.contentHash };
    return { revision: doc, ref };
}

const line = (lineId, g, state) => ({ lineId, name: lineId, quantity: { g, basis: 'measured' }, variant: { state } });
const source = {
    kind: 'nutrition.ingredientList', schemaVersion: 1, registryVersion: 2,
    meal: { title: 'Synthetic bowl', kind: 'batch_recipe', servings: { count: 2 } },
    ingredients: [line('a', 200, 'raw'), line('b', 300, 'cooked')],
};

/** Import, match against the given pinned profiles, calculate, fit, review. */
async function reviewedWorkspace(profiles) {
    let step = importWorkspaceInput(createWorkspace(OWNER).workspace, source);
    expect(step.ok, JSON.stringify(step.errors)).toBe(true);
    const lineRefs = {}, refDims = {}, docs = new Map();
    for (const [lineId, p] of Object.entries(profiles)) { lineRefs[lineId] = p.ref; refDims[lineId] = { state: p.revision.basis.state }; docs.set(p.ref.revisionId, p.revision); }
    step = await matchWorkspace(step.workspace, { lineRefs, refDims, loadRevision: async ref => ({ revision: structuredClone(docs.get(ref.revisionId)) }) });
    step = reviewWorkspace(fitWorkspace(calculateWorkspace(step.workspace).workspace).workspace);
    expect(step.ok).toBe(true);
    return step.workspace;
}

/** The record as the meal store would hold it: the unhashed store fields beside the hashed content. */
function asSaved(record, version = 1) {
    return { ...record, namespace: NAMESPACE, version, versionId: mealVersionIdFor(record.mealId, version), supersedes: null, createdAt: 0 };
}

const expectedCalories = (aValues, bValues) => 200 / 100 * aValues.calories + 300 / 100 * bValues.calories;

let variantA, variantB, a1, a2, b1, a2Draft, a1Snapshot;
let savedMeal, savedMealCanonical, savedMealHash, entry, entryCanonical, dayWithEntry, dayHash;

beforeEach(async () => {
    variantA = await variantOf('Synthetic ingredient A', 'raw');
    variantB = await variantOf('Synthetic ingredient B', 'cooked');
    a1 = stored(await draftFor(variantA, A_R1), 1);
    b1 = stored(await draftFor(variantB, B_R1), 1);

    // The meal is saved and logged while revision 1 is the library head.
    const built = await buildMealSnapshot(await reviewedWorkspace({ a: a1, b: b1 }));
    expect(built.ok, JSON.stringify(built)).toBe(true);
    savedMeal = asSaved(built.record);
    expect(await verifyMealRecord(savedMeal)).toEqual([]);
    savedMealCanonical = canonicalJson(savedMeal);
    savedMealHash = savedMeal.contentHash;
    const made = buildDiaryMealEntry(savedMeal, { portion: { servings: 1 }, id: 'entry-1', timestamp: '2026-11-10T12:00:00.000Z' });
    expect(made.ok).toBe(true);
    entry = made.entry;
    entryCanonical = canonicalJson(entry);
    const emptyDay = { foodItems: [] };
    const planned = await planDiaryMealAdd(emptyDay, entry, await diaryDayHash(emptyDay));
    expect(planned.ok).toBe(true);
    dayWithEntry = planned.day;
    dayHash = planned.dayHash;

    // The profile update: revision 2 of ingredient A, drafted against revision 1 as the new library head.
    a1Snapshot = canonicalJson(a1.revision);
    a2Draft = await draftFor(variantA, A_R2, a1.revision);
    a2 = stored(a2Draft, 2);
});

describe('V6 fixture sanity', () => {
    it('revision 2 is a genuinely different revision of the same variant', async () => {
        expect(a2.revision.variantId).toBe(a1.revision.variantId);
        expect(a2.revision.revision).toBe(2);
        expect(a2.revision.revisionId).not.toBe(a1.revision.revisionId);
        expect(a2.revision.contentHash).not.toBe(a1.revision.contentHash);
        expect(a2.revision.nutrients.calories).toBe(A_R2.calories);
        expect(a2.revision.supersedes).toEqual({ revision: 1, revisionId: a1.revision.revisionId, contentHash: a1.revision.contentHash });
        expect(await verifyRevisionHash(a2.revision)).toBe(true);
        // The saved meal really was calculated from revision 1, so a silent switch to revision 2 would be visible.
        expect(savedMeal.calculated.nutrients.calories.value).toBeCloseTo(expectedCalories(A_R1, B_R1), 9);
        expect(expectedCalories(A_R2, B_R1)).not.toBeCloseTo(expectedCalories(A_R1, B_R1), 3);
        expect(savedMeal.lines.find(row => row.lineId === 'a').profile.ref).toEqual(a1.ref);
    });

    it('runs with both real write flags false', () => {
        expect(capabilities.INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
        expect(capabilities.NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    });
});

describe('V6 profile update does not change saved meals or diary entries', () => {
    it('case 1: the saved meal record is byte-identical and its content hash still verifies after revision 2 exists', async () => {
        expect(canonicalJson(savedMeal)).toBe(savedMealCanonical);
        expect(savedMeal.contentHash).toBe(savedMealHash);
        expect(await contentHashOf(mealContent(savedMeal))).toBe(savedMealHash);
        expect(await verifyMealRecord(savedMeal)).toEqual([]);
        // The meal is still listed against revision 1, and nothing pins revision 2.
        expect(referencesForIngredient([savedMeal], a1.ref).map(row => row.mealId)).toEqual([savedMeal.mealId]);
        expect(referencesForIngredient([savedMeal], a2.ref)).toEqual([]);
    });

    it('case 2: recalculateMealRecord still returns the revision-1 totals (pinned data only, never the new head)', () => {
        const { calculation, modelCalls } = recalculateMealRecord(savedMeal);
        expect(modelCalls).toBe(0);
        expect(calculation).toEqual(savedMeal.calculated);
        expect(calculation.nutrients.calories.value).toBeCloseTo(expectedCalories(A_R1, B_R1), 9);
        expect(calculation.nutrients.calories.value).not.toBeCloseTo(expectedCalories(A_R2, B_R1), 3);
        expect(canonicalJson(savedMeal)).toBe(savedMealCanonical);
    });

    it('case 3: the diary entry keeps its frozen totals and snapshot, and readDiaryItem returns the original values', () => {
        expect(canonicalJson(entry)).toBe(entryCanonical);
        expect(entry.calories).toBeCloseTo(expectedCalories(A_R1, B_R1) / 2, 9);
        expect(entry.mealSnapshot.nutrients.calories.value).toBeCloseTo(expectedCalories(A_R1, B_R1), 9);
        expect(entry.mealSnapshot.pins.find(pin => pin.lineId === 'a')).toEqual({ lineId: 'a', kind: 'ingredient', variantId: variantA.variantId, revision: 1, contentHash: a1.ref.contentHash });
        expect(Object.isFrozen(entry.mealSnapshot)).toBe(true);
        const read = readDiaryItem(entry);
        expect(read.kind).toBe('meal');
        expect(read.item).toBe(entry);
        expect(read.mealRef).toEqual(mealRefOf(savedMeal));
        for (const key of LEGACY_V1_KEYS) expect(read.item[key]).toBe(JSON.parse(entryCanonical)[key]);
        // The same holds for the copy inside the logged day.
        expect(readDiaryItem(dayWithEntry.foodItems[0]).item.calories).toBe(entry.calories);
    });

    it('case 4: reportionDiaryMealEntry scales the frozen totals, not the revision-2 values', () => {
        const two = reportionDiaryMealEntry(entry, { servings: 2 });
        expect(two.ok).toBe(true);
        expect(two.modelCalls).toBe(0);
        expect(two.entry.calories).toBeCloseTo(expectedCalories(A_R1, B_R1), 9);
        expect(two.entry.calories).not.toBeCloseTo(expectedCalories(A_R2, B_R1), 3);
        expect(two.entry.mealSnapshot).toBe(entry.mealSnapshot);
        const half = reportionDiaryMealEntry(entry, { fraction: 0.25 });
        expect(half.entry.fat).toBeCloseTo((200 / 100 * A_R1.fat + 300 / 100 * B_R1.fat) * 0.25, 9);
        expect(canonicalJson(entry)).toBe(entryCanonical);
    });

    it('case 5: checkMealEntryFreshness against the revision-2 head reports new data and does not mutate the entry', () => {
        const before = structuredClone(entry);
        const head = { [variantA.variantId]: { headRevision: a2.revision.revision, headRevisionId: a2.revision.revisionId, headContentHash: a2.revision.contentHash } };
        const fresh = checkMealEntryFreshness(entry, head);
        expect(fresh).toMatchObject({ newDataAvailable: true, notice: NEW_DATA_NOTICE, modelCalls: 0, writes: false });
        expect(fresh.behind).toEqual([{ lineId: 'a', kind: 'ingredient', key: variantA.variantId, pinned: 1, head: 2 }]);
        // A numeric head reports the same; the unchanged ingredient B is not reported.
        expect(checkMealEntryFreshness(entry, { [variantA.variantId]: 2, [variantB.variantId]: 1 }).behind.map(row => row.lineId)).toEqual(['a']);
        // The notice is the only effect: the totals are untouched.
        expect(fresh).not.toHaveProperty('entry');
        expect(structuredClone(entry)).toEqual(before);
        expect(canonicalJson(entry)).toBe(entryCanonical);
        expect(readDiaryItem(entry).item.calories).toBe(before.calories);
    });

    it('case 6: drafting and validating revision 2 does not mutate the revision-1 document', async () => {
        // a2Draft was built with a1.revision as `base` in beforeEach; draft it once more to be sure.
        const again = await draftFor(variantA, A_R2, a1.revision);
        expect(again.contentHash).toBe(a2Draft.contentHash);
        expect(validateRevision(a2.revision)).toEqual([]);
        expect(canonicalJson(a1.revision)).toBe(a1Snapshot);
        expect(a1.revision.nutrients.calories).toBe(A_R1.calories);
        expect(a1.revision.revision).toBe(1);
        expect(await verifyRevisionHash(a1.revision)).toBe(true);
        expect(a1.revision.contentHash).toBe(a1.ref.contentHash);
    });

    it('case 7: only rebuildMealRecord changes totals, as a NEW record pinned to revision 2; the original is unchanged', async () => {
        const rebuilt = await rebuildMealRecord(savedMeal, { revisions: { a: { ref: a2.ref, revision: a2.revision } } });
        expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
        expect(rebuilt).toMatchObject({ modelCalls: 0, writes: false });
        const next = rebuilt.record;
        expect(next).not.toBe(savedMeal);
        expect(next.contentHash).not.toBe(savedMealHash);
        expect(next.lines.find(row => row.lineId === 'a').profile.ref).toEqual(a2.ref);
        expect(next.lines.find(row => row.lineId === 'b').profile.ref).toEqual(b1.ref);
        expect(next.calculated.nutrients.calories.value).toBeCloseTo(expectedCalories(A_R2, B_R1), 9);
        expect(next.rebuiltFrom).toEqual({ mealId: savedMeal.mealId, version: 1, contentHash: savedMealHash });
        expect(next.review.needsReview).toBe(true);
        expect(await verifyMealRecord(next)).toEqual([]);
        // The rebuilt record is unsaved: it has no version, so it cannot be logged until the user saves it.
        expect(next.version).toBeUndefined();
        expect(buildDiaryMealEntry(next, { id: 'entry-2' }).error).toBe('meal_not_saved');
        // The original record, the existing entry, and the logged day are all unchanged.
        expect(canonicalJson(savedMeal)).toBe(savedMealCanonical);
        expect(await verifyMealRecord(savedMeal)).toEqual([]);
        expect(canonicalJson(entry)).toBe(entryCanonical);
        expect(await diaryDayHash(dayWithEntry)).toBe(dayHash);
        // Once saved as version 2, a NEW entry carries the revision-2 totals; the old entry still does not.
        const v2Entry = buildDiaryMealEntry(asSaved(next, 2), { portion: { servings: 1 }, id: 'entry-2' }).entry;
        expect(v2Entry.calories).toBeCloseTo(expectedCalories(A_R2, B_R1) / 2, 9);
        expect(entry.calories).toBeCloseTo(expectedCalories(A_R1, B_R1) / 2, 9);
    });

    it('case 8: a diary day holding the frozen entry is not altered by the update, and the day-hash guard still matches', async () => {
        const before = structuredClone(dayWithEntry);
        expect(await diaryDayHash(dayWithEntry)).toBe(dayHash);
        expect(dayWithEntry.foodItems[0]).toBe(entry);
        expect(dayWithEntry.calories).toBeCloseTo(entry.calories, 9);
        // Planning another add against the hash read before the update still succeeds: the update did not touch the day.
        const other = buildDiaryMealEntry(savedMeal, { portion: { servings: 1 }, id: 'entry-3' }).entry;
        const plan = await planDiaryMealAdd(dayWithEntry, other, dayHash);
        expect(plan.ok, JSON.stringify(plan)).toBe(true);
        expect(plan.day.foodItems[0]).toBe(entry);
        expect(canonicalJson(plan.day.foodItems[0])).toBe(entryCanonical);
        expect(plan.day.foodItems[1].calories).toBeCloseTo(expectedCalories(A_R1, B_R1) / 2, 9);
        expect(plan.day.calories).toBeCloseTo(2 * entry.calories, 9);
        expect(dayWithEntry).toEqual(before);
        // Re-adding the frozen entry itself is refused rather than duplicated or replaced.
        expect((await planDiaryMealAdd(dayWithEntry, entry, dayHash)).error).toBe('already_added');
        // A day that was changed in place (as a silent recalculation would) fails the guard.
        const silentlyRecalculated = { ...dayWithEntry, calories: expectedCalories(A_R2, B_R1) / 2 };
        expect((await planDiaryMealAdd(silentlyRecalculated, other, dayHash)).error).toBe('stale_day');
    });

    it('case 9: a saved record edited in place to look like revision 2 fails verifyMealRecord', async () => {
        const rebuilt = (await rebuildMealRecord(savedMeal, { revisions: { a: { ref: a2.ref, revision: a2.revision } } })).record;
        // Pin swapped to revision 2 only.
        const pinOnly = structuredClone(savedMeal);
        pinOnly.lines.find(row => row.lineId === 'a').profile.ref = structuredClone(a2.ref);
        expect(await verifyMealRecord(pinOnly)).toEqual(['hash']);
        // Pin, per-100 g inputs, and totals all copied from the honest rebuild, keeping the old hash.
        const lookalike = structuredClone(savedMeal);
        lookalike.lines = structuredClone(rebuilt.lines);
        lookalike.calculated = structuredClone(rebuilt.calculated);
        expect(canonicalJson(recalculateMealRecord(lookalike).calculation)).toBe(canonicalJson(lookalike.calculated));
        expect(await verifyMealRecord(lookalike)).toEqual(['hash']);
        // Totals edited without the inputs.
        const totalsOnly = structuredClone(savedMeal);
        totalsOnly.calculated.nutrients.calories.value = expectedCalories(A_R2, B_R1);
        expect(await verifyMealRecord(totalsOnly)).toEqual(['hash']);
        // Re-stamping the hash still cannot hide an input edit: the idempotency key no longer matches.
        const rehashed = structuredClone(lookalike);
        rehashed.contentHash = await contentHashOf(mealContent(rehashed));
        expect(await verifyMealRecord(rehashed)).toEqual(['idempotencyKey']);
        // A tampered record cannot be rebuilt either.
        expect((await rebuildMealRecord(lookalike, { revisions: {} })).error).toBe('invalid_record');
        expect(canonicalJson(savedMeal)).toBe(savedMealCanonical);
    });
});
