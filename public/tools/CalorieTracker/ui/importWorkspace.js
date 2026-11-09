import { createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
import { openProfileCache } from '../../../shared/nutrition/profileCache.js';
import { clearWorkspaceDraft, readWorkspaceDraft, writeWorkspaceDraft } from '../../../shared/nutrition/importWorkspaceDraft.js';
import { getIngredientStore } from '../services/ingredientStore.js';
import {
    calculateWorkspace, cancelWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, instructionsWorkspace,
    lookupWorkspace, matchWorkspace, packetWorkspace, reviewWorkspace, saveWorkspace, WORKSPACE_STAGES,
} from '../../../shared/nutrition/importWorkspace.js';

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
    if (workspace.fit?.reason) {
        const fit = document.createElement('p');
        fit.textContent = workspace.fit.reason;
        output.append(fit);
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
        const cache = await openProfileCache({ ownerUid });
        loadRevision = async ref => {
            const got = await cache.getRevision(ref);
            return got?.status === 'fresh' ? { revision: got.revision } : null;
        };
    } catch { /* A missing cache leaves the line unresolved rather than zero. */ }
    try {
        const store = await getIngredientStore();
        privateSearch = name => store.searchPrivate(name);
    } catch { /* Offline or signed-out search does not invent a match. */ }
    try {
        const catalog = createCuratedCatalogSource();
        await catalog.open();
        curatedSearch = name => catalog.search(name).catch(() => ({ items: [] }));
    } catch { /* The curated catalog can be absent offline. */ }
    return { privateSearch, curatedSearch, loadRevision };
}

/** Tracker Import tab. Values are text, and saving stays gated. */
export function wireImportWorkspace(getUid) {
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
    const run = async (action) => {
        const uid = owner();
        if (!uid) {
            text(document.getElementById('import-message'), 'Sign in to import. Drafts stay on your account.');
            show(null);
            return;
        }
        if (!workspace || workspace.ownerUid !== uid) workspace = createWorkspace(uid).workspace;
        const result = await action(workspace);
        if (result?.workspace) workspace = result.workspace;
        const message = document.getElementById('import-message');
        text(message, result?.ok === false ? (result.error || 'import failed') : '');
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
        if (result.ok) await copyText(result.workspace.packet?.copyText || '');
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
    document.getElementById('import-cancel')?.addEventListener('click', () => run(current => cancelWorkspace(current)));
    document.getElementById('tab-btn-import')?.addEventListener('click', resume);
    window.__clearImportWorkspace = () => { workspace = null; clearWorkspaceDraft(); show(null); };
    resume();
    text(document.getElementById('import-stages'), WORKSPACE_STAGES.join(' → '));
}
