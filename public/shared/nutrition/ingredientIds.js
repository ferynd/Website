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
export const searchWords = text => normalizeIdentityName(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => word.slice(0, 80));
export function buildSearchTokens(name, aliases = []) {
    if (aliases.length > 32)
        throw new TypeError('At most 32 aliases can be indexed');
    const names = [name, ...aliases.map(a => typeof a === 'string' ? a : a.text)].map(searchWords);
    if (names.some(words => !words.length))
        throw new TypeError('Each name and alias needs a searchable word');
    // Reserve a full first word for every name/alias before optional words and
    // prefixes. With at most 32 aliases these mandatory tokens always fit.
    const tokens = new Set(names.map(words => words[0]));
    const add = token => { if (tokens.size < 64) tokens.add(token); };
    for (const word of names.flat()) add(word);
    for (const word of names.flat())
        for (let n = 2; n <= Math.min(8, word.length); n++) add(word.slice(0, n));
    return [...tokens];
}
