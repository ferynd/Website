import { canonicalJson } from './contentHash.js';
export const VARIANT_ENUMS = Object.freeze({
    drained: ['drained', 'undrained', 'drained_rinsed', 'not_applicable', 'unspecified'],
    salt: ['salted', 'unsalted', 'low_sodium', 'not_applicable', 'unspecified'],
    fortification: ['fortified', 'unfortified', 'not_applicable', 'unspecified'],
});
const text = v => typeof v === 'string' && v.trim() ? v.normalize('NFKC').trim().toLowerCase() : 'unspecified';
export function normalizeVariantDims(raw = {}) {
    const dims = {};
    for (const k of ['state', 'preparation', 'drained', 'salt', 'fortification', 'fortificationDetail', 'sweetening', 'ediblePortion']) {
        dims[k] = text(raw[k]);
        if (VARIANT_ENUMS[k] && !VARIANT_ENUMS[k].includes(dims[k]))
            throw new TypeError('Invalid variant ' + k);
    }
    for (const k of ['fatPercent', 'leanPercent']) {
        dims[k] = raw[k] ?? null;
        if (dims[k] !== null && (!Number.isFinite(dims[k]) || dims[k] < 0 || dims[k] > 100))
            throw new TypeError('Invalid ' + k);
    }
    dims.brand = raw.brand == null ? null : Object.fromEntries(['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote'].map(k => [k, text(raw.brand[k])]));
    return dims;
}
export function compareVariants(req, cand) {
    const a = normalizeVariantDims(req), b = normalizeVariantDims(cand);
    let unspecified = false;
    for (const k of Object.keys(a)) {
        if (canonicalJson(a[k]) === canonicalJson(b[k]))
            continue;
        if (a[k] === null || b[k] === null || a[k] === 'unspecified' || b[k] === 'unspecified')
            unspecified = true;
        else
            return 'conflict';
    }
    return unspecified ? 'underspecified' : 'exact';
}
