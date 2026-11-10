import { IMPORT_WORKSPACE_ENABLED, INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from './capabilities.js';
import {
    applyLineCorrection, confirmMatch, copyAssistantInstructions, effectiveLine, fitTargets, fromLegacyPaste, fromSavedMeal, fromSavedRecipe,
    importIngredientList, publicIngredientList, reconcileImport, renderIngredientPaste,
} from './import/index.js';
import { validateResearchResponse } from './research/researchPacket.js';
import {
    buildResolution, cancelResolution, chooseExisting, cookedTotal, LIVE_SOURCES_DISABLED, lookupOfficial, manualEntry, recalculateResolution, researchPacket, reviewResolution, saveIncomplete,
} from './resolution.js';
import { PROFILE_FIELDS } from './research/profileFields.js';
import { fitQuantities } from './fit.js';
import { countedLines, nutrientBasis } from './calculate.js';

/** Save stays off until both Part B write flags are on. This module does not flip them. */
export function workspaceCapabilities() {
    return Object.freeze({
        workspace: IMPORT_WORKSPACE_ENABLED,
        photo: false,
        barcode: false,
        ocr: false,
        fit: true,
        libraryDeepLink: false,
        directAi: false,
        save: INGREDIENT_STORE_WRITES_ENABLED && NUTRIENT_V2_WRITES_ENABLED,
        exportCopy: true,
    });
}

export const WORKSPACE_STAGES = Object.freeze(['import', 'match', 'resolve', 'calculate', 'fit', 'review', 'save']);
/** Shown after a failed or abandoned import. Import actions never write foods or diary entries. */
export const WORKSPACE_UNCHANGED_NOTICE = 'Your existing foods and diary were not changed.';
/** The export-only save result. Saving never logs the meal; diary add stays a separate explicit action. */
export const WORKSPACE_SAVE_REASON = 'Export only until ingredient and nutrient writes are approved. This meal was not logged to the diary.';
const REJECTED = new Set(['photo', 'barcode', 'ocr', 'image']);
const COOKED_TOLERANCE_G = 0.05;

function blank(ownerUid) {
    return {
        schemaVersion: 1,
        ownerUid,
        stage: 'import',
        draft: null,
        match: null,
        resolution: null,
        calculation: null,
        review: null,
        fit: null,
        origins: [],
        packet: null,
        exportCopy: null,
        cancelled: false,
        committed: false,
        preserved: [],
        modelCalls: 0,
        capabilities: workspaceCapabilities(),
    };
}

function done(workspace, patch) {
    return { ok: true, workspace: { ...workspace, ...patch, modelCalls: 0, capabilities: workspaceCapabilities(), committed: patch.committed ?? false } };
}

function fail(workspace, error, extra = {}) {
    return { ok: false, error, workspace, ...extra };
}

export function createWorkspace(ownerUid) {
    if (typeof ownerUid !== 'string' || !ownerUid.trim()) return { ok: false, error: 'owner_required' };
    return { ok: true, workspace: blank(ownerUid.trim()) };
}

function asJson(input) {
    if (typeof input !== 'string') return { ok: true, value: input };
    try { return { ok: true, value: JSON.parse(input) }; }
    catch { return { ok: false }; }
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

function exportList(workspace) {
    const fitted = new Map((workspace.fit?.quantities || []).filter(item => Number.isFinite(item.grams)).map(item => [item.lineId, item.grams]));
    const source = workspace.draft.import;
    return {
        ...source,
        ingredients: source.ingredients.map(stored => {
            const line = effectiveLine(workspace.draft, stored.lineId);
            const grams = fitted.get(line.lineId);
            if (!Number.isFinite(grams)) return line;
            return { ...line, quantity: { ...line.quantity, g: grams } };
        }),
    };
}

function originFor(kind) {
    if (kind === 'legacy_paste') return 'user';
    if (kind === 'saved_meal' || kind === 'saved_recipe' || kind === 'recipe_standardizer') return 'deterministic';
    return 'assistant';
}

function declaredCooked(meal) {
    const cooked = meal?.yield?.cookedTotal?.g;
    return Number.isFinite(cooked) && cooked >= 0 ? cooked : null;
}

/** A line's own water or a water-gain retention wins over the meal cooked total. */
function ownsWater(line) {
    return Number.isFinite(line.waterDeltaG) || (Number.isFinite(line.yieldRetention) && line.yieldRetention > 1);
}

/** Pre-water mass of a counted line that can take a share of the meal-water residual, or 0. */
function absorbingMass(line) {
    if (!Number.isFinite(line.grams) || line.grams < 0 || ownsWater(line)) return 0;
    return nutrientBasis({ ...line, waterDeltaG: 0 })?.cookedG ?? 0;
}

/** True when some counted line takes meal water, so the meal cooked total holds as the line grams change. */
function mealWaterAbsorbed(lines) {
    return countedLines(lines).some(line => absorbingMass(line) > 0);
}

/**
 * Meal cooked total -> per-line water. Water is the residual after each line's one fat adjustment:
 * fixed lines keep their own cooked mass, and the rest is spread over the other counted lines in
 * proportion to their post-fat mass, never below zero. Water derived here is marked mealWater and is
 * re-derived on every call, so fitted grams never keep a stale share.
 */
function withMealWater(input, meal) {
    const lines = input.map(line => {
        if (!line.mealWater) return line;
        const { mealWater, waterDeltaG, ...rest } = line;
        return rest;
    });
    const cooked = declaredCooked(meal);
    if (cooked == null) return lines;
    const counted = countedLines(lines).filter(line => Number.isFinite(line.grams) && line.grams >= 0);
    const fixedMass = counted.filter(ownsWater).reduce((sum, line) => sum + (nutrientBasis(line)?.cookedG ?? 0), 0);
    const pre = new Map();
    for (const line of counted) {
        const mass = absorbingMass(line);
        if (mass > 0) pre.set(line, mass);
    }
    const preMass = [...pre.values()].reduce((sum, mass) => sum + mass, 0);
    if (!pre.size || preMass <= 0) return lines;
    const gap = cooked - fixedMass - preMass;
    return lines.map(line => {
        const mass = pre.get(line);
        if (mass == null) return line;
        return { ...line, waterDeltaG: Math.max(-mass, gap * (mass / preMass)), mealWater: true };
    });
}

function resolutionLines(draft) {
    return withMealWater(draft.import.ingredients.map(stored => {
        const line = effectiveLine(draft, stored.lineId);
        return {
            lineId: line.lineId,
            name: line.name,
            grams: line.quantity?.g,
            quantityBasis: line.quantity?.basis,
            gMin: line.quantity?.gMin ?? null,
            gMax: line.quantity?.gMax ?? null,
            variant: line.variant || {},
            kind: line.kind,
            parentLineId: line.parentLineId,
            yieldRetention: line.yieldRetention,
            waterDeltaG: line.waterDeltaG,
            fatAbsorbedG: line.fatAbsorbedG,
            fatDiscardedG: line.fatDiscardedG,
            fatAbsorbedExternal: line.fatAbsorbedExternal,
            order: line.order,
            fiberCategory: line.fiberCategory,
            fiberComponents: line.fiberComponents,
        };
    }), draft.import.meal);
}

/** One entry. Photo, barcode, and OCR inputs are refused. */
export function importWorkspaceInput(workspace, input, { kind = 'ingredient_list' } = {}) {
    if (!workspace?.ownerUid) return fail(workspace, 'owner_required');
    if (REJECTED.has(kind)) return fail(workspace, 'unsupported_input');
    let result;
    if (kind === 'legacy_paste') result = fromLegacyPaste(typeof input === 'string' ? input : '');
    else if (kind === 'saved_meal' || kind === 'saved_recipe' || kind === 'recipe') {
        const body = asJson(input);
        if (!body.ok) return fail(workspace, 'invalid_import', { errors: [{ path: '$', message: 'expected JSON' }] });
        result = kind === 'saved_meal' ? fromSavedMeal(body.value) : fromSavedRecipe(body.value);
    }
    else if (kind === 'ingredient_list' || kind === 'paste') result = importIngredientList(input);
    else return fail(workspace, 'unsupported_input');
    if (!result?.ok) return fail(workspace, 'invalid_import', { errors: result?.errors || [] });
    const sourceKind = result.draft.source?.kind || kind;
    const origins = result.draft.import.ingredients.map(line => ({ lineId: line.lineId, origin: originFor(sourceKind), sourceKind }));
    return done(workspace, {
        stage: 'match', draft: result.draft, origins, match: null, resolution: null, calculation: null, review: null, fit: null, packet: null, exportCopy: null, cancelled: false, preserved: [],
    });
}

export function correctWorkspaceLine(workspace, lineId, patch) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const next = applyLineCorrection(workspace.draft, lineId, patch);
    if (!next.ok) return fail(workspace, 'invalid_correction', { errors: next.errors });
    const resolution = workspace.resolution ? { ...workspace.resolution, lines: resolutionLines(next.draft), modelCalls: 0 } : null;
    return done(workspace, { draft: next.draft, resolution, calculation: null, review: null });
}

async function resolutionFromMatch(workspace, match, ports = {}) {
    const nutrientsByLine = { ...(ports.nutrientsByLine || {}) };
    const revisionsByLine = { ...(ports.revisionsByLine || {}) };
    if (ports.loadRevision) {
        for (const line of match.lines) {
            if ((line.outcome !== 'exact' && line.outcome !== 'confirmed_by_user') || !line.ref) continue;
            try {
                const loaded = await ports.loadRevision(line.ref);
                if (!loaded?.revision) continue;
                revisionsByLine[line.lineId] = loaded.revision;
                nutrientsByLine[line.lineId] = { ...observationsFromRevision(loaded.revision), ...(nutrientsByLine[line.lineId] || {}) };
            } catch { /* A failed profile read leaves the line unresolved. */ }
        }
    }
    return buildResolution({
        lines: resolutionLines(workspace.draft),
        matches: match.lines.map(line => ({ lineId: line.lineId, outcome: line.outcome === 'exact' || line.outcome === 'confirmed_by_user' ? 'exact' : line.outcome === 'missing' ? 'missing' : line.outcome, ref: line.ref || null })),
        nutrientsByLine,
        revisionsByLine,
        servings: workspace.draft.import.meal?.servings?.count ?? null,
        totalGrams: declaredCooked(workspace.draft.import.meal),
    });
}

/** Match through #61. Does not research or write. */
export async function matchWorkspace(workspace, ports = {}) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const safeSearch = search => async name => {
        try { return await search(name); }
        catch { return { items: [] }; }
    };
    const match = await reconcileImport(workspace.draft, {
        ...ports,
        ...(ports.privateSearch ? { privateSearch: safeSearch(ports.privateSearch) } : {}),
        ...(ports.curatedSearch ? { curatedSearch: safeSearch(ports.curatedSearch) } : {}),
    });
    return done(workspace, { stage: 'resolve', match, resolution: await resolutionFromMatch(workspace, match, ports) });
}

