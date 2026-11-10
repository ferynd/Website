import { ADJUSTED_CARB_VERSION, calculateMeal, CALCULATION_VERSION, countedLines, FIBER_WEIGHT_VERSION, FODMAP_EQUIVALENT_VERSION } from './calculate.js';
import { FIT_VERSION } from './fit.js';
import { canonicalJson, contentHashOf, sha256Hex } from './contentHash.js';
import { parseIngredientRef } from './ingredientRefs.js';
import { verifyRevisionHash } from './ingredientProfile.js';
import { effectiveLine } from './import/index.js';
import { PROFILE_FIELDS } from './research/profileFields.js';

/**
 * #64 Part B meal snapshots. A meal record freezes one reviewed Import workspace: every counted line
 * pinned to a profile revision (or a saved meal version), its quantity and preparation, the per-100 g
 * values the calculation used, known facts kept apart from calculated values, the #72 yield assumptions,
 * the fit, the import provenance, and the calculation. Everything here is pure: nothing is read from or
 * written to Firestore, the diary, or a profile.
 */
export const MEAL_RECORD_KIND = 'nutrition.mealRecord';
export const MEAL_SCHEMA_VERSION = 1;
export const MEAL_SNAPSHOT_VERSION = 1;
export const MEAL_EXPORT_KIND = 'nutrition.mealRecordExport';
/** Fields the store adds. They are not content and are not hashed. */
export const MEAL_STORE_FIELDS = Object.freeze(['contentHash', 'idempotencyKey', 'namespace', 'version', 'versionId', 'supersedes', 'createdAt']);

const MEAL_ID = /^ml-[a-f0-9]{20}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;

/** Drop undefined and non-finite values so content hashes the same way after a JSON round trip. */
function plain(value) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** A stable meal identity across versions. Callers may pass their own `ml-` id. */
export async function mealIdFor(ownerUid, key) {
    return 'ml-' + (await sha256Hex(String(ownerUid) + '|' + String(key ?? '').normalize('NFKC').trim().toLowerCase())).slice(0, 20);
}

export function mealVersionIdFor(mealId, version) {
    if (!MEAL_ID.test(mealId) || !Number.isSafeInteger(version) || version < 1) throw new TypeError('Invalid meal version');
    return mealId + '~v' + version;
}

/** A pinned saved-meal version, or null. */
export function parseMealRef(raw) {
    const valid = raw && raw.refVersion === 1 && raw.kind === 'meal' && typeof raw.namespace === 'string' && raw.namespace.length > 0
        && MEAL_ID.test(raw.mealId) && Number.isSafeInteger(raw.version) && raw.version >= 1
        && raw.versionId === raw.mealId + '~v' + raw.version && HASH.test(raw.contentHash);
    if (!valid) return null;
    return { refVersion: 1, kind: 'meal', namespace: raw.namespace, mealId: raw.mealId, version: raw.version, versionId: raw.versionId, contentHash: raw.contentHash };
}

/** The ref of a saved meal version, or null for a record the store has not saved. */
export function mealRefOf(record) {
    return parseMealRef({ refVersion: 1, kind: 'meal', namespace: record?.namespace, mealId: record?.mealId, version: record?.version, versionId: record?.versionId, contentHash: record?.contentHash });
}

/** The hashed part of a record: everything except the store fields. */
export function mealContent(record) {
    const content = {};
    for (const [key, value] of Object.entries(record || {})) if (!MEAL_STORE_FIELDS.includes(key)) content[key] = value;
    return content;
}

async function stamp(content) {
    const contentHash = await contentHashOf(content);
    const idempotencyKey = await sha256Hex(content.ownerUid + '|' + content.mealId + '|' + contentHash);
    return { ...content, contentHash, idempotencyKey };
}

/** Inputs calculateMeal reads, rebuilt from a record's own lines. */
function calculationLines(record) {
    return record.lines.map(line => ({
        lineId: line.lineId,
        parentLineId: line.parentLineId ?? undefined,
        grams: line.quantity.g,
        gMin: line.quantity.gMin,
        gMax: line.quantity.gMax,
        quantityBasis: line.quantity.basis,
        yieldRetention: line.preparation.yieldRetention ?? undefined,
        waterDeltaG: line.preparation.waterDeltaG ?? undefined,
        fatAbsorbedG: line.preparation.fatAbsorbedG ?? undefined,
        fatDiscardedG: line.preparation.fatDiscardedG ?? undefined,
        fatAbsorbedExternal: line.preparation.fatAbsorbedExternal ?? undefined,
        fiberCategory: line.fiber.category ?? undefined,
        fiberComponents: line.fiber.components ?? undefined,
        nutrients: line.nutrients || {},
    }));
}

