import { INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from './capabilities.js';
import {
    applyLineCorrection, copyAssistantInstructions, effectiveLine, fitTargets, fromLegacyPaste, fromSavedMeal, fromSavedRecipe,
    importIngredientList, reconcileImport, renderIngredientPaste,
} from './import/index.js';
import {
    buildResolution, cancelResolution, chooseExisting, lookupOfficial, manualEntry, recalculateResolution, researchPacket, reviewResolution, saveIncomplete,
} from './resolution.js';

/** Save stays off until both Part B write flags are on. This module does not flip them. */
export function workspaceCapabilities() {
    return Object.freeze({
        workspace: true,
        photo: false,
        barcode: false,
        ocr: false,
        fit: false,
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
        };
    });
}

/** One entry. Photo, barcode, and OCR inputs are refused. */
export function importWorkspaceInput(workspace, input, { kind = 'ingredient_list' } = {}) {
    if (!workspace?.ownerUid) return fail(workspace, 'owner_required');
    if (REJECTED.has(kind)) return fail(workspace, 'unsupported_input');
    let result;
    if (kind === 'legacy_paste') result = fromLegacyPaste(typeof input === 'string' ? input : '');
    else if (kind === 'saved_meal') result = fromSavedMeal(input);
    else if (kind === 'saved_recipe' || kind === 'recipe') result = fromSavedRecipe(input);
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

/** Match through #61. Does not research or write. */
export async function matchWorkspace(workspace, ports = {}) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const match = await reconcileImport(workspace.draft, ports);
    const resolution = buildResolution({
        lines: resolutionLines(workspace.draft),
        matches: match.lines.map(line => ({ lineId: line.lineId, outcome: line.outcome === 'exact' ? 'exact' : line.outcome === 'missing' ? 'missing' : line.outcome, ref: line.ref || null })),
        nutrientsByLine: ports.nutrientsByLine || {},
        revisionsByLine: ports.revisionsByLine || {},
        servings: workspace.draft.import.meal?.servings?.count ?? null,
    });
    return done(workspace, { stage: 'resolve', match, resolution });
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

/** #65 is off. Eligible facts are reported and not solved. */
export function fitWorkspace(workspace) {
    if (!workspace?.draft) return fail(workspace, 'import_required');
    const facts = fitTargets(workspace.draft.import);
    const fit = facts.length
        ? { available: false, ran: false, facts: facts.length, reason: 'quantity fitting is not available', modelCalls: 0 }
        : { available: false, ran: false, facts: 0, reason: 'no eligible known facts', modelCalls: 0 };
    return done(workspace, { stage: 'review', fit });
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
    const rendered = renderIngredientPaste(workspace.draft.import);
    const exportCopy = rendered.ok ? { format: 'paste', text: rendered.text } : { format: 'json', text: JSON.stringify(workspace.draft.import, null, 2) };
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
