import { calculateMeal } from './calculate.js';
import { fitTargets } from './import/ingredientList.js';
import { copyableResearchPacket, buildResearchPackets } from './research/researchPacket.js';
import { jobIdFor, jobKeyV1 } from './research/researchJob.js';
import { PROFILE_FIELDS } from './research/profileFields.js';

/** Shared missing-ingredient ladder. No network, no fit solver, no store writes. */
export const RESOLUTION_CAPABILITIES = Object.freeze({
    fitPanel: false,
    libraryDeepLink: false,
    directAiRoute: false,
});
const LADDER = Object.freeze(['choose_existing', 'lookup_official', 'research_packet', 'manual_entry', 'incomplete_draft', 'cancel']);

function missingFields(nutrients = {}) {
    return PROFILE_FIELDS.filter(key => nutrients[key] == null || nutrients[key].value == null);
}

function classify(line, match, nutrients) {
    if (!match || match.outcome === 'missing') return { kind: 'missing_profile', missingFields: [] };
    if (match.outcome !== 'exact') return { kind: 'needs_confirmation', missingFields: [] };
    const fields = missingFields(nutrients);
    return fields.length ? { kind: 'missing_fields', missingFields: fields } : { kind: 'resolved', missingFields: [] };
}

/** One row per line. Missing profiles are not listed as missing fields. */
export function buildResolution({ lines = [], matches = [], nutrientsByLine = {} } = {}) {
    const seen = new Set();
    const items = [];
    for (const line of lines) {
        if (seen.has(line.lineId)) continue;
        seen.add(line.lineId);
        const match = matches.find(item => item.lineId === line.lineId) || null;
        const nutrients = nutrientsByLine[line.lineId] || {};
        const gap = classify(line, match, nutrients);
        items.push({
            lineId: line.lineId,
            name: line.name,
            kind: gap.kind,
            missingFields: gap.missingFields,
            match,
            officialAttempts: [],
            resolved: gap.kind === 'resolved',
            estimate: false,
            nutrients,
            source: gap.kind === 'resolved' ? 'library' : null,
        });
    }
    return { schemaVersion: 1, items, lines, capabilities: RESOLUTION_CAPABILITIES, ladder: LADDER, modelCalls: 0, cancelled: false, committed: false };
}

function replace(state, lineId, patch) {
    return { ...state, modelCalls: 0, items: state.items.map(item => item.lineId === lineId ? { ...item, ...patch } : item) };
}

export function chooseExisting(state, lineId, choice) {
    const item = state.items.find(row => row.lineId === lineId);
    if (!item) return { ok: false, error: 'unknown_line', state };
    const estimate = choice.mode === 'substitute';
    return { ok: true, state: replace(state, lineId, { kind: 'resolved', resolved: true, missingFields: [], estimate, source: estimate ? 'substitute' : 'alias', nutrients: choice.nutrients || item.nutrients, aliasProposal: choice.aliasProposal || null }) };
}

export function lookupOfficial(state, lineId, attempt) {
    const item = state.items.find(row => row.lineId === lineId);
    if (!item) return { ok: false, error: 'unknown_line', state };
    const officialAttempts = [...item.officialAttempts, { adapter: attempt.adapter || 'curated', release: attempt.release || 'nutrition-curated@0', outcome: attempt.outcome }];
    if (attempt.outcome === 'resolved') {
        return { ok: true, state: replace(state, lineId, { officialAttempts, kind: 'resolved', resolved: true, missingFields: [], source: 'official', nutrients: attempt.nutrients || {} }) };
    }
    const fields = attempt.unresolvedFields || item.missingFields;
    return { ok: true, state: replace(state, lineId, { officialAttempts, kind: item.kind === 'resolved' ? 'missing_fields' : item.kind, resolved: false, missingFields: fields, reason: attempt.reason || 'official lookup left fields unresolved' }) };
}

function packetAllowed(item, override) {
    return override || item.officialAttempts.some(attempt => attempt.outcome !== 'resolved');
}

