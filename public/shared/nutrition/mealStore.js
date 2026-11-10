import { INGREDIENT_STORE_WRITES_ENABLED } from './capabilities.js';
import { isValidFirestoreDocId } from './ingredientIds.js';
import { IngredientWritesDisabledError, RevisionConflictError } from './ingredientStore.js';
import { saveWorkspace, workspaceCapabilities } from './importWorkspace.js';
import { buildMealSnapshot, mealRefOf, mealVersionIdFor, verifyMealRecord } from './mealSnapshot.js';

/**
 * #64 Part B meal versions. Port-injected like createIngredientStore and gated on the same write flag;
 * meal records live beside the owner's ingredient profiles. A save never writes a diary entry.
 * No rules exist for these collections yet: that is a #61 Part B production step.
 */
export const MEAL_COLLECTIONS = Object.freeze({ meals: 'mealRecords', versions: 'mealRecordVersions' });

export class MealVersionConflictError extends RevisionConflictError {
}

const assertWrites = () => { if (!INGREDIENT_STORE_WRITES_ENABLED) throw new IngredientWritesDisabledError('Meal writes are disabled'); };

export function createMealStore({ port, namespace, ownerUid, cache, now = Date.now }) {
    if (!isValidFirestoreDocId(namespace) || !isValidFirestoreDocId(ownerUid)) throw new TypeError('Namespace and owner are required');
    const prefix = 'artifacts/' + namespace + '/users/' + ownerUid + '/';
    const path = (kind, id) => {
        if (!isValidFirestoreDocId(id)) throw new TypeError('Invalid document ID');
        return port.docRef(prefix + MEAL_COLLECTIONS[kind] + '/' + id);
    };

    /**
     * Save `record` as version 1, or as the next version on top of `baseVersion`. A record whose hash
     * equals the head is returned as is (deduped). A different head than `baseVersion` is a conflict.
     * The payload stays in the pending-save outbox until the transaction commits.
     */
    async function saveMealVersion(record, { baseVersion = null } = {}) {
        assertWrites();
        if (record?.ownerUid !== ownerUid || (await verifyMealRecord(record)).length) throw new TypeError('Invalid meal record');
        if (baseVersion != null && (!Number.isSafeInteger(baseVersion) || baseVersion < 1)) throw new TypeError('Invalid base version');
        const key = record.idempotencyKey;
        await cache?.putPendingSave({ idempotencyKey: key, operation: 'saveMealVersion', payload: { record, baseVersion }, createdAt: now() });
        const result = await port.runTransaction(async (tx) => {
            const head = await tx.get(path('meals', record.mealId));
            const current = head ? await tx.get(path('versions', head.headVersionId)) : null;
            if (head && current?.contentHash === record.contentHash) return { mealRef: mealRefOf(current), deduped: true };
            if ((head?.headVersion ?? null) !== baseVersion) throw new MealVersionConflictError('Meal changed; review the pending save');
            const version = (baseVersion ?? 0) + 1;
            const versionId = mealVersionIdFor(record.mealId, version);
            const stored = {
                ...record, namespace, version, versionId,
                supersedes: current ? { version: current.version, versionId: current.versionId, contentHash: current.contentHash } : null,
                createdAt: port.serverTimestamp(),
            };
            tx.set(path('versions', versionId), stored);
            const headDoc = { schemaVersion: 1, ownerUid, mealId: record.mealId, title: record.title, headVersion: version, headVersionId: versionId, headContentHash: record.contentHash, updatedAt: port.serverTimestamp() };
            if (head) tx.update(path('meals', record.mealId), headDoc);
            else tx.set(path('meals', record.mealId), { ...headDoc, createdAt: port.serverTimestamp() });
            return { mealRef: mealRefOf(stored), deduped: false };
        });
        await cache?.deletePendingSave(key);
        return result;
    }

    /** A saved version, verified. Corrupt or foreign documents are not returned as records. */
    async function getMealVersion(ref) {
        if (!ref?.versionId || ref.namespace !== namespace) return { status: 'missing', ref };
        const record = await port.getDoc(path('versions', ref.versionId));
        if (!record) return { status: 'missing', ref };
        if (record.ownerUid !== ownerUid || record.contentHash !== ref.contentHash || (await verifyMealRecord(record)).length) return { status: 'corrupt', ref };
        return { status: 'fresh', ref, record };
    }

    return {
        saveMealVersion,
        getMealVersion,
        getMealHead: id => port.getDoc(path('meals', id)),
        listPendingSaves: async () => (await cache?.listPendingSaves() ?? []).filter(item => item.operation === 'saveMealVersion'),
        retirePendingSave: async (key) => { assertWrites(); await cache?.deletePendingSave(key); },
        retryPendingSave: async (key, replacement) => {
            assertWrites();
            const saved = (await cache?.listPendingSaves())?.find(item => item.idempotencyKey === key && item.operation === 'saveMealVersion');
            if (!saved) throw new TypeError('Missing saved draft');
            const payload = replacement ?? saved.payload;
            const result = await saveMealVersion(payload.record, { baseVersion: payload.baseVersion ?? null });
            if (payload.record.idempotencyKey !== key) await cache?.deletePendingSave(key);
            return result;
        },
    };
}

/**
 * Save the reviewed workspace as a meal version. While save is off (both write flags false) this returns
 * exactly saveWorkspace(): the export copy, committed false, logged false, and the existing reason, and it
 * touches no store. With save on it builds the snapshot and commits it; it never logs to the diary.
 * Lines whose profiles do not exist yet come back as blockers; no profile is created here.
 */
export function commitWorkspaceMeal({ store = null, workspace = undefined, baseVersion = null, mealId = null, title = null, nestedMeals = [] } = {}) {
    if (!workspaceCapabilities().save) return saveWorkspace(workspace);
    return commitEnabled({ store, workspace, baseVersion, mealId, title, nestedMeals });
}

async function commitEnabled({ store, workspace, baseVersion, mealId, title, nestedMeals }) {
    const refuse = (error, extra = {}) => ({ ok: false, error, committed: false, logged: false, writes: false, modelCalls: 0, ...extra });
    const built = await buildMealSnapshot(workspace, { mealId, title, nestedMeals });
    if (!built.ok) return refuse(built.error, { blockers: built.blockers || [], errors: built.errors || [] });
    if (!store) return refuse('store_unavailable', { record: built.record });
    try {
        const saved = await store.saveMealVersion(built.record, { baseVersion });
        return {
            ok: true, committed: true, writes: !saved.deduped, deduped: saved.deduped, logged: false, modelCalls: 0,
            mealRef: saved.mealRef,
            workspace: { ...workspace, stage: 'save', committed: true, mealRef: saved.mealRef, save: { available: true, logged: false } },
        };
    } catch (error) {
        if (error instanceof IngredientWritesDisabledError) return refuse('writes_disabled');
        if (error instanceof RevisionConflictError) return refuse('meal_conflict', { retained: true, record: built.record });
        return refuse('save_failed', { message: String(error?.message || error), retained: true, record: built.record });
    }
}
