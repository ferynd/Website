import {INGREDIENT_COLLECTIONS} from '../../../shared/nutrition/ingredientIds.js';
import { doc, getDoc, runTransaction, collection, getDocs, query, where, orderBy, documentId, startAfter, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db } from './firebase.js';
import { state } from '../state/store.js';
import { appId } from '../config.js';
import { createIngredientStore } from '../../../shared/nutrition/ingredientStore.js';
import { openProfileCache } from '../../../shared/nutrition/profileCache.js';
import { createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
const port = {
    docRef: path => doc(db, path),
    getDoc: async (ref) => { const snap = await getDoc(ref); return snap.exists() ? snap.data() : null; },
    runTransaction: fn => runTransaction(db, tx => fn({
        get: async (ref) => { const snap = await tx.get(ref); return snap.exists() ? snap.data() : null; },
        set: (ref, data) => tx.set(ref, data), update: (ref, data) => tx.update(ref, data),
    })),
    queryCollection: async (path, options) => {
        const constraints = [];
        if (options.arrayContains)
            constraints.push(where(options.arrayContains[0], 'array-contains', options.arrayContains[1]));
        if (options.equals)
            constraints.push(where(options.equals[0], '==', options.equals[1]));
        if (options.orderById)
            constraints.push(orderBy(documentId()));
        if (options.startAfterId)
            constraints.push(startAfter(options.startAfterId));
        constraints.push(limit(options.limit));
        const snap = await getDocs(query(collection(db, path), ...constraints));
        return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    }, serverTimestamp,
};
export async function getIngredientStore() {
    const ownerUid = state.userId;
    if (!ownerUid)
        throw new Error('Sign in to read ingredient profiles');
    const cache = await openProfileCache({ ownerUid });
    const catalog = createCuratedCatalogSource();
    await catalog.open().catch(() => { });
    await cache.revalidate(ref => ref.scope === 'private'
        ? port.getDoc(port.docRef(`artifacts/${appId}/users/${ownerUid}/${INGREDIENT_COLLECTIONS.variants}/${ref.variantId}`))
        : catalog.getVariant(ref.variantId));
    return createIngredientStore({ port, namespace: appId, ownerUid, cache, catalog });
}