/** Confirm one candidate. A form conflict still requires acknowledgeConflict. */
export async function confirmWorkspace(workspace, lineId, variantId, ports = {}, options = {}) {
    if (!workspace?.match) return fail(workspace, 'match_required');
    const confirmed = confirmMatch(workspace.match, lineId, variantId, options);
    if (!confirmed.ok) return fail(workspace, confirmed.reason);
    const match = confirmed.result;
    return done(workspace, { stage: 'resolve', match, resolution: await resolutionFromMatch(workspace, match, ports) });
}

function withResolution(workspace, result) {
    if (!result?.ok) return fail(workspace, result?.error || 'resolve_failed');
    return done(workspace, { stage: 'resolve', resolution: result.state });
}

export function chooseWorkspace(workspace, lineId, choice) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    return withResolution(workspace, chooseExisting(workspace.resolution, lineId, choice));
}

/**
 * Visits the official-lookup step. This module does not contact a food database (live sources are
 * #62 Part B), so every attempt it records is `not_performed` with no adapter or release. The third
 * parameter is kept for call compatibility and ignored: a caller cannot make the workspace claim
 * `not_found` or `resolved` for a lookup that never ran.
 */
export function lookupWorkspace(workspace, lineIds, _attempt = {}) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    let resolution = workspace.resolution;
    for (const lineId of lineIds) {
        const next = lookupOfficial(resolution, lineId, { outcome: 'not_performed', reason: LIVE_SOURCES_DISABLED });
        if (!next.ok) return fail(workspace, next.error);
        resolution = next.state;
    }
    return done(workspace, { stage: 'resolve', resolution });
}

