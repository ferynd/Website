import { createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
import { openProfileCache } from '../../../shared/nutrition/profileCache.js';
import { clearWorkspaceDraft, readWorkspaceDraft, writeWorkspaceDraft } from '../../../shared/nutrition/importWorkspaceDraft.js';
import { getIngredientStore } from '../services/ingredientStore.js';
import { IMPORT_WORKSPACE_ENABLED } from '../../../shared/nutrition/capabilities.js';
import {
    applyResearchResponse, calculateWorkspace, cancelWorkspace, confirmWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, instructionsWorkspace,
    lookupWorkspace, matchWorkspace, packetCopy, packetWorkspace, reviewWorkspace, saveWorkspace, WORKSPACE_STAGES, WORKSPACE_UNCHANGED_NOTICE,
} from '../../../shared/nutrition/importWorkspace.js';
import { activateTab } from './dashboard.js';

const text = (node, value) => { if (node) node.textContent = value == null ? '' : String(value); };

function show(workspace) {
    const stage = document.getElementById('import-stage');
    const output = document.getElementById('import-output');
    const caps = workspace?.capabilities;
    text(document.getElementById('import-capability'), caps
        ? `Import workspace on · fit ${caps.fit ? 'on' : 'off'} · save ${caps.save ? 'on' : 'off'} · photo/OCR off · offline match and copy`
        : 'Sign in to resume an import draft.');
    text(stage, workspace ? `Stage: ${workspace.stage}${workspace.cancelled ? ' · cancelled' : ''}` : '');
    if (!output) return;
    output.replaceChildren();
    if (!workspace?.draft) return;
    for (const line of workspace.review?.rows || workspace.resolution?.items || workspace.origins || []) {
        const row = document.createElement('p');
        const name = line.name || line.lineId;
        const origin = line.origin || '';
        const kind = line.kind || line.sourceKind || '';
        row.textContent = [name, origin, kind, line.basis || ''].filter(Boolean).join(' · ');
        output.append(row);
    }
    if (workspace.calculation?.nutrients) {
        const known = Object.entries(workspace.calculation.nutrients).filter(([, item]) => item?.value != null);
        const unknown = Object.values(workspace.calculation.nutrients).filter(item => item?.value == null).length;
        const totals = document.createElement('p');
        totals.textContent = `Calculated: ${known.slice(0, 8).map(([key, item]) => `${key} ${item.value} (${item.status || 'unknown'})`).join('; ')}${unknown ? `; ${unknown} unknown` : ''}`;
        output.append(totals);
    }
    for (const comparison of workspace.review?.comparisons || []) {
        for (const row of comparison.rows || []) {
            const fact = document.createElement('p');
            fact.textContent = `${comparison.factId} ${row.key}: known ${row.known ?? 'n/a'}, calculated ${row.calculated ?? 'n/a'}${row.note ? `, ${row.note}` : ''}`;
            output.append(fact);
        }
    }
    for (const line of workspace.match?.lines || []) {
        if (!line.needsConfirmation) continue;
        for (const candidate of line.candidates || []) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm';
            button.textContent = candidate.compatibility === 'conflict' ? `Confirm conflict: ${candidate.canonicalName || candidate.variantId}` : `Use ${candidate.canonicalName || candidate.variantId}`;
            button.addEventListener('click', () => run(async current => confirmWorkspace(current, line.lineId, candidate.variantId ?? candidate.ref?.variantId, await matchPorts(current.ownerUid), { acknowledgeConflict: candidate.compatibility === 'conflict' })));
            output.append(button);
        }
    }
    if (workspace.fit?.flags || workspace.fit?.reason) {
        const fit = document.createElement('p');
        const flags = workspace.fit.flags;
        fit.textContent = workspace.fit.reason || `Fit ${flags?.infeasible ? 'infeasible' : 'feasible'}${flags?.nonUnique ? ', more than one quantity set fits' : ''}`;
        output.append(fit);
    }
    for (const quantity of workspace.fit?.quantities || []) {
        if (!quantity.changed) continue;
        const row = document.createElement('p');
        row.textContent = `${quantity.lineId}: ${quantity.grams} g estimated`;
        output.append(row);
    }
    if (workspace.save?.reason) {
        const save = document.createElement('p');
        save.textContent = workspace.save.reason;
        output.append(save);
    }
    if (workspace.preserved?.length) {
        const kept = document.createElement('p');
        kept.textContent = `Preserved research jobs: ${workspace.preserved.map(job => job.jobId).join(', ')}`;
        output.append(kept);
    }
}

async function copyText(value) {
    const box = document.getElementById('import-copy');
    if (box) box.value = value || '';
    try { await navigator.clipboard?.writeText(value || ''); } catch { /* The textarea remains the copy source. */ }
}