/** Recalculate a record from its own pinned inputs. Ordinary calculation code; no model call. */
export function recalculateMealRecord(record) {
    return { calculation: plain(calculateMeal({ lines: calculationLines(record) })), modelCalls: 0 };
}

/**
 * Per-100 g values of a saved meal's cooked mass, used when that meal is a line of another meal. The
 * nested meal's own lines are not copied, so they are counted once, through this one line.
 * Calculated statuses become `calculated`; estimated ones stay estimates.
 */
export function mealNutrientsPer100g(record) {
    const cooked = record?.calculated?.mass?.cookedG;
    if (!Number.isFinite(cooked) || cooked <= 0) return null;
    const per = value => Number.isFinite(value) ? value / cooked * 100 : null;
    const nutrients = {};
    for (const key of PROFILE_FIELDS) {
        const item = record.calculated.nutrients?.[key];
        if (!item || item.value == null) { nutrients[key] = { value: null, status: 'unknown' }; continue; }
        nutrients[key] = { value: per(item.value), low: per(item.low ?? item.value), high: per(item.high ?? item.value), status: item.status === 'estimated' ? 'estimated_from_comparable' : 'calculated' };
    }
    return nutrients;
}

/**
 * Use a saved meal version as one line of the workspace (a nested recipe). The line's nutrients become
 * the nested meal's per-100 g cooked values and the calculation is redone; review must run again.
 */
export function useSavedMealForLine(workspace, lineId, record) {
    if (!workspace?.resolution) return { ok: false, error: 'match_required', workspace };
    const mealRef = mealRefOf(record);
    if (!mealRef) return { ok: false, error: 'meal_not_saved', workspace };
    const nutrients = mealNutrientsPer100g(record);
    if (!nutrients) return { ok: false, error: 'meal_mass_unknown', workspace };
    if (!workspace.resolution.items.some(item => item.lineId === lineId)) return { ok: false, error: 'unknown_line', workspace };
    const items = workspace.resolution.items.map(item => item.lineId !== lineId ? item : {
        ...item, kind: 'resolved', resolved: true, missingFields: [], estimate: false, source: 'meal', mealRef, nutrients,
    });
    const resolution = { ...workspace.resolution, items, modelCalls: 0 };
    const lines = resolution.lines.map(line => ({ ...line, nutrients: items.find(row => row.lineId === line.lineId)?.nutrients || {}, quantityBasis: items.find(row => row.lineId === line.lineId)?.estimate ? 'estimated' : line.quantityBasis }));
    return { ok: true, workspace: { ...workspace, resolution, calculation: calculateMeal({ lines }), review: null, stage: 'review', modelCalls: 0 } };
}

function blockerReason(item) {
    if (!item || item.kind === 'missing_profile') return 'missing_profile';
    if (item.kind === 'needs_confirmation') return 'needs_confirmation';
    return 'unpinned_revision';
}

function refFor(item) {
    return item?.selectedRef || item?.match?.ref || null;
}

/**
 * Build a validated, hash-stamped meal record from a reviewed workspace. Lines whose profile does not
 * exist yet (or is not pinned to a revision and content hash) are returned as blockers: this never
 * creates a profile. Options: `mealId` (default derived from the owner and title), `title`, and
 * `nestedMeals` (saved records that nested lines pin through `useSavedMealForLine`).
 */