export function packetCopy(packet) {
    if (!packet) return '';
    if (packet.copyText) return packet.copyText;
    const texts = packet.copyTexts || [];
    return texts.map((text, index) => `Packet ${index + 1} of ${texts.length}\n\n${text}`).join('\n\n');
}

/** Validate a pasted #62 response and keep its nutrients on the matching lines. Does not write a profile. */
export async function applyResearchResponse(workspace, input) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    const body = asJson(input);
    if (!body.ok || !body.value || typeof body.value !== 'object') return fail(workspace, 'invalid_response', { errors: [{ path: '$', message: 'expected JSON' }] });
    const response = body.value;
    const request = (workspace.resolution.pendingRequests || []).find(item => item.requestId === response.requestId);
    if (!request) return fail(workspace, 'unknown_request');
    const jobs = (workspace.resolution.pendingJobs || []).filter(job => job.pendingRequest?.requestId === request.requestId);
    let validated;
    try { validated = await validateResearchResponse(response, { request, jobs }); }
    catch (error) { return fail(workspace, 'invalid_response', { errors: [{ path: '$', message: error.message }] }); }
    const items = workspace.resolution.items.map(item => ({ ...item }));
    for (const result of validated.results) {
        const lineId = jobs.find(job => job.jobId === result.targetId)?.target?.lineId;
        const item = items.find(row => row.lineId === lineId);
        if (!item) continue;
        // Keep the whole validated field (unit, qualifier, uncertainty, range, confidence, derivation,
        // comparator, sourceIds) and tag it with the request whose evidence record holds its sources.
        // Calculation reads only value and status, so the extra fields are inert. Fields the response
        // does not supply keep their earlier values.
        const nutrients = { ...item.nutrients };
        for (const [key, nutrient] of Object.entries(result.nutrients || {}))
            nutrients[key] = { ...structuredClone(nutrient), requestId: request.requestId };
        item.nutrients = nutrients;
        // One evidence record per request: result-level sources (with version, publishedAt, and
        // accessedAt), explicit unknowns, and assumptions. Re-applying a request replaces its record.
        const evidence = {
            requestId: request.requestId,
            targetId: result.targetId,
            verification: 'unverified',
            sources: structuredClone(result.sources || []),
            unresolved: structuredClone(result.unresolved || []),
            assumptions: structuredClone(result.assumptions || []),
        };
        item.researchEvidence = [...(item.researchEvidence || []).filter(entry => entry.requestId !== request.requestId), evidence];
        item.source = 'packet';
    }
    return done(workspace, { resolution: { ...workspace.resolution, items, modelCalls: 0 } });
}