async function matchPorts(ownerUid) {
    const empty = async () => ({ items: [] });
    let privateSearch = empty;
    let curatedSearch = empty;
    let loadRevision = async () => null;
    try {
        const store = await getIngredientStore();
        privateSearch = async name => {
            try { return await store.searchPrivate(name); }
            catch { return { items: [] }; }
        };
        loadRevision = async ref => {
            const got = await store.resolveRef(ref);
            return got?.revision ? { revision: got.revision } : null;
        };
    } catch { /* Offline or signed-out search does not invent a match. */ }
    try {
        const cache = await openProfileCache({ ownerUid });
        const fromStore = loadRevision;
        loadRevision = async ref => {
            const loaded = await fromStore(ref);
            if (loaded?.revision) return loaded;
            const got = await cache.getRevision(ref);
            return got?.status === 'fresh' || got?.status === 'stale' ? { revision: got.revision } : null;
        };
    } catch { /* A missing cache leaves the line unresolved rather than zero. */ }
    try {
        const catalog = createCuratedCatalogSource();
        await catalog.open();
        curatedSearch = name => catalog.search(name).catch(() => ({ items: [] }));
    } catch { /* The curated catalog can be absent offline. */ }
    return { privateSearch, curatedSearch, loadRevision };
}

/** Tracker Ingredient Import (Beta) tab. Values are text, saving stays gated, and nothing here logs to the diary. */
export function wireImportWorkspace(getUid) {
    if (!IMPORT_WORKSPACE_ENABLED) {
        document.getElementById('tab-btn-import')?.classList.add('hidden');
        document.getElementById('tab-import')?.classList.add('hidden');
        return;
    }
    let workspace = null;
    const owner = () => {
        const uid = getUid();
        return typeof uid === 'string' && uid ? uid : null;
    };
    const persist = () => { const uid = owner(); if (uid && workspace?.ownerUid === uid) writeWorkspaceDraft(workspace); };
    const resume = () => {
        const uid = owner();
        workspace = uid ? readWorkspaceDraft(uid) || createWorkspace(uid).workspace : null;
        show(workspace);
    };
    // Import actions never write foods or diary entries, so a failure or cancel always leaves them unchanged.
    const run = async (action, { abandon = false } = {}) => {
        const uid = owner();
        if (!uid) {
            text(document.getElementById('import-message'), 'Sign in to import. Drafts stay on your account.');
            show(null);
            return;
        }
        if (!workspace || workspace.ownerUid !== uid) workspace = createWorkspace(uid).workspace;
        let result;
        try { result = await action(workspace); }
        catch { result = { ok: false, error: 'import failed' }; }
        if (result?.workspace) workspace = result.workspace;
        const message = document.getElementById('import-message');
        if (result?.ok === false) text(message, `Import failed: ${result.error || 'import failed'}. ${WORKSPACE_UNCHANGED_NOTICE}`);
        else if (abandon) text(message, `Import cancelled. ${result?.workspace?.notice || WORKSPACE_UNCHANGED_NOTICE}`);
        else text(message, '');
        show(workspace);
        persist();
    };
    document.getElementById('import-run')?.addEventListener('click', () => run(current => importWorkspaceInput(current, document.getElementById('import-text')?.value || '', { kind: document.getElementById('import-kind')?.value || 'ingredient_list' })));
    document.getElementById('import-instructions')?.addEventListener('click', () => copyText(instructionsWorkspace().text));
    document.getElementById('import-match')?.addEventListener('click', () => run(async current => matchWorkspace(current, await matchPorts(current.ownerUid))));
    document.getElementById('import-lookup')?.addEventListener('click', () => run(current => lookupWorkspace(current, (current.resolution?.items || []).filter(item => !item.resolved).map(item => item.lineId))));
    document.getElementById('import-packet')?.addEventListener('click', () => run(async current => {
        const ids = (current.resolution?.items || []).filter(item => !item.resolved).map(item => item.lineId);
        const result = await packetWorkspace(current, ids);
        if (result.ok) await copyText(packetCopy(result.workspace.packet));
        return result;
    }));
    document.getElementById('import-review')?.addEventListener('click', () => run(current => {
        const calculated = calculateWorkspace(current);
        if (!calculated.ok) return calculated;
        const fitted = fitWorkspace(calculated.workspace);
        if (!fitted.ok) return fitted;
        return reviewWorkspace(fitted.workspace);
    }));
    document.getElementById('import-export')?.addEventListener('click', () => run(async current => {
        const result = saveWorkspace(current);
        if (result.ok) await copyText(result.workspace.exportCopy?.text || '');
        return result;
    }));
    document.getElementById('import-cancel')?.addEventListener('click', () => run(current => cancelWorkspace(current), { abandon: true }));
    document.getElementById('import-return-today')?.addEventListener('click', () => activateTab('today'));
    document.getElementById('import-apply')?.addEventListener('click', () => run(current => applyResearchResponse(current, document.getElementById('import-response')?.value || '')));
    document.getElementById('tab-btn-import')?.addEventListener('click', resume);
    window.__clearImportWorkspace = () => { workspace = null; clearWorkspaceDraft(); show(null); };
    window.__resumeImportWorkspace = resume;
    resume();
    text(document.getElementById('import-stages'), WORKSPACE_STAGES.join(' → '));
}
