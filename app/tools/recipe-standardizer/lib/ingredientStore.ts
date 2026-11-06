import {INGREDIENT_COLLECTIONS} from '@/public/shared/nutrition/ingredientIds.js';
import { doc, getDoc, runTransaction, collection, getDocs, query, where, orderBy, documentId, startAfter, limit, serverTimestamp, type DocumentReference, type QueryConstraint } from 'firebase/firestore';
import { db } from './firebase';
import { CALORIE_TRACKER_APP_ID } from './namespaces';
import { createIngredientStore } from '@/public/shared/nutrition/ingredientStore.js';
import type { IngredientFirestorePort } from '@/public/shared/nutrition/ingredientPort';
import { openProfileCache } from '@/public/shared/nutrition/profileCache.js';
import { createCuratedCatalogSource } from '@/public/shared/nutrition/ingredientCatalog.js';
const port: IngredientFirestorePort = {
    docRef: path => doc(db, path),
    getDoc: async (ref) => { const snap = await getDoc(ref as DocumentReference); return snap.exists() ? snap.data() : null; },
    runTransaction: fn => runTransaction(db, tx => fn({
        get: async (ref) => { const snap = await tx.get(ref as DocumentReference); return snap.exists() ? snap.data() : null; },
        set: (ref, data) => tx.set(ref as DocumentReference, data), update: (ref, data) => tx.update(ref as DocumentReference, data),
    })),
    queryCollection: async (path, options) => {
        const constraints: QueryConstraint[] = [];
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
export async function createRecipeIngredientStore(uid: string) {
    const cache = await openProfileCache({ ownerUid: uid });
    const catalog = createCuratedCatalogSource();
    await catalog.open().catch(() => { });
    await cache.revalidate(ref => ref.scope === 'private'
        ? port.getDoc(port.docRef(`artifacts/${CALORIE_TRACKER_APP_ID}/users/${uid}/${INGREDIENT_COLLECTIONS.variants}/${ref.variantId}`))
        : catalog.getVariant(ref.variantId));
    return createIngredientStore({ port, namespace: CALORIE_TRACKER_APP_ID, ownerUid: uid, cache, catalog });
}
