import { emptyStagedRecord } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { privateIdentityId, privateVariantId } from '../../../shared/nutrition/ingredientIds.js';
export const identity = { canonicalName: 'Chicken', category: 'meat', kind: 'food' };
export const dims = { state: 'raw' };
export async function fixture(value = 10) {
    const identityId = await privateIdentityId(identity), variantId = await privateVariantId(identityId, dims);
    const stagedRecord = emptyStagedRecord();
    stagedRecord.values.protein = value;
    stagedRecord.quality.protein = { status: 'measured' };
    const input = { identityId, variantId, stagedRecord, basis: { kind: 'per_100g_edible', state: 'raw' }, fieldProvenance: { protein: { sourceKey: 'manual' } }, sources: { manual: { type: 'manual', title: 'Test fixture' } } };
    const draft = await buildRevisionDraft(input);
    const revision = { ...draft, ownerUid: 'owner', revision: 1, revisionId: variantId + '~r1', idempotencyKey: 'test', createdAt: 0 };
    const ref = { refVersion: 1, scope: 'private', namespace: 'default-app-id', identityId, variantId, revision: 1, revisionId: revision.revisionId, contentHash: revision.contentHash };
    return { input, draft, revision, ref };
}
/** Optimistic fake interleaves reads, then retries on observed document changes. */
export function fakePort() {
    const docs = new Map();
    const port = { docs, docRef: p => p, getDoc: async (p) => structuredClone(docs.get(p) ?? null), serverTimestamp: () => 0,
        queryCollection: async (path, q) => [...docs].filter(([p, d]) => p.startsWith(path + '/') && p.slice(path.length + 1).indexOf('/') < 0 && (!q.arrayContains || d[q.arrayContains[0]]?.includes(q.arrayContains[1])) && (!q.equals || q.equals[0].split('.').reduce((value, key) => value?.[key], d) === q.equals[1])).map(([p, d]) => ({ ...d, id: p.split('/').at(-1) })).sort((a, b) => a.id.localeCompare(b.id)).filter(d => !q.startAfterId || d.id > q.startAfterId).slice(0, q.limit),
        async runTransaction(fn) {
            for (let attempt = 0; attempt < 10; attempt++) {
                port.attempts = (port.attempts ?? 0) + 1;
                const reads = new Map(), pending = [];
                const result = await fn({ get: async (p) => { const data = await port.getDoc(p); reads.set(p, JSON.stringify(data)); return data; }, set: (p, d) => pending.push([p, d]), update: (p, d) => pending.push([p, { ...docs.get(p), ...d }]) });
                await port.beforeCommit?.();
                if ([...reads].some(([p, version]) => JSON.stringify(docs.get(p) ?? null) !== version))
                    continue;
                if (port.failCommit)
                    throw new Error('Offline commit failure');
                for (const [p, d] of pending)
                    docs.set(p, structuredClone(d));
                return result;
            }
            throw new Error('Transaction retry limit');
        } };
    return port;
}