export async function buildMealSnapshot(workspace, { mealId = null, title = null, nestedMeals = [] } = {}) {
    const fail = (error, extra = {}) => ({ ok: false, error, writes: false, modelCalls: 0, ...extra });
    if (!workspace?.ownerUid) return fail('owner_required');
    if (!workspace.draft) return fail('import_required');
    if (!workspace.resolution || !workspace.calculation) return fail('calculate_required');
    if (!workspace.review) return fail('review_required');
    const draft = workspace.draft;
    const meal = draft.import.meal || {};
    const name = String(title ?? meal.title ?? 'Meal');
    const id = mealId ?? await mealIdFor(workspace.ownerUid, name);
    if (!MEAL_ID.test(id)) return fail('invalid_meal_id');
    const lines = workspace.resolution.lines;
    const counted = new Set(countedLines(lines).map(line => line.lineId));
    const items = new Map(workspace.resolution.items.map(item => [item.lineId, item]));
    const blockers = [];
    const nested = [];
    const records = [];
    for (const line of lines) {
        const item = items.get(line.lineId);
        const isCounted = counted.has(line.lineId);
        const raw = refFor(item);
        let profile = null;
        if (item?.source === 'meal') {
            const mealRef = parseMealRef(item.mealRef);
            const source = mealRef && nestedMeals.find(record => record?.mealId === mealRef.mealId && record.contentHash === mealRef.contentHash && record.version === mealRef.version);
            if (!mealRef) blockers.push({ lineId: line.lineId, name: line.name, reason: 'unpinned_meal' });
            else if (!source) blockers.push({ lineId: line.lineId, name: line.name, reason: 'nested_meal_unavailable' });
            else { profile = { kind: 'meal', mealRef }; nested.push(source); }
        } else if (raw) {
            const ref = parseIngredientRef(raw);
            if (!ref) { if (isCounted) blockers.push({ lineId: line.lineId, name: line.name, reason: blockerReason(item) }); }
            else if (item.baseRevision && (item.baseRevision.contentHash !== ref.contentHash || !await verifyRevisionHash(item.baseRevision))) blockers.push({ lineId: line.lineId, name: line.name, reason: 'revision_mismatch' });
            else profile = { kind: 'ingredient', ref };
        } else if (isCounted) blockers.push({ lineId: line.lineId, name: line.name, reason: blockerReason(item) });
        const stored = draft.import.ingredients.some(row => row.lineId === line.lineId) ? effectiveLine(draft, line.lineId) : null;
        records.push({
            lineId: line.lineId,
            name: String(line.name ?? ''),
            order: line.order ?? null,
            kind: line.kind ?? null,
            parentLineId: line.parentLineId ?? null,
            counted: isCounted,
            profile,
            quantity: {
                g: Number.isFinite(line.grams) ? line.grams : null,
                unit: 'g',
                basis: item?.estimate ? 'estimated' : (line.quantityBasis ?? null),
                gMin: line.gMin ?? null,
                gMax: line.gMax ?? null,
                original: plain(stored?.quantity ?? null),
            },
            preparation: {
                yieldRetention: line.yieldRetention ?? null,
                waterDeltaG: Number.isFinite(line.waterDeltaG) ? line.waterDeltaG : null,
                mealWater: line.mealWater === true,
                fatAbsorbedG: line.fatAbsorbedG ?? null,
                fatDiscardedG: line.fatDiscardedG ?? null,
                fatAbsorbedExternal: line.fatAbsorbedExternal ?? null,
            },
            fiber: { category: line.fiberCategory ?? null, components: plain(line.fiberComponents ?? null) },
            nutrients: plain(item?.nutrients || {}),
            resolution: {
                kind: item?.kind ?? null,
                source: item?.source ?? null,
                estimate: item?.estimate === true,
                officialAttempts: plain(item?.officialAttempts || []),
                researchEvidence: plain(item?.researchEvidence || []),
            },
            origin: plain(workspace.origins?.find(row => row.lineId === line.lineId) || null),
        });
    }
    if (blockers.length) return fail('unpinned_lines', { blockers });
    const closure = new Set();
    for (const record of nested) {
        closure.add(record.mealId);
        for (const nestedId of record.graph?.nestedMealIds || []) closure.add(nestedId);
    }
    if (closure.has(id)) return fail('nested_cycle', { mealId: id });
    const fit = workspace.fit ? plain(workspace.fit) : null;
    const content = {
        kind: MEAL_RECORD_KIND,
        schemaVersion: MEAL_SCHEMA_VERSION,
        snapshotVersion: MEAL_SNAPSHOT_VERSION,
        ownerUid: workspace.ownerUid,
        mealId: id,
        title: name,
        meal: { kind: meal.kind ?? null, servings: meal.servings?.count ?? workspace.resolution.servings ?? null, yield: plain(meal.yield ?? null) },
        lines: records,
        graph: { nestedMealIds: [...closure].sort() },
        // Known facts are what the user or label stated; `calculated` is what this site computed.
        knownFacts: plain(draft.import.knownFacts || []),
        calculated: plain(workspace.calculation),
        review: { comparisons: plain(workspace.review.comparisons || []), uncertainties: plain(workspace.review.uncertainties || []) },
        assumptions: {
            constraints: plain(draft.import.constraints || []),
            declaredCookedG: Number.isFinite(meal.yield?.cookedTotal?.g) ? meal.yield.cookedTotal.g : null,
            declaredRawG: Number.isFinite(meal.yield?.rawTotal?.g) ? meal.yield.rawTotal.g : null,
            mealWater: lines.some(line => line.mealWater === true),
            totalGrams: workspace.resolution.totalGrams ?? null,
            incomplete: workspace.resolution.incomplete === true,
            research: records.flatMap(line => line.resolution.researchEvidence.flatMap(entry => (entry.assumptions || []).map(text => ({ lineId: line.lineId, requestId: entry.requestId, text })))),
        },
        fit,
        provenance: { source: plain(draft.source ?? null), origins: plain(workspace.origins || []), importSchemaVersion: draft.import.schemaVersion ?? null },
        versions: {
            snapshot: MEAL_SNAPSHOT_VERSION,
            calculation: workspace.calculation.calculationVersion ?? CALCULATION_VERSION,
            fit: fit?.fitVersion ?? FIT_VERSION,
            fiberWeight: FIBER_WEIGHT_VERSION,
            adjustedCarb: ADJUSTED_CARB_VERSION,
            fodmapEquivalent: FODMAP_EQUIVALENT_VERSION,
        },
    };
    // The frozen totals must be what the frozen inputs give; a workspace edited after review is refused.
    if (canonicalJson(recalculateMealRecord(content).calculation) !== canonicalJson(content.calculated)) return fail('calculation_stale');
    const record = await stamp(content);
    const errors = await verifyMealRecord(record);
    if (errors.length) return fail('invalid_record', { errors });
    return { ok: true, record, writes: false, modelCalls: 0 };
}

