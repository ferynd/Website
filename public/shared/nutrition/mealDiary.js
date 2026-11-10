import { scalePerBasis } from './calculate.js';
import { contentHashOf } from './contentHash.js';
import { LEGACY_V1_KEYS } from './nutrientRegistry.js';
import { mealRefOf, parseMealRef } from './mealSnapshot.js';

/**
 * #64 Part B diary connection, pure only. These functions build a legacy v1 diary item that also holds
 * a `mealRef` and a frozen snapshot, and plan adding it to a day. They write nothing: the tracker's
 * diary writer (services/firebase.js) is unchanged, and adding a meal to the diary stays an explicit,
 * separate action from saving it.
 */
export const DIARY_MEAL_SNAPSHOT_VERSION = 1;
export const NEW_DATA_NOTICE = 'New data available for an ingredient in this meal. The logged totals are unchanged until you recalculate.';

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function plain(value) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** The frozen part of a diary entry: totals for the whole meal plus the pins needed for a freshness check. */
function frozenSnapshot(record, mealRef) {
    const nutrients = {};
    for (const [key, item] of Object.entries(record.calculated?.nutrients || {})) {
        nutrients[key] = { value: item?.value ?? null, low: item?.low ?? null, high: item?.high ?? null, status: item?.status || 'unknown' };
    }
    return deepFreeze(plain({
        schemaVersion: DIARY_MEAL_SNAPSHOT_VERSION,
        mealRef,
        title: record.title,
        servings: record.meal?.servings ?? null,
        cookedG: record.calculated?.mass?.cookedG ?? null,
        calculationVersion: record.calculated?.calculationVersion ?? null,
        nutrients,
        adjustedCarbs: record.calculated?.adjustedCarbs ?? null,
        fodmapEquivalents: record.calculated?.fodmapEquivalents ?? null,
        pins: record.lines.filter(line => line.counted && line.profile).map(line => ({
            lineId: line.lineId,
            kind: line.profile.kind,
            ...(line.profile.kind === 'ingredient'
                ? { variantId: line.profile.ref.variantId, revision: line.profile.ref.revision, contentHash: line.profile.ref.contentHash }
                : { mealId: line.profile.mealRef.mealId, version: line.profile.mealRef.version, contentHash: line.profile.mealRef.contentHash }),
        })),
    }));
}

/** Scale one whole-meal value to the portion with the ordinary per-basis rule. */
function portionScale(frozen, portion) {
    if (Number.isFinite(portion?.fraction) && portion.fraction > 0) return { amount: portion.fraction, basis: 1 };
    if (Number.isFinite(portion?.servings) && portion.servings > 0 && Number.isFinite(frozen.servings) && frozen.servings > 0) return { amount: portion.servings, basis: frozen.servings };
    if (Number.isFinite(portion?.grams) && portion.grams > 0 && Number.isFinite(frozen.cookedG) && frozen.cookedG > 0) return { amount: portion.grams, basis: frozen.cookedG };
    return null;
}

function entryFrom(frozen, portion, identity) {
    const scale = portionScale(frozen, portion);
    if (!scale) return { ok: false, error: 'invalid_portion', modelCalls: 0, writes: false };
    const fields = {};
    const zeroFilled = [];
    for (const key of LEGACY_V1_KEYS) {
        const value = scalePerBasis(scale.amount, frozen.nutrients[key]?.value, scale.basis);
        // v1 diary items hold numbers only; an unknown is stored as 0 and reported, as the legacy writer does.
        if (value == null) zeroFilled.push(key);
        fields[key] = value ?? 0;
    }
    const entry = {
        id: identity.id,
        name: identity.name ?? frozen.title,
        quantity: 1,
        timestamp: identity.timestamp ?? null,
        ...fields,
        mealRef: { ...frozen.mealRef },
        mealPortion: { ...plain(portion), fraction: scale.amount / scale.basis },
        mealSnapshot: frozen,
    };
    return { ok: true, entry, zeroFilled, modelCalls: 0, writes: false };
}

/**
 * A legacy v1 diary item (id, name, quantity, timestamp, the 24 v1 numbers for the portion) plus
 * `mealRef`, `mealPortion`, and a frozen `mealSnapshot`. `portion` is `{ servings }`, `{ grams }` of the
 * cooked meal, or `{ fraction }`. The record must be a saved meal version.
 */
