const KEY = 'nutrition-import-workspace-v1';

function storageOf(storage) {
    if (storage) return storage;
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/** Defensive parse. A record for another owner is not a draft. */
export function parseWorkspaceRecord(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const value = JSON.parse(raw);
        if (!value || value.schemaVersion !== 1 || typeof value.ownerUid !== 'string' || !value.ownerUid) return null;
        if (!value.workspace || value.workspace.ownerUid !== value.ownerUid || value.workspace.schemaVersion !== 1) return null;
        return value;
    } catch {
        return null;
    }
}

export function readWorkspaceDraft(ownerUid, storage) {
    const store = storageOf(storage);
    if (!store || typeof ownerUid !== 'string' || !ownerUid) return null;
    const record = parseWorkspaceRecord(store.getItem(KEY));
    if (!record || record.ownerUid !== ownerUid) return null;
    return record.workspace;
}

export function writeWorkspaceDraft(workspace, storage) {
    const store = storageOf(storage);
    if (!store || !workspace || typeof workspace.ownerUid !== 'string' || !workspace.ownerUid) return { ok: false, error: 'owner_required' };
    store.setItem(KEY, JSON.stringify({ schemaVersion: 1, ownerUid: workspace.ownerUid, workspace }));
    return { ok: true };
}

export function clearWorkspaceDraft(storage) {
    const store = storageOf(storage);
    if (!store) return false;
    store.removeItem(KEY);
    return true;
}