/** Every reason a record cannot be trusted. Empty means valid and hash-verified. */
export async function verifyMealRecord(record) {
    const errors = [];
    if (!record || typeof record !== 'object') return ['record required'];
    if (record.kind !== MEAL_RECORD_KIND) errors.push('kind');
    if (Number.isSafeInteger(record.schemaVersion) && record.schemaVersion > MEAL_SCHEMA_VERSION) return ['newer_schema'];
    if (record.schemaVersion !== MEAL_SCHEMA_VERSION) errors.push('schemaVersion');
    if (!MEAL_ID.test(record.mealId)) errors.push('mealId');
    if (typeof record.ownerUid !== 'string' || !record.ownerUid) errors.push('ownerUid');
    if (!Array.isArray(record.lines) || !record.lines.length) return [...errors, 'lines'];
    const nestedIds = new Set(record.graph?.nestedMealIds || []);
    for (const line of record.lines) {
        if (!line?.counted) continue;
        if (line.profile?.kind === 'ingredient' && parseIngredientRef(line.profile.ref)) continue;
        if (line.profile?.kind === 'meal' && parseMealRef(line.profile.mealRef)) {
            if (line.profile.mealRef.mealId === record.mealId) errors.push('cycle');
            else if (!nestedIds.has(line.profile.mealRef.mealId)) errors.push('graph:' + line.lineId);
            continue;
        }
        errors.push('unpinned:' + line.lineId);
    }
    if (nestedIds.has(record.mealId)) errors.push('cycle');
    if (errors.length) return errors;
    let content;
    try {
        content = mealContent(record);
        if (record.contentHash !== await contentHashOf(content)) errors.push('hash');
        else if (record.idempotencyKey !== await sha256Hex(record.ownerUid + '|' + record.mealId + '|' + record.contentHash)) errors.push('idempotencyKey');
    } catch { return ['hash']; }
    if (!errors.length && canonicalJson(recalculateMealRecord(record).calculation) !== canonicalJson(record.calculated)) errors.push('calculation');
    return errors;
}