export async function packetWorkspace(workspace, lineIds, options) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    const result = await researchPacket(workspace.resolution, lineIds, options);
    if (!result.ok) return fail(workspace, result.error);
    return done(workspace, { stage: 'resolve', resolution: result.state, packet: { copyText: result.copyText, copyTexts: result.copyTexts, modelCalls: 0 } });
}

export function manualWorkspace(workspace, lineId, nutrients) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    return withResolution(workspace, manualEntry(workspace.resolution, lineId, nutrients));
}

export function incompleteWorkspace(workspace) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    return done(workspace, { resolution: saveIncomplete(workspace.resolution), stage: 'calculate' });
}

export function calculateWorkspace(workspace) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    const result = recalculateResolution(workspace.resolution);
    return done(workspace, { stage: 'fit', calculation: result.calculation, resolution: workspace.resolution });
}

/** Fit estimated grams when eligible facts exist, then recalculate. Profiles and facts are not rewritten. */
export function fitWorkspace(workspace) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const facts = fitTargets(workspace.draft.import);
    // Fit lines carry only their own water. A declared cooked total is passed to the fit as a fixed
    // mass only when some counted line absorbs the meal-water residual; when every counted line sets its
    // own water, those values win over the meal total, so the fit uses the moving line-derived mass.
    // Meal water is re-derived from the fitted grams below.
    const lines = workspace.draft.import.ingredients.map(stored => {
        const line = effectiveLine(workspace.draft, stored.lineId);
        const item = workspace.resolution?.items?.find(row => row.lineId === line.lineId);
        return {
            lineId: line.lineId,
            grams: Number.isFinite(line.quantity?.g) ? line.quantity.g : null,
            gMin: line.quantity?.gMin,
            gMax: line.quantity?.gMax,
            basis: line.quantity?.basis,
            nutrients: item?.nutrients || {},
            parentLineId: line.parentLineId,
            yieldRetention: line.yieldRetention,
            waterDeltaG: line.waterDeltaG,
            fatAbsorbedG: line.fatAbsorbedG,
            fatDiscardedG: line.fatDiscardedG,
            fatAbsorbedExternal: line.fatAbsorbedExternal,
            order: line.order,
            fiberCategory: line.fiberCategory,
            fiberComponents: line.fiberComponents,
        };
    });
    const meal = workspace.draft.import.meal || {};
    const constraints = [...(workspace.draft.import.constraints || [])];
    const rawTarget = meal.yield?.rawTotal?.g;
    if (Number.isFinite(rawTarget) && rawTarget > 0) {
        // The same counted lines calculateMeal sums: children, never their compound parent.
        const ids = countedLines(lines).filter(line => Number.isFinite(line.grams)).map(line => line.lineId);
        if (ids.length) constraints.push({ type: 'sum', lineIds: ids, gMin: rawTarget, gMax: rawTarget });
    }
    const cooked = declaredCooked(meal);
    const fixedCooked = cooked != null && mealWaterAbsorbed(lines) ? cooked : null;
    const fit = fitQuantities({ lines, constraints, facts, servings: meal.servings?.count ?? meal.servings ?? null, cookedTotal: fixedCooked });
    let resolution = workspace.resolution;
    let calculation = workspace.calculation;
    let result = fit;
    if (fit.ran && resolution) {
        const fitted = new Map(fit.quantities.map(item => [item.lineId, item.grams]));
        const nextLines = withMealWater(resolution.lines.map(line => {
            const grams = fitted.get(line.lineId);
            return Number.isFinite(grams) ? { ...line, grams } : line;
        }), meal);
        resolution = { ...resolution, lines: nextLines, totalGrams: cooked ?? cookedTotal(nextLines), modelCalls: 0 };
        calculation = recalculateResolution(resolution).calculation;
        // Meal water never takes a line below 0 g, so a fixed cooked total can still be out of reach.
        const cookedG = calculation?.mass?.cookedG;
        if (fixedCooked != null && Number.isFinite(cookedG) && Math.abs(cookedG - fixedCooked) > COOKED_TOLERANCE_G) {
            result = {
                ...fit,
                flags: { ...fit.flags, infeasible: true, unique: false },
                violations: [...(fit.violations || []), { type: 'cooked_total', expectedG: fixedCooked, cookedG }],
            };
        }
    }
    return done(workspace, { stage: 'review', fit: { ...result, facts: facts.length }, resolution, calculation });
}

