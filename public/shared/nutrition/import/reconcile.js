import { matchIngredient } from '../ingredientMatch.js';
import { compareVariants } from '../ingredientVariants.js';
import { normalizeMatchDims } from './ingredientList.js';
import { effectiveLine } from './importDraft.js';

const nameOf = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

function row(lineId, name, outcome, extra) {
    return {
        lineId,
        name,
        outcome,
        ref: extra.ref ?? null,
        compatibility: extra.compatibility ?? null,
        needsResearch: outcome === 'missing',
        needsConfirmation: outcome === 'underspecified' || outcome === 'ambiguous' || outcome === 'conflict',
        candidates: extra.candidates ?? [],
    };
}

function classify(lineId, name, dims, matched) {
    if (matched.kind === 'exact') return row(lineId, name, 'exact', { ref: matched.ref, compatibility: 'exact' });
    const candidates = (matched.candidates ?? []).map(candidate => ({
        ref: candidate.ref ?? null,
        variantId: candidate.variantId ?? candidate.ref?.variantId ?? null,
        canonicalName: candidate.canonicalName ?? '',
        aliases: candidate.aliases ?? [],
        compatibility: candidate.compatibility ?? compareVariants(dims, candidate.dims ?? {}),
        score: candidate.score ?? 0,
    }));
    const named = value => nameOf(value) === nameOf(name);
    const pool = candidates.filter(candidate => candidate.score >= 1 || named(candidate.canonicalName) || (candidate.aliases ?? []).some(alias => named(alias.text ?? alias)));
    if (!pool.length) return row(lineId, name, 'missing', { candidates: [] });
    const exacts = pool.filter(candidate => candidate.compatibility === 'exact');
    const underspecified = pool.filter(candidate => candidate.compatibility === 'underspecified');
    const conflicts = pool.filter(candidate => candidate.compatibility === 'conflict');
    let outcome = 'ambiguous';
    if (conflicts.length && !exacts.length && !underspecified.length) outcome = 'conflict';
    else if (underspecified.length === 1 && !exacts.length && !conflicts.length) outcome = 'underspecified';
    return row(lineId, name, outcome, { compatibility: outcome === 'ambiguous' ? null : outcome, candidates: pool });
}

/**
 * Match each line through #61. Exact confirmed compatibility reuses the stored revision.
 * Raw/cooked and drained/undrained conflicts are never selected automatically.
 * This function does not research, calculate, or write.
 */
export async function reconcileImport(draft, ports = {}) {
    if (!draft?.import?.ingredients) throw new TypeError('ImportDraft required');
    const privateSearch = ports.privateSearch ?? (async () => ({ items: [] }));
    const curatedSearch = ports.curatedSearch ?? (async () => ({ items: [] }));
    const lines = [];
    for (const stored of draft.import.ingredients) {
        const line = effectiveLine(draft, stored.lineId);
        const dims = normalizeMatchDims(line.variant || {});
        const pinned = ports.lineRefs?.[stored.lineId] ?? draft.source?.lineRefs?.[stored.lineId] ?? null;
        const pinnedDims = ports.refDims?.[stored.lineId] ?? null;
        if (pinned && pinnedDims) {
            const compatibility = compareVariants(dims, pinnedDims);
            if (compatibility === 'exact') {
                lines.push(row(stored.lineId, line.name, 'exact', { ref: pinned, compatibility }));
                continue;
            }
            if (compatibility === 'conflict') {
                lines.push(row(stored.lineId, line.name, 'conflict', { compatibility, candidates: [{ ref: pinned, variantId: pinned.variantId ?? null, canonicalName: line.name, compatibility, score: 1 }] }));
                continue;
            }
        }
        const matched = await matchIngredient({ name: line.name, dims }, { privateSearch, curatedSearch, confirmedRefs: [] });
        lines.push(classify(stored.lineId, line.name, dims, matched));
    }
    return { schemaVersion: 1, modelCalls: 0, writes: false, lines };
}

export function proposeConfirmedAlias(line, candidate) {
    if (!candidate?.ref || candidate.compatibility === 'conflict') return { ok: false, reason: 'conflict_not_auto_resolved', writes: false };
    return {
        ok: true,
        writes: false,
        proposal: {
            schemaVersion: 1,
            lineId: line.lineId,
            text: line.name,
            variantId: candidate.variantId ?? candidate.ref.variantId ?? null,
            namespace: candidate.ref.namespace ?? null,
            kind: 'confirmed',
            writes: false,
        },
    };
}

/** Explicit confirmation only. A conflicting form still requires acknowledgeConflict. */
export function confirmMatch(result, lineId, variantId, options = {}) {
    const current = result?.lines?.find(item => item.lineId === lineId);
    if (!current) return { ok: false, reason: 'unknown_line', writes: false };
    const candidate = current.candidates.find(item => (item.variantId ?? item.ref?.variantId) === variantId);
    if (!candidate) return { ok: false, reason: 'unknown_candidate', writes: false };
    if (candidate.compatibility === 'conflict' && !options.acknowledgeConflict)
        return { ok: false, reason: 'conflict_not_auto_resolved', writes: false };
    const proposal = {
        schemaVersion: 1,
        lineId,
        text: current.name,
        variantId,
        namespace: candidate.ref?.namespace ?? null,
        kind: candidate.compatibility === 'conflict' ? 'explicit_conflict_override' : 'confirmed',
        writes: false,
    };
    return {
        ok: true,
        writes: false,
        result: {
            ...result,
            modelCalls: 0,
            writes: false,
            lines: result.lines.map(item => item.lineId === lineId ? { ...item, outcome: 'confirmed_by_user', ref: candidate.ref, needsResearch: false, needsConfirmation: false, aliasProposal: proposal } : item),
        },
    };
}
