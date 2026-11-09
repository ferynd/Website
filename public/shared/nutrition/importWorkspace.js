import { IMPORT_WORKSPACE_ENABLED, INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from './capabilities.js';
import {
    applyLineCorrection, confirmMatch, copyAssistantInstructions, effectiveLine, fitTargets, fromLegacyPaste, fromSavedMeal, fromSavedRecipe,
    importIngredientList, reconcileImport, renderIngredientPaste,
} from './import/index.js';
import { validateResearchResponse } from './research/researchPacket.js';
import {
    buildResolution, cancelResolution, chooseExisting, lookupOfficial, manualEntry, recalculateResolution, researchPacket, reviewResolution, saveIncomplete,
} from './resolution.js';
import { PROFILE_FIELDS } from './research/profileFields.js';
import { fitQuantities } from './fit.js';

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
const REJECTED = new Set(['photo', 'barcode', 'ocr', 'image']);

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

function resolutionLines(draft) {
    return draft.import.ingredients.map(stored => {
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
            order: line.order,
            fiberCategory: line.fiberCategory,
            fiberComponents: line.fiberComponents,
        };
    });
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

/** Records an official attempt. This module does not contact a food database. */
export function lookupWorkspace(workspace, lineIds, attempt = {}) {
    if (!workspace?.resolution) return fail(workspace, 'match_required');
    let resolution = workspace.resolution;
    for (const lineId of lineIds) {
        const next = lookupOfficial(resolution, lineId, { outcome: 'not_found', adapter: 'curated', reason: 'live official sources are not enabled', ...attempt });
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
        const nutrients = { ...item.nutrients };
        for (const [key, nutrient] of Object.entries(result.nutrients || {}))
            nutrients[key] = { value: nutrient.value, status: nutrient.status };
        item.nutrients = nutrients;
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
            order: line.order,
            fiberCategory: line.fiberCategory,
            fiberComponents: line.fiberComponents,
        };
    });
    const meal = workspace.draft.import.meal || {};
    const constraints = [...(workspace.draft.import.constraints || [])];
    const weightTarget = meal.servingWeight?.g ?? meal.yield?.rawTotal?.g;
    if (Number.isFinite(weightTarget) && weightTarget > 0) {
        const ids = lines.filter(line => !line.parentLineId).map(line => line.lineId);
        constraints.push({ type: 'sum', lineIds: ids, gMin: weightTarget, gMax: weightTarget });
    }
    const raw = meal.yield?.rawTotal?.g;
    const cooked = meal.yield?.cookedTotal?.g;
    if (Number.isFinite(raw) && raw > 0 && Number.isFinite(cooked) && cooked > 0 && cooked <= raw) {
        for (const line of lines)
            if (line.yieldRetention == null) line.yieldRetention = cooked / raw;
    }
    const fit = fitQuantities({ lines, constraints, facts, servings: meal.servings?.count ?? meal.servings ?? null });
    let resolution = workspace.resolution;
    let calculation = workspace.calculation;
    if (fit.ran && resolution) {
        const fitted = new Map(fit.quantities.map(item => [item.lineId, item.grams]));
        resolution = { ...resolution, lines: resolution.lines.map(line => {
            const grams = fitted.get(line.lineId);
            return Number.isFinite(grams) ? { ...line, grams } : line;
        }), modelCalls: 0 };
        calculation = recalculateResolution(resolution).calculation;
    }
    return done(workspace, { stage: 'review', fit: { ...fit, facts: facts.length }, resolution, calculation });
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
    const exportCopy = rendered.ok ? { format: 'paste', text: rendered.text } : { format: 'json', text: JSON.stringify(list, null, 2) };
    if (!caps.save) {
        return done(workspace, { stage: 'save', exportCopy, committed: false, save: { available: false, reason: 'export only until ingredient and nutrient writes are approved' } });
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
        resolution,
        preserved: pending.map(job => ({ jobId: job.jobId, state: job.state })),
        stage: workspace.stage,
    });
}