export function reviewWorkspace(workspace) {
    if (!workspace?.resolution || !workspace?.calculation) return fail(workspace, 'calculate_required');
    const review = reviewResolution(workspace.resolution, workspace.calculation, workspace.draft?.import?.knownFacts || []);
    const rows = review.rows.map(row => ({ ...row, origin: workspace.origins.find(item => item.lineId === row.lineId)?.origin || 'deterministic' }));
    return done(workspace, { stage: 'save', review: { ...review, rows } });
}

export function instructionsWorkspace() {
    const copy = copyAssistantInstructions();
    return { ...copy, modelCalls: 0 };
}

/** Export or copy only. Never commits a meal or diary entry while writes are off. */
export function saveWorkspace(workspace) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const caps = workspaceCapabilities();
    const list = exportList(workspace);
    const rendered = renderIngredientPaste(list);
    const exportCopy = rendered.ok ? { format: 'paste', text: rendered.text } : { format: 'json', text: JSON.stringify(publicIngredientList(list), null, 2) };
    if (!caps.save) {
        return done(workspace, { stage: 'save', exportCopy, committed: false, save: { available: false, logged: false, reason: WORKSPACE_SAVE_REASON } });
    }
    return fail(workspace, 'save_not_enabled', { exportCopy });
}

export function cancelWorkspace(workspace) {
    if (!workspace) return fail(workspace, 'owner_required');
    const pending = workspace.resolution?.pendingJobs || [];
    const resolution = workspace.resolution ? cancelResolution(workspace.resolution) : null;
    return done(workspace, {
        cancelled: true,
        committed: false,
        notice: WORKSPACE_UNCHANGED_NOTICE,
        resolution,
        preserved: pending.map(job => ({ jobId: job.jobId, state: job.state })),
        stage: workspace.stage,
    });
}
