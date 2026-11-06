import { contentHashOf, canonicalJson } from './contentHash.js';
import { isValidFirestoreDocId } from './ingredientIds.js';
import { NUTRIENT_STATUSES, FIBER_MEANINGS, CARB_CONVENTIONS, V2_KEYS, toV2Fields, readNutrientFields, checkPer100g } from './nutrientRegistry.js';
const HASH_KEYS = ['identityId', 'variantId', 'basis', 'nutrients', 'nutrientMeta', 'fieldProvenance', 'sources', 'basedOn'];
const KEYS = [...HASH_KEYS, 'schemaVersion', 'ownerUid', 'revision', 'revisionId', 'contentHash', 'supersedes', 'idempotencyKey', 'createdAt'];
const hashPayload = doc => Object.fromEntries(HASH_KEYS.map(k => [k, doc[k]]));
export async function buildRevisionDraft({ identityId, variantId, stagedRecord, fieldProvenance = {}, sources = {}, basis, basedOn = null, base = null }) {
    const v2 = toV2Fields(stagedRecord);
    const doc = { schemaVersion: 1, identityId, variantId, basis, nutrients: v2.fields, nutrientMeta: v2.nutrientMeta, fieldProvenance, sources, basedOn,
        supersedes: base ? { revision: base.revision, revisionId: base.revisionId, contentHash: base.contentHash } : null };
    const errors = validateRevision(doc);
    if (errors.length)
        throw new TypeError(errors.join('; '));
    return { ...doc, contentHash: await contentHashOf(hashPayload(doc)) };
}
export function validateRevision(doc) {
    const errors = [];
    if (!doc || typeof doc !== 'object')
        return ['Invalid revision'];
    const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (![doc.nutrients,doc.nutrientMeta,doc.nutrientMeta?.quality,doc.fieldProvenance,doc.sources].every(map)) errors.push('Nutrient maps required');
    if (!isValidFirestoreDocId(doc.identityId) || !isValidFirestoreDocId(doc.variantId))
        errors.push('Invalid identity/variant ID');
    if (Object.keys(doc).some(k => !KEYS.includes(k)))
        errors.push('Unknown revision field');
    if (doc.schemaVersion !== 1 || doc.basis?.kind !== 'per_100g_edible' || typeof doc.basis.state !== 'string' || !doc.basis.state || doc.basis.state.length > 120 || Object.keys(doc.basis).some(k => !['kind', 'state'].includes(k)))
        errors.push('Invalid per-100-g basis');
    if (Object.keys(doc.nutrients ?? {}).some(k => !V2_KEYS.includes(k)) || Object.keys(doc.fieldProvenance ?? {}).some(k => !V2_KEYS.includes(k)) || Object.keys(doc.nutrientMeta?.quality ?? {}).some(k => !V2_KEYS.includes(k)))
        errors.push('Unknown nutrient key');
    if (doc.nutrientMeta?.registryVersion !== 2 || Object.keys(doc.nutrientMeta ?? {}).some(k => !['registryVersion', 'quality', 'fiberMeaning', 'carbConvention'].includes(k)))
        errors.push('Invalid nutrient metadata');
    if ((doc.nutrientMeta?.fiberMeaning !== undefined && !FIBER_MEANINGS.includes(doc.nutrientMeta.fiberMeaning)) ||
        (doc.nutrientMeta?.carbConvention !== undefined && !CARB_CONVENTIONS.includes(doc.nutrientMeta.carbConvention)))
        errors.push('Invalid nutrient conventions');
    const range = value => value == null || (map(value) && Object.keys(value).every(k => ['min', 'max'].includes(k)) &&
        Number.isFinite(value.min) && Number.isFinite(value.max) && value.min >= 0 && value.max >= value.min);
    for (const quality of Object.values(doc.nutrientMeta?.quality ?? {})) {
        if (!map(quality) || !NUTRIENT_STATUSES.includes(quality.status) || Object.keys(quality).some(k => !['status', 'roundingInterval', 'upperBound', 'qualifier'].includes(k)) ||
            ['roundingInterval', 'upperBound'].some(k => quality[k] != null && (!Number.isFinite(quality[k]) || quality[k] < 0)) ||
            (quality.qualifier != null && typeof quality.qualifier !== 'string'))
            errors.push('Invalid nutrient quality');
    }
    if (doc.revision != null && (!Number.isSafeInteger(doc.revision) || doc.revision < 1 || doc.revisionId !== doc.variantId + '~r' + doc.revision))
        errors.push('Invalid revision ID');
    if (doc.supersedes != null && (!Number.isSafeInteger(doc.supersedes.revision) || doc.supersedes.revision < 1 || doc.supersedes.revisionId !== doc.variantId + '~r' + doc.supersedes.revision || !/^sha256:[a-f0-9]{64}$/.test(doc.supersedes.contentHash) || Object.keys(doc.supersedes).some(k => !['revision', 'revisionId', 'contentHash'].includes(k))))
        errors.push('Invalid supersedes');
    for (const provenance of Object.values(doc.fieldProvenance ?? {})) {
        if (!map(provenance) || Object.keys(provenance).some(k => !['sourceKey', 'sourceNutrientId', 'derivation', 'comparatorRef', 'confidence', 'range'].includes(k)) ||
            typeof provenance.sourceKey !== 'string' || !provenance.sourceKey || provenance.sourceKey.length > 200 ||
            ['sourceNutrientId', 'derivation', 'comparatorRef'].some(k => provenance[k] !== undefined && typeof provenance[k] !== 'string') || !range(provenance.range))
            errors.push('Invalid provenance');
        if (provenance?.confidence != null && (!Number.isFinite(provenance.confidence) || provenance.confidence < 0 || provenance.confidence > 1))
            errors.push('Invalid confidence');
    }
    for (const [k, value] of Object.entries(doc.nutrients ?? {})) {
        if (value === null)
            continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || checkPer100g(k, value) === 'reject')
            errors.push('Invalid nutrient: ' + k);
        const status = doc.nutrientMeta?.quality?.[k]?.status;
        if (!['measured', 'label_reported', 'calculated', 'estimated_from_comparable', 'below_quantification_limit', 'not_applicable'].includes(status))
            errors.push('Evidence status required: ' + k);
        const sourceKey = doc.fieldProvenance?.[k]?.sourceKey;
        if (!sourceKey || !doc.sources?.[sourceKey])
            errors.push('Source required: ' + k);
    }
    if (!doc.nutrients || !doc.nutrientMeta || !doc.fieldProvenance || !doc.sources)
        errors.push('Missing nutrient maps');
    for (const source of Object.values(doc.sources ?? {})) {
        if (!map(source) || Object.keys(source).some(k => !['type', 'datasetId', 'recordId', 'title', 'url', 'version', 'publishedAt', 'accessedAt', 'originalBasis', 'permittedUse', 'checksum'].includes(k)) || !['fdc', 'label', 'manufacturer', 'manual', 'comparable', 'legacy_food', 'curated_catalog'].includes(source.type) || Object.entries(source).some(([k, value]) => k !== 'type' && typeof value !== 'string'))
            errors.push('Invalid source');
    }
    try {
        if (canonicalJson(hashPayload(doc)).length > 200000 || Object.keys(doc.sources ?? {}).length > 64)
            errors.push('Revision too large');
    }
    catch {
        errors.push('Invalid JSON');
    }
    return errors;
}
export const revisionToStagedRecord = doc => readNutrientFields({ ...doc.nutrients, nutrientSchemaVersion: 2, nutrientMeta: doc.nutrientMeta });
export async function verifyRevisionHash(doc) {
    try {
        return validateRevision(doc).length === 0 && doc.contentHash === await contentHashOf(hashPayload(doc));
    }
    catch {
        return false;
    }
}
export function legacyFoodAsProfile(foodDoc, foodId, namespace) {
    const staged = readNutrientFields({ ...foodDoc, nutrientSchemaVersion: 1 });
    staged.fiberMeaning = 'unknown';
    for (const k of V2_KEYS)
        if (staged.values[k] !== null)
            staged.quality[k] = { status: 'legacy_unclassified' };
    return { foodId, namespace, basis: { kind: 'legacy_per_unit', state: 'unspecified' }, stagedRecord: staged };
}
