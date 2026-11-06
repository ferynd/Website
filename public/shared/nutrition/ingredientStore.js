import { INGREDIENT_STORE_WRITES_ENABLED } from './capabilities.js';
import { INGREDIENT_COLLECTIONS as C, identityKeyV1, privateIdentityId, privateVariantId, overrideVariantId, variantKeyV1, revisionIdFor, buildSearchTokens, searchWords, isValidFirestoreDocId } from './ingredientIds.js';
import { normalizeVariantDims } from './ingredientVariants.js';
import { parseIngredientRef, sameRef } from './ingredientRefs.js';
import { validateRevision, verifyRevisionHash } from './ingredientProfile.js';
import { validateConversion } from './ingredientConversion.js';
import { sha256Hex } from './contentHash.js';
export class IdentityKeyCollisionError extends Error {
}
export class RevisionConflictError extends Error {
}
export class IngredientWritesDisabledError extends Error {
}
export class NeedsReviewError extends Error {
}
const assertWrites = () => { if (!INGREDIENT_STORE_WRITES_ENABLED)
    throw new IngredientWritesDisabledError('Ingredient store writes are disabled'); };
export function createIngredientStore({ port, namespace, ownerUid, cache, catalog, now = Date.now }) {
    if (!isValidFirestoreDocId(namespace) || !isValidFirestoreDocId(ownerUid))
        throw new TypeError('Namespace and owner are required');
    const prefix = 'artifacts/' + namespace + '/users/' + ownerUid + '/';
    const path = (kind, id) => {
        if (!isValidFirestoreDocId(id))
            throw new TypeError('Invalid document ID');
        return port.docRef(prefix + C[kind] + '/' + id);
    };
    const refOf = (r, scope = 'private') => ({ refVersion: 1, scope, namespace: scope === 'private' ? namespace : 'catalog:nutrition-curated', identityId: r.identityId, variantId: r.variantId, revision: r.revision, revisionId: r.revisionId, contentHash: r.contentHash });
    async function searchPrivate(q, { pageSize = 25, cursor } = {}) {
        const size = Math.max(1, Math.min(25, Math.floor(pageSize) || 25));
        const words = searchWords(q);
        // Single letters have no general prefix index. Wait for a second letter.
        if (!words.length || words[0].length < 2)
            return { items: [], cursor: null };
        // Cursor pins the last identity/variant pair scanned. A null variant
        // means that identity was exhausted. Accept the old identity-only cursor.
        let afterIdentity = cursor, afterVariant = null;
        if (cursor?.startsWith('v1:')) {
            const position = JSON.parse(cursor.slice(3));
            if (!Array.isArray(position) || position.length !== 2 ||
                !isValidFirestoreDocId(position[0]) || (position[1] !== null && !isValidFirestoreDocId(position[1])))
                throw new TypeError('Invalid search cursor');
            [afterIdentity, afterVariant] = position;
        }
        const positionOf = (id, variantId = null) => 'v1:' + JSON.stringify([id, variantId]);
        const budget = Math.min(size, 5); // At most five variant queries per page.
        // A reserved alias word may have no prefix token. Query its full word
        // too, merging both bounded queries in document-ID order.
        const tokens = [...new Set([words[0].slice(0, 8), words[0]])];
        const pages = await Promise.all(tokens.map(token => port.queryCollection(prefix + C.identities,
            { arrayContains: ['searchTokens', token], orderById: true, limit: budget + 1, startAfterId: afterIdentity })));
        let rows = [...new Map(pages.flat().map(row => [row.id, row])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        if (afterVariant) {
            const identity = await port.getDoc(path('identities', afterIdentity));
            if (identity) rows.unshift({ ...identity, id: afterIdentity });
        }
        const items = [];
        let next = null;
        for (const identity of rows.slice(0, budget)) {
            next = positionOf(identity.id);
            const indexedWords = [identity.canonicalName, ...(identity.aliases ?? []).map(a => a.text)].flatMap(searchWords);
            if (identity.retiredAt || !words.every(word => indexedWords.some(t => t.startsWith(word))))
                continue;
            const remaining = size - items.length;
            const variants = await port.queryCollection(prefix + C.variants, { equals: ['identityId', identity.identityId], orderById: true,
                limit: remaining + 1, startAfterId: identity.id === afterIdentity ? afterVariant ?? undefined : undefined });
            for (const variant of variants.slice(0, remaining)) {
                const ref = parseIngredientRef(refOf({ ...variant, revision: variant.headRevision, revisionId: variant.headRevisionId, contentHash: variant.headContentHash }));
                if (ref && variant.dims && !variant.retiredAt)
                    items.push({ ...identity, ...variant, ref });
            }
            if (variants.length > remaining)
                return { items, cursor: positionOf(identity.id, variants[remaining - 1].id) };
            if (items.length === size)
                return { items, cursor: rows.at(-1).id !== identity.id ? next : null };
        }
        return { items, cursor: rows.length > budget ? next : null };
    }

    async function getConversions(raw) {
        const ref = parseIngredientRef(raw);
        if (!ref || (ref.scope === 'private' && ref.namespace !== namespace))
            return [];
        const cached = (await cache?.getConversions(ref.namespace) ?? []).filter(c => sameRef(c.variantRef, ref) && !validateConversion(c).length);
        try {
            let conversions = [];
            if (ref.scope === 'curated') {
                conversions = await catalog?.getConversions(ref.variantId) ?? [];
            } else {
                let cursor;
                do {
                    const rows = await port.queryCollection(prefix + C.conversions, { equals: ['variantRef.variantId', ref.variantId], orderById: true, limit: 25, startAfterId: cursor });
                    conversions.push(...rows.map(row => { const { id, ...conversion } = row; return conversion; }));
                    cursor = rows.length === 25 ? rows.at(-1).id : undefined;
                } while (cursor);
            }
            conversions = conversions.filter(c => sameRef(c.variantRef, ref) && !validateConversion(c).length && (ref.scope !== 'private' || c.ownerUid === ownerUid));
            for (const c of conversions)
                await cache?.putConversion(ref.namespace, c);
            return conversions;
        } catch { return cached; }
    }

    async function resolveRef(raw) {
        const ref = parseIngredientRef(raw);
        if (!ref || (ref.scope === 'private' && ref.namespace !== namespace))
            return { status: 'corrupt', ref: raw };
        const cached = await cache?.getRevision(ref);
        if (cached?.status === 'corrupt')
            return cached;
        let revision = cached?.revision;
        let head;
        try {
            if (!revision)
                revision = ref.scope === 'private' ? await port.getDoc(path('revisions', ref.revisionId)) : await catalog?.getRevision(ref.variantId, ref.revision);
            if (!revision)
                return { status: 'missing', ref };
            if (!await verifyRevisionHash(revision) || !sameRef(ref, refOf(revision, ref.scope)) || (ref.scope === 'private' && revision.ownerUid !== ownerUid))
                return { status: 'corrupt', ref };
            await cache?.putRevision(ref, revision);
            const knownHead = await cache?.getHead(ref);
            head = knownHead?.head;
            if (!head || knownHead.status === 'stale') {
                head = ref.scope === 'private' ? await port.getDoc(path('variants', ref.variantId)) : await catalog?.getVariant(ref.variantId);
                if (head)
                    await cache?.putHead(ref, head);
            }
            return { status: 'fresh', ref, revision, newerAvailable: !!head && head.headRevision > ref.revision };
        }
        catch {
            return revision ? { status: 'stale', ref, revision, newerAvailable: false } : { status: 'missing', ref };
        }
    }
    async function resolveEffectiveProfile(curatedRef) {
        const id = await overrideVariantId('nutrition-curated', curatedRef.variantId);
        const head = await port.getDoc(path('variants', id));
        if (head && !head.retiredAt)
            return resolveRef(refOf({ ...head, revision: head.headRevision, revisionId: head.headRevisionId, contentHash: head.headContentHash }));
        const curatedHead = await catalog?.getVariant(curatedRef.variantId);
        return resolveRef(curatedHead ? { ...curatedRef, revision: curatedHead.headRevision, revisionId: curatedHead.headRevisionId, contentHash: curatedHead.headContentHash } : curatedRef);
    }
    async function runSave(operation, payload, key, work) {
        await cache?.putPendingSave({ idempotencyKey: key, operation, payload, createdAt: now() });
        const result = await port.runTransaction(work);
        await cache?.deletePendingSave(key);
        return result;
    }
    async function createIngredient(payload) {
        assertWrites();
        const { identity, variant, revisionDraft, conversions = [], confirmNew = false } = payload;
        const key = identityKeyV1(identity);
        const identityId = await privateIdentityId(key);
        const overrides = variant.overrides ?? null;
        const variantId = overrides ? await overrideVariantId(overrides.catalogId, overrides.variantId) : await privateVariantId(identityId, variant.dims ?? variant);
        const actualIdentityId = overrides ? revisionDraft.identityId : identityId;
        if (revisionDraft.identityId !== actualIdentityId || revisionDraft.variantId !== variantId || !await verifyRevisionHash(revisionDraft))
            throw new TypeError('Draft identity/hash mismatch');
        if (!confirmNew && !overrides && (await searchPrivate(identity.canonicalName)).items.length)
            throw new NeedsReviewError('Review existing aliases before creating');
        if (conversions.some(c => validateConversion(c).length || !sameRef(c.variantRef,refOf({...revisionDraft,revision:1,revisionId:revisionIdFor(variantId,1)}))))
            throw new TypeError('Invalid conversion');
        const idem = await sha256Hex(ownerUid + '|' + variantId + '|0|' + revisionDraft.contentHash);
        const saved = await runSave('createIngredient', payload, idem, async (tx) => {
            const existingIdentity = overrides ? null : await tx.get(path('identities', identityId));
            const existing = await tx.get(path('variants', variantId));
            if (existingIdentity && existingIdentity.identityKeyV1 !== key)
                throw new IdentityKeyCollisionError('Identity key collision');
            if (existing) {
                if (existing.variantKeyV1 !== variantKeyV1(variant.dims ?? variant) || existing.identityId !== actualIdentityId)
                    throw new IdentityKeyCollisionError('Variant key collision');
                const revision = await tx.get(path('revisions', existing.headRevisionId));
                if (revision?.contentHash === revisionDraft.contentHash && await verifyRevisionHash(revision)) {
                    const committed = await Promise.all(conversions.map(c => tx.get(path('conversions', c.conversionId))));
                    // All reads precede writes; competing creates retry and
                    // atomically add only conversions the winning create lacked.
                    if (conversions.some(c => !sameRef(c.variantRef, refOf(revision))))
                        throw new RevisionConflictError('Conversion profile mismatch');
                    const stamp = port.serverTimestamp();
                    const savedConversions = conversions.map((c, i) => committed[i] ?? { ...c, schemaVersion: 1, ownerUid, createdAt: stamp });
                    for (let i = 0; i < conversions.length; i++)
                        if (!committed[i]) tx.set(path('conversions', conversions[i].conversionId), savedConversions[i]);
                    return { ref: refOf(revision), conversions: savedConversions };
                }
                throw new RevisionConflictError('Ingredient already exists with another profile');
            }
            const oldConversions = await Promise.all(conversions.map(c => tx.get(path('conversions', c.conversionId))));
            if (oldConversions.some(Boolean))
                throw new IdentityKeyCollisionError('Conversion already exists');
            const stamp = port.serverTimestamp();
            if (!overrides && !existingIdentity)
                tx.set(path('identities', identityId), { schemaVersion: 1, ownerUid, identityId, identityKeyV1: key, canonicalName: identity.canonicalName, category: identity.category, kind: identity.kind, aliases: identity.aliases ?? [], searchTokens: buildSearchTokens(identity.canonicalName, identity.aliases), createdAt: stamp, updatedAt: stamp, retiredAt: null });
            const revision = { ...revisionDraft, supersedes: null, ownerUid, revision: 1, revisionId: revisionIdFor(variantId, 1), idempotencyKey: idem, createdAt: stamp };
            tx.set(path('variants', variantId), { schemaVersion: 1, ownerUid, identityId: actualIdentityId, variantId, variantKeyV1: variantKeyV1(variant.dims ?? variant), dims: normalizeVariantDims(variant.dims ?? variant), overrides, headRevision: 1, headRevisionId: revision.revisionId, headContentHash: revision.contentHash, createdAt: stamp, updatedAt: stamp, retiredAt: null });
            tx.set(path('revisions', revision.revisionId), revision);
            for (const c of conversions)
                tx.set(path('conversions', c.conversionId), { ...c, schemaVersion: 1, ownerUid, createdAt: stamp });
            return { ref: refOf(revision), conversions: conversions.map(c => ({ ...c, schemaVersion: 1, ownerUid, createdAt: stamp })) };
        });
        for (const c of saved.conversions)
            await cache?.putConversion(namespace, c);
        return saved.ref;
    }
    async function saveRevision(payload) {
        assertWrites();
        const { variantId, baseRevision, revisionDraft } = payload;
        if (validateRevision(revisionDraft).length || !await verifyRevisionHash(revisionDraft) || revisionDraft.variantId !== variantId || !Number.isSafeInteger(baseRevision) || baseRevision < 1)
            throw new TypeError('Invalid revision draft');
        const idem = await sha256Hex(ownerUid + '|' + variantId + '|' + baseRevision + '|' + revisionDraft.contentHash);
        return runSave('saveRevision', payload, idem, async (tx) => {
            const head = await tx.get(path('variants', variantId));
            if (!head || head.identityId !== revisionDraft.identityId || head.retiredAt)
                throw new RevisionConflictError('Variant missing or retired');
            const old = await tx.get(path('revisions', head.headRevisionId));
            if (head.headRevision !== baseRevision) {
                if (old?.contentHash === revisionDraft.contentHash && old.supersedes?.revision === baseRevision)
                    return refOf(old);
                throw new RevisionConflictError('Revision changed; review saved draft');
            }
            const previousContentHash = old?.contentHash ?? head.headContentHash;
            const previousRevisionId = old?.revisionId ?? head.headRevisionId;
            const n = baseRevision + 1;
            const revision = { ...revisionDraft, ownerUid, revision: n, revisionId: revisionIdFor(variantId, n), supersedes: { revision: baseRevision, revisionId: previousRevisionId, contentHash: previousContentHash }, idempotencyKey: idem, createdAt: port.serverTimestamp() };
            tx.set(path('revisions', revision.revisionId), revision);
            tx.update(path('variants', variantId), { headRevision: n, headRevisionId: revision.revisionId, headContentHash: revision.contentHash, updatedAt: port.serverTimestamp() });
            return refOf(revision);
        });
    }
    async function addConversion(conversion) {
        assertWrites();
        if (validateConversion(conversion).length || conversion.variantRef.scope !== 'private' || conversion.variantRef.namespace !== namespace)
            throw new TypeError('Invalid conversion');
        const saved = await port.runTransaction(async (tx) => {
            const variant = await tx.get(path('variants', conversion.variantRef.variantId));
            const revision = await tx.get(path('revisions', conversion.variantRef.revisionId));
            const old = await tx.get(path('conversions', conversion.conversionId));
            if (!revision || !sameRef(conversion.variantRef,refOf(revision)) || !await verifyRevisionHash(revision)) throw new TypeError('Conversion profile mismatch');
            if (!variant)
                throw new TypeError('Variant missing');
            if (!old)
                tx.set(path('conversions', conversion.conversionId), { ...conversion, schemaVersion: 1, ownerUid, createdAt: port.serverTimestamp() });
            return old ?? { ...conversion, schemaVersion: 1, ownerUid };
        });
        await cache?.putConversion(namespace, saved);
        return saved;
    }
    async function updateMetadata(kind, id, patch) {
        assertWrites();
        const allowed = kind === 'identities' ? ['canonicalName', 'aliases', 'searchTokens', 'retiredAt'] : ['retiredAt'];
        if (Object.keys(patch).some(k => !allowed.includes(k)))
            throw new TypeError('Immutable field');
        return port.runTransaction(async (tx) => { const old = await tx.get(path(kind, id)); if (!old)
            throw new TypeError('Missing record'); tx.update(path(kind, id), { ...patch, updatedAt: port.serverTimestamp() }); });
    }
    return { close: () => cache?.close(), searchPrivate, getIdentity: id => port.getDoc(path('identities', id)), listVariants: identityId => port.queryCollection(prefix + C.variants, { equals: ['identityId', identityId], orderById: true, limit: 25 }), resolveRef, resolveEffectiveProfile, getConversions, createIngredient, saveRevision, addConversion,
        updateIdentity: (id, patch) => updateMetadata('identities', id, patch), retireVariant: id => updateMetadata('variants', id, { retiredAt: port.serverTimestamp() }),
        listPendingSaves: async () => await cache?.listPendingSaves() ?? [],
        retirePendingSave: async (key) => { assertWrites(); await cache?.deletePendingSave(key); },
        retryPendingSave: async (key, replacement) => { assertWrites(); const saved = (await cache?.listPendingSaves())?.find(p => p.idempotencyKey === key); if (!saved)
            throw new TypeError('Missing saved draft'); const result = await (saved.operation === 'createIngredient' ? createIngredient : saveRevision)(replacement ?? saved.payload); await cache?.deletePendingSave(key); return result; },
    };
}