/** JSON export of one saved or unsaved record. */
export function exportMealRecord(record) {
    return JSON.stringify({ kind: MEAL_EXPORT_KIND, schemaVersion: 1, record }, null, 2);
}

/** Parse an export and verify its hash. A tampered or newer record is refused. Nothing is written. */
export async function importMealRecord(json) {
    let body;
    try { body = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return { ok: false, error: 'invalid_json', writes: false }; }
    if (!body || body.kind !== MEAL_EXPORT_KIND || body.schemaVersion !== 1 || !body.record) return { ok: false, error: 'invalid_export', writes: false };
    const errors = await verifyMealRecord(body.record);
    if (errors.includes('newer_schema')) return { ok: false, error: 'newer_schema', writes: false };
    if (errors.length) return { ok: false, error: errors.includes('hash') ? 'hash_mismatch' : 'invalid_record', errors, writes: false };
    return { ok: true, record: body.record, writes: false };
}

/**
 * Saved meal versions that reference one profile revision (or any revision of a variant when `ref` has no
 * revision). This is the data for #69's affected-meals view; it reads only the records it is given.
 */
export function referencesForIngredient(records = [], ref = {}) {
    const out = [];
    for (const record of records) {
        const lines = (record?.lines || []).filter(line => {
            const pinned = line.profile?.kind === 'ingredient' ? line.profile.ref : null;
            if (!pinned || pinned.variantId !== ref.variantId) return false;
            if (ref.namespace && pinned.namespace !== ref.namespace) return false;
            if (ref.revision != null && pinned.revision !== ref.revision) return false;
            return !ref.contentHash || pinned.contentHash === ref.contentHash;
        });
        if (!lines.length) continue;
        out.push({
            mealId: record.mealId, version: record.version ?? null, versionId: record.versionId ?? null, contentHash: record.contentHash, title: record.title,
            lines: lines.map(line => ({ lineId: line.lineId, grams: line.quantity.g, revision: line.profile.ref.revision })),
        });
    }
    return out.sort((a, b) => a.mealId.localeCompare(b.mealId) || (a.version ?? 0) - (b.version ?? 0));
}

function observationsFromRevision(revision) {
    const nutrients = {};
    for (const key of PROFILE_FIELDS) {
        const value = revision?.nutrients?.[key];
        const status = revision?.nutrientMeta?.quality?.[key]?.status;
        if (value == null && !status) continue;
        nutrients[key] = { value: value ?? null, status: status || (value == null ? 'unknown' : 'measured') };
    }
    return nutrients;
}

/**
 * Explicit rebuild against newer profile revisions: `revisions` maps lineId to `{ ref, revision }`.
 * Returns a new unsaved record (new hash); the input record and any diary entry made from it are untouched.
 */
export async function rebuildMealRecord(record, { revisions = {} } = {}) {
    if ((await verifyMealRecord(record)).length) return { ok: false, error: 'invalid_record', modelCalls: 0 };
    const lines = [];
    for (const line of record.lines) {
        const next = revisions[line.lineId];
        if (!next) { lines.push(structuredClone(line)); continue; }
        const ref = parseIngredientRef(next.ref);
        if (!ref || line.profile?.kind !== 'ingredient' || ref.variantId !== line.profile.ref.variantId || next.revision?.contentHash !== ref.contentHash || !await verifyRevisionHash(next.revision))
            return { ok: false, error: 'invalid_revision', lineId: line.lineId, modelCalls: 0 };
        lines.push({ ...structuredClone(line), profile: { kind: 'ingredient', ref }, nutrients: plain({ ...line.nutrients, ...observationsFromRevision(next.revision) }), resolution: { ...structuredClone(line.resolution), source: 'library' } });
    }
    const content = { ...structuredClone(mealContent(record)), lines };
    content.calculated = recalculateMealRecord(content).calculation;
    // The earlier fact comparisons describe the old totals; the rebuilt record must be reviewed again.
    content.review = { comparisons: [], uncertainties: [], needsReview: true };
    content.rebuiltFrom = { mealId: record.mealId, version: record.version ?? null, contentHash: record.contentHash };
    const rebuilt = await stamp(content);
    return { ok: true, record: rebuilt, modelCalls: 0, writes: false };
}