export function buildDiaryMealEntry(record, { portion = { servings: 1 }, id = null, timestamp = null, name = null } = {}) {
    const mealRef = mealRefOf(record);
    if (!mealRef) return { ok: false, error: 'meal_not_saved', modelCalls: 0, writes: false };
    if (typeof id !== 'string' || !id) return { ok: false, error: 'id_required', modelCalls: 0, writes: false };
    return entryFrom(frozenSnapshot(record, mealRef), portion, { id, timestamp, name });
}

/** Re-portion from the entry's own frozen snapshot. Ordinary calculation code, no model call, no profile read. */
export function reportionDiaryMealEntry(entry, portion) {
    if (!entry?.mealSnapshot || !parseMealRef(entry.mealRef)) return { ok: false, error: 'not_a_meal_entry', modelCalls: 0, writes: false };
    return entryFrom(entry.mealSnapshot, portion, { id: entry.id, timestamp: entry.timestamp, name: entry.name });
}

/** A hash of a day document as read. Pass it back to planDiaryMealAdd to detect another tab's edit. */
export async function diaryDayHash(dayDoc) {
    return contentHashOf(plain(dayDoc ?? null));
}

/**
 * Plan adding a meal entry to a day. Refuses with `stale_day` when the day no longer hashes to
 * `expectedDayHash` (it changed since it was read, for example in another tab). Returns the next day
 * document and its hash; the caller decides whether and how to write it. The input day is not mutated.
 */
export async function planDiaryMealAdd(dayDoc, entry, expectedDayHash) {
    if (!entry?.id || !parseMealRef(entry.mealRef) || !entry.mealSnapshot) return { ok: false, error: 'invalid_entry', writes: false };
    if (await diaryDayHash(dayDoc) !== expectedDayHash) return { ok: false, error: 'stale_day', writes: false };
    const items = Array.isArray(dayDoc?.foodItems) ? dayDoc.foodItems : [];
    if (items.some(item => item?.id === entry.id)) return { ok: false, error: 'already_added', writes: false };
    const day = { ...(dayDoc || {}), foodItems: [...items, entry] };
    const quantity = Number.isFinite(entry.quantity) ? entry.quantity : 1;
    // The same day-total rule the tracker uses when it logs a staged food.
    for (const key of LEGACY_V1_KEYS) {
        const amount = typeof entry[key] === 'number' && Number.isFinite(entry[key]) ? entry[key] : 0;
        day[key] = (parseFloat(day[key]) || 0) + quantity * amount;
    }
    return { ok: true, day, dayHash: await diaryDayHash(day), writes: false };
}

/**
 * Read one diary item. A flat (legacy, snapshot-less) item is passed through as the same object.
 * A meal item is also returned unchanged, with its parsed ref beside it.
 */
export function readDiaryItem(item) {
    if (!item || typeof item !== 'object' || item.mealRef == null) return { kind: 'flat', item, mealRef: null };
    const mealRef = parseMealRef(item.mealRef);
    return { kind: mealRef && item.mealSnapshot ? 'meal' : 'invalid_meal', item, mealRef };
}

function headOf(heads, key) {
    const head = heads instanceof Map ? heads.get(key) : heads?.[key];
    if (Number.isSafeInteger(head)) return head;
    return head?.headRevision ?? head?.headVersion ?? null;
}

/**
 * Report whether a newer profile revision (or nested meal version) exists for an entry's pins.
 * `heads` maps variantId (or mealId) to a head number or a head document. Pure: the entry is not changed
 * and nothing is recalculated. Recalculation is only `rebuildMealRecord` plus a new diary entry.
 */
export function checkMealEntryFreshness(entry, heads = {}) {
    const pins = entry?.mealSnapshot?.pins || [];
    const behind = [];
    for (const pin of pins) {
        const key = pin.kind === 'meal' ? pin.mealId : pin.variantId;
        const pinned = pin.kind === 'meal' ? pin.version : pin.revision;
        const head = headOf(heads, key);
        if (Number.isSafeInteger(head) && head > pinned) behind.push({ lineId: pin.lineId, kind: pin.kind, key, pinned, head });
    }
    return { newDataAvailable: behind.length > 0, behind, notice: behind.length ? NEW_DATA_NOTICE : null, modelCalls: 0, writes: false };
}
