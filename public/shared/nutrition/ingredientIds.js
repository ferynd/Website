import { canonicalJson, sha256Hex } from './contentHash.js';
import { normalizeVariantDims } from './ingredientVariants.js';
export const INGREDIENT_COLLECTIONS = Object.freeze({ identities: 'ingredientIdentities', variants: 'ingredientVariants', revisions: 'ingredientRevisions', conversions: 'ingredientConversions' });
export const CURATED_CATALOG_ID = 'nutrition-curated';
export const normalizeIdentityName = name => String(name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const identityKeyV1 = ({ canonicalName, category, kind }) => 'v1|' + normalizeIdentityName(canonicalName) + '|' + category + '|' + kind;
export const variantKeyV1 = dims => canonicalJson(normalizeVariantDims(dims));
const shortId = async (prefix, text) => prefix + (await sha256Hex(text)).slice(0, 20);
export const privateIdentityId = identity => shortId('pi-', typeof identity === 'string' ? identity : identityKeyV1(identity));
export const privateVariantId = (identityId, dims) => shortId('pv-', identityId + '|' + variantKeyV1(dims));
export const overrideVariantId = (catalogId, variantId) => shortId('ov-', catalogId + '|' + variantId);
export function revisionIdFor(variantId, n) {
    if (!isValidFirestoreDocId(variantId) || !Number.isSafeInteger(n) || n < 1)
        throw new TypeError('Invalid revision');
    return variantId + '~r' + n;
}
export const conversionIdFor = content => shortId('pc-', canonicalJson(content));
export const isValidFirestoreDocId = id => typeof id === 'string' && id.length > 0 && new TextEncoder().encode(id).length <= 1500 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
export function buildSearchTokens(name, aliases = []) {
    const tokens = new Set();
    for (const word of [name, ...aliases.map(a => typeof a === 'string' ? a : a.text)].flatMap(s => normalizeIdentityName(s).split(/[^\p{L}\p{N}]+/u)).filter(Boolean)) {
        tokens.add(word.slice(0, 80));
        for (let n = 2; n <= Math.min(8, word.length); n++)
            tokens.add(word.slice(0, n));
    }
    return [...tokens].slice(0, 64);
}