/** Copy one packet for selected unresolved lines. Matched lines are excluded. */
export async function researchPacket(state, lineIds, { override = false, ownerUid = 'local', namespace = 'default-app-id' } = {}) {
    const selected = state.items.filter(item => lineIds.includes(item.lineId));
    if (selected.some(item => item.resolved && item.kind === 'resolved' && item.source === 'library'))
        return { ok: false, error: 'matched_line', state };
    if (selected.some(item => !packetAllowed(item, override)))
        return { ok: false, error: 'official_lookup_required', state };
    const jobs = [];
    for (const item of selected.filter(row => !row.resolved)) {
        const line = state.lines.find(row => row.lineId === item.lineId);
        const fields = item.missingFields.length ? item.missingFields : '*';
        const jobId = await jobIdFor(jobKeyV1({ targetKind: 'private', fields, sourceRelease: 'resolution', target: { ownerUid, namespace, identityId: `line-${item.lineId}`, variantId: `line-${item.lineId}` } }));
        jobs.push({
            state: 'queued', jobId, requestedFields: fields,
            attempts: item.officialAttempts.length ? item.officialAttempts : [{ adapter: 'override', release: 'user', outcome: 'skipped' }],
            target: { dims: line?.variant || {}, canonicalName: item.name, category: 'other', kind: line?.kind || 'generic', aliases: [], knownObservations: {} },
        });
    }
    if (!jobs.length) return { ok: false, error: 'nothing_unresolved', state };
    const requests = await buildResearchPackets(jobs, { purpose: itemPurpose(selected) });
    return { ok: true, state: { ...state, modelCalls: 0 }, packets: requests, copyText: requests.map(copyableResearchPacket).join('\n\n'), modelCalls: 0 };
}

function itemPurpose(items) {
    return items.some(item => item.kind === 'missing_profile') ? 'profile' : 'fields';
}

export function manualEntry(state, lineId, nutrients) {
    return { ok: true, state: replace(state, lineId, { kind: 'resolved', resolved: true, missingFields: [], estimate: false, source: 'manual', nutrients }) };
}

export function saveIncomplete(state) {
    return { ...state, incomplete: true, modelCalls: 0, items: state.items };
}

export function cancelResolution(state) {
    return { ...state, cancelled: true, committed: false, researchStarted: false, modelCalls: 0, items: state.items, lines: state.lines };
}

export function resolutionLines(state) {
    return state.lines.map(line => {
        const item = state.items.find(row => row.lineId === line.lineId);
        return { ...line, nutrients: item?.nutrients || line.nutrients || {}, quantityBasis: item?.estimate ? 'estimated' : line.quantityBasis };
    });
}

/** Recalculate from resolved nutrients. Does not research again. */
export function recalculateResolution(state, options = {}) {
    return { calculation: calculateMeal({ ...options, lines: resolutionLines(state) }), modelCalls: 0, researchedLineIds: state.items.filter(item => item.source === 'packet').map(item => item.lineId) };
}

export function reviewResolution(state, calculation, facts = []) {
    const rows = state.lines.map(line => {
        const item = state.items.find(row => row.lineId === line.lineId);
        return {
            lineId: line.lineId,
            name: String(line.name || ''),
            basis: line.quantityBasis || 'estimated',
            grams: line.grams,
            gMin: line.gMin ?? null,
            gMax: line.gMax ?? null,
            source: item?.source || null,
            kind: item?.kind || 'resolved',
            text: `${line.name || 'ingredient'}: ${line.grams} g ${line.quantityBasis || ''}`.trim(),
        };
    });
    const comparisons = fitTargets({ knownFacts: facts }).map(fact => {
        const rows = Object.entries(fact.nutrients || {}).map(([key, observed]) => {
            const calculated = calculation?.nutrients?.[key];
            return { key, known: observed.value, unit: observed.unit, rounding: observed.rounding || null, calculated: calculated?.value ?? null, difference: calculated?.value == null ? null : calculated.value - observed.value };
        });
        return { factId: fact.factId, rows };
    });
    const uncertainties = Object.entries(calculation?.nutrients || {}).filter(([, item]) => item.status === 'estimated' || (item.low != null && item.high != null && item.low !== item.high)).map(([key, item]) => ({ key, status: item.status, low: item.low, high: item.high }));
    return { rows, comparisons, uncertainties, coverage: calculation?.nutrients || {}, fit: { available: false, reason: 'quantity fitting is not available' }, capabilities: RESOLUTION_CAPABILITIES, modelCalls: 0 };
}
