import { isValidFirestoreDocId, revisionIdFor, CURATED_CATALOG_ID } from './ingredientIds.js';
export function parseIngredientRef(raw, path = 'ingredientRef', warnings = []) {
    const valid = raw && raw.refVersion === 1 && ['private', 'curated'].includes(raw.scope)
        && typeof raw.namespace === 'string' && raw.namespace.length > 0
        && (raw.scope !== 'curated' || raw.namespace === 'catalog:' + CURATED_CATALOG_ID)
        && (raw.scope !== 'curated' || (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.identityId) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.variantId)))
        && (raw.scope !== 'private' || (/^(pv|ov)-[a-f0-9]{20}$/.test(raw.variantId) && (raw.variantId.startsWith('ov-') ? /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.identityId) : /^pi-[a-f0-9]{20}$/.test(raw.identityId))))
        && isValidFirestoreDocId(raw.identityId) && isValidFirestoreDocId(raw.variantId)
        && Number.isSafeInteger(raw.revision) && raw.revision >= 1
        && raw.revisionId === revisionIdFor(raw.variantId, raw.revision)
        && /^sha256:[a-f0-9]{64}$/.test(raw.contentHash);
    if (!valid) {
        warnings.push(path + ' is invalid — profile needs review.');
        return null;
    }
    return Object.fromEntries(['refVersion', 'scope', 'namespace', 'identityId', 'variantId', 'revision', 'revisionId', 'contentHash'].map(k => [k, raw[k]]));
}
export const refCacheKey = ref => ref.namespace + '|' + ref.variantId + '|' + ref.revision;
export const sameRef = (a, b) => !!a && !!b && refCacheKey(a) === refCacheKey(b) && a.refVersion === b.refVersion && a.revisionId === b.revisionId && a.contentHash === b.contentHash && a.identityId === b.identityId && a.scope === b.scope;
