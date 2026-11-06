import { parseIngredientRef } from './ingredientRefs.js';
import { conversionIdFor } from './ingredientIds.js';
export function validateConversion(doc) {
    const errors = [];
    const allowed = ['schemaVersion', 'conversionId', 'ownerUid', 'createdAt', 'variantRef', 'kind', 'unit', 'unitQualifier', 'amount', 'grams', 'gramsPerMl', 'state', 'source', 'confidence', 'range', 'supersedes'];
    if (!doc || typeof doc !== 'object')
        return ['Invalid conversion'];
    if (Object.keys(doc).some(k => !allowed.includes(k)))
        errors.push('Unknown conversion field');
    if (!['household', 'density', 'piece', 'package'].includes(doc.kind) || !parseIngredientRef(doc.variantRef) || !doc.unit || !doc.state || !doc.source || !Number.isFinite(doc.amount) || doc.amount <= 0)
        errors.push('Invalid conversion');
    if (doc.kind === 'density' && doc.unit !== 'mL')
        errors.push('Density unit must be mL');
    if (!['fdc', 'label', 'manufacturer', 'manual', 'comparable', 'legacy_food', 'curated_catalog'].includes(doc.source?.type))
        errors.push('Invalid conversion source');
    const value = doc.kind === 'density' ? doc.gramsPerMl : doc.grams;
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(doc.confidence) || doc.confidence < 0 || doc.confidence > 1)
        errors.push('Invalid conversion value');
    if (doc.range && (!Number.isFinite(doc.range.min) || !Number.isFinite(doc.range.max) || doc.range.min < 0 || doc.range.max < doc.range.min))
        errors.push('Invalid range');
    return errors;
}
export async function buildConversion(input) {
    const doc = { schemaVersion: 1, ...input };
    const errors = validateConversion(doc);
    if (errors.length)
        throw new TypeError(errors.join('; '));
    return { ...doc, conversionId: await conversionIdFor(doc) };
}
export function toGrams(quantity, unit, qualifier, conversions, state) {
    if (!Number.isFinite(quantity) || quantity < 0)
        return { error: 'missing_conversion' };
    if (unit === 'g')
        return { grams: quantity, conversionId: null };
    const matches = conversions.filter(c => c.unit === unit && (c.unitQualifier ?? '') === (qualifier ?? '') && !validateConversion(c).length);
    const c = matches.find(c => c.state === state);
    if (!c)
        return { error: matches.length ? 'state_mismatch' : 'missing_conversion' };
    const grams = c.kind === 'density' ? quantity * c.gramsPerMl : quantity * c.grams / c.amount;
    return Number.isFinite(grams) ? {grams,conversionId:c.conversionId} : {error:'missing_conversion'};
}
