import { PROFILE_FIELDS as V2_KEYS } from './profileFields.js';
import { CARB_CONVENTIONS, FIBER_MEANINGS, convertUnit } from '../nutrientRegistry.js';
import { FDC_NUTRIENT_ENTRIES } from './fdcNutrientMap.js';
export const GAP_REASONS = Object.freeze([
    'not_reported_by_source',
    'not_requested',
    'definition_mismatch',
    'unit_not_convertible',
    'partial_components',
    'not_computed',
    'requires_label',
    'requires_composition',
    'source_unavailable',
]);
const round6 = n => Math.round(n * 1e6) / 1e6;
/**
 * A first pass and a full-field residual pass take the normalizer's conventions.
 * A field-limited residual pass keeps the base revision's conventions unless the
 * source explicitly overrides one of them.
 */
export function applyStagedConventions(stagedRecord, conventions = {}, { base = null, requested = null, explicit = {} } = {}) {
    const fullPass = !base || requested == null || requested === '*';
    if ((fullPass || explicit.fiberMeaning) && conventions.fiberMeaning && conventions.fiberMeaning !== 'unknown')
        stagedRecord.fiberMeaning = conventions.fiberMeaning;
    if ((fullPass || explicit.carbConvention) && conventions.carbConvention && conventions.carbConvention !== 'unknown')
        stagedRecord.carbConvention = conventions.carbConvention;
    return stagedRecord;
}
// Derivation-code quality policy (issue #215 ANSWER Q-004, decided under
// James's delegation): a USDA value is measured only when its derivation
// code says analytical (A). NC is calculated, Z is assumed_zero (numeric 0
// kept), and every other code, or no code, is source_reported: a real source
// value whose determination method this software does not classify. Branded
// rows keep label_reported. The raw code travels in field provenance as
// sourceDerivationCode so the classification stays auditable.
export function fdcQualityStatus(item, dataType) {
    if (dataType === 'Branded')
        return 'label_reported';
    switch (item?.derivationCode) {
        case 'A': return 'measured';
        case 'NC': return 'calculated';
        case 'Z': return 'assumed_zero';
        default: return 'source_reported';
    }
}
function withDerivationCode(provenance, item) {
    if (item?.derivationCode)
        provenance.sourceDerivationCode = item.derivationCode;
    return provenance;
}
function conventionFields(result, quality) {
    const explicitFiber = FIBER_MEANINGS.includes(result.fiberMeaning) && result.fiberMeaning !== 'unknown';
    const explicitCarb = CARB_CONVENTIONS.includes(result.carbConvention) && result.carbConvention !== 'unknown';
    return {
        nutrientMeta: {
            registryVersion: 2,
            quality,
            fiberMeaning: explicitFiber ? result.fiberMeaning : 'total',
            carbConvention: explicitCarb ? result.carbConvention : 'includes_fiber',
        },
        conventionOverrides: { fiberMeaning: explicitFiber, carbConvention: explicitCarb },
    };
}
export function normalizeSourceResult(result, target = {}) {
    const dims = target.dims || {};
    const requestedFields = target.requestedFields;
    const requestedSet = Array.isArray(requestedFields) ? new Set(requestedFields) : null;
    // Determine scaling factor to per 100g edible weight
    let scale = 1;
    let unitNotConvertible = false;
    if (result.originalBasis !== 'per_100g_edible' && result.servingSize !== null && result.servingSize !== undefined) {
        const unit = (result.servingSizeUnit || '').trim().toLowerCase();
        if (unit === 'g' || unit === 'gram' || unit === 'grams') {
            if (result.servingSize <= 0) {
                throw new Error('Serving size in grams must be greater than zero');
            }
            scale = 100 / result.servingSize;
        }
        else if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
            // Per decision D3/D8: A serving given only in mL with no density becomes gap:unit_not_convertible
            unitNotConvertible = true;
        }
        else {
            unitNotConvertible = true;
        }
    }
    const sourceKey = result.sourceKey || (result.type === 'fdc' ? `fdc:${result.recordId}` : result.type || 'source');
    const sourceRecord = {
        type: result.type || 'fdc',
        datasetId: result.dataType || result.datasetId || 'Foundation',
        recordId: String(result.recordId),
        title: result.title || result.description || '',
        url: result.url || (result.type === 'fdc' ? `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${result.recordId}/nutrients` : undefined),
        version: String(result.release || result.version || 'unknown'),
        publishedAt: result.publishedAt ? String(result.publishedAt) : undefined,
        accessedAt: result.accessedAt ? String(result.accessedAt) : new Date().toISOString().slice(0, 10),
        originalBasis: result.originalBasis || (scale === 1 ? 'per_100g_edible' : `per_serving_${result.servingSize}g`),
        permittedUse: result.permittedUse || (result.type === 'fdc' ? 'CC0 1.0 (re-verify at pin)' : 'permitted_review'),
        checksum: result.checksum || 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    Object.assign(sourceRecord, result.sourceRecord || {});
    for (const k of Object.keys(sourceRecord))
        if (sourceRecord[k] === undefined)
            delete sourceRecord[k];
    const sources = { [sourceKey]: sourceRecord };
    const nutrients = {};
    const quality = {};
    const fieldProvenance = {};
    const gaps = {};
    const flags = [];
    if (unitNotConvertible) {
        for (const key of V2_KEYS) {
            nutrients[key] = null;
            quality[key] = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
            gaps[key] = 'unit_not_convertible';
        }
        return {
            sourceKey,
            sourceRecord,
            sources,
            nutrients,
            ...conventionFields(result, quality),
            fieldProvenance,
            conversions: [],
            gaps,
            flags: ['serving_basis_missing_gram_weight'],
            extractedStateWords: result.extractedStateWords || [],
        };
    }
    const byFdcId = new Map((result.nutrients || []).map(n => [n.nutrientId, n]));
    // Energy preference: 1008, then 2048 (Atwater specific), then 2047 (Atwater general).
    const n1008 = byFdcId.get(1008);
    const n2048 = byFdcId.get(2048);
    const n2047 = byFdcId.get(2047);
    if (n1008 && Number.isFinite(n1008.amount) && !n1008.isBelowLoq) {
        nutrients.calories = round6(n1008.amount * scale);
        quality.calories = { status: fdcQualityStatus(n1008, result.dataType) };
        fieldProvenance.calories = withDerivationCode({ sourceKey, sourceNutrientId: '1008' }, n1008);
    }
    else if (n2048 && Number.isFinite(n2048.amount) && !n2048.isBelowLoq) {
        nutrients.calories = round6(n2048.amount * scale);
        quality.calories = { status: 'calculated' };
        fieldProvenance.calories = withDerivationCode({ sourceKey, sourceNutrientId: '2048', derivation: 'atwater_specific_factors' }, n2048);
    }
    else if (n2047 && Number.isFinite(n2047.amount) && !n2047.isBelowLoq) {
        nutrients.calories = round6(n2047.amount * scale);
        quality.calories = { status: 'calculated' };
        fieldProvenance.calories = withDerivationCode({ sourceKey, sourceNutrientId: '2047', derivation: 'atwater_general_factors' }, n2047);
    }
    else {
        nutrients.calories = null;
        quality.calories = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
        gaps.calories = 'not_reported_by_source';
    }
    // Carbs: 1005 with carbConvention: 'includes_fiber'
    const n1005 = byFdcId.get(1005);
    if (n1005 && Number.isFinite(n1005.amount)) {
        nutrients.carbs = round6(n1005.amount * scale);
        quality.carbs = { status: fdcQualityStatus(n1005, result.dataType) };
        fieldProvenance.carbs = withDerivationCode({ sourceKey, sourceNutrientId: '1005' }, n1005);
    }
    else if (n1005 && n1005.isBelowLoq) {
        nutrients.carbs = null;
        quality.carbs = { status: 'below_quantification_limit', upperBound: round6(n1005.loq * scale) };
        fieldProvenance.carbs = { sourceKey, sourceNutrientId: '1005' };
    }
    else {
        nutrients.carbs = null;
        quality.carbs = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
        gaps.carbs = 'not_reported_by_source';
    }
    // Fiber (D9): 1079 fills fiberTotal and also fiber (derivation: 'same_as:fiberTotal')
    const n1079 = byFdcId.get(1079);
    if (n1079 && Number.isFinite(n1079.amount)) {
        const fiberVal = round6(n1079.amount * scale);
        nutrients.fiberTotal = fiberVal;
        quality.fiberTotal = { status: fdcQualityStatus(n1079, result.dataType) };
        fieldProvenance.fiberTotal = withDerivationCode({ sourceKey, sourceNutrientId: '1079' }, n1079);
        nutrients.fiber = fiberVal;
        quality.fiber = { status: fdcQualityStatus(n1079, result.dataType) };
        fieldProvenance.fiber = withDerivationCode({ sourceKey, sourceNutrientId: '1079', derivation: 'same_as:fiberTotal' }, n1079);
    }
    else if (n1079 && n1079.isBelowLoq) {
        nutrients.fiberTotal = null;
        quality.fiberTotal = { status: 'below_quantification_limit', upperBound: round6(n1079.loq * scale) };
        fieldProvenance.fiberTotal = { sourceKey, sourceNutrientId: '1079' };
        nutrients.fiber = null;
        quality.fiber = { status: 'below_quantification_limit', upperBound: round6(n1079.loq * scale) };
        fieldProvenance.fiber = { sourceKey, sourceNutrientId: '1079', derivation: 'same_as:fiberTotal' };
    }
    else {
        nutrients.fiberTotal = null;
        quality.fiberTotal = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
        gaps.fiberTotal = 'not_reported_by_source';
        nutrients.fiber = null;
        quality.fiber = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
        gaps.fiber = 'not_reported_by_source';
    }
    // Omega-3 total (D10): calculated only when ALA (1404), EPA (1278), DHA (1272) are all present
    const nALA = byFdcId.get(1404);
    const nEPA = byFdcId.get(1278);
    const nDHA = byFdcId.get(1272);
    const hasALA = nALA && Number.isFinite(nALA.amount) && !nALA.isBelowLoq;
    const hasEPA = nEPA && Number.isFinite(nEPA.amount) && !nEPA.isBelowLoq;
    const hasDHA = nDHA && Number.isFinite(nDHA.amount) && !nDHA.isBelowLoq;
    if (hasALA && hasEPA && hasDHA) {
        const ala = nALA.amount * scale;
        const epa = nEPA.amount * scale;
        const dha = nDHA.amount * scale;
        nutrients.omega3 = round6(ala + epa + dha);
        quality.omega3 = { status: 'calculated' };
        fieldProvenance.omega3 = { sourceKey, derivation: 'sum:ALA+EPA+DHA' };
    }
    else {
        nutrients.omega3 = null;
        quality.omega3 = { status: 'unknown', qualifier: 'gap:partial_components' };
        gaps.omega3 = 'partial_components';
    }
    // Map remaining mapped entries from FDC_NUTRIENT_ENTRIES. When two exact
    // rows map to one key (sugarsTotal: 2000, then Foundation's 1063), the first
    // quantified row wins; a below-LOQ row is used only when none is quantified
    // (the energy rule).
    const filledByExact = new Set();
    const quantifiedRow = item => !!item && Number.isFinite(item.amount) && !item.isBelowLoq;
    const otherQuantified = (entry, item) => FDC_NUTRIENT_ENTRIES.some(e => e.policy !== 'gap' && e.key === entry.key && e !== entry && quantifiedRow(byFdcId.get(e.fdcNutrientId)) && byFdcId.get(e.fdcNutrientId) !== item);
    for (const entry of FDC_NUTRIENT_ENTRIES) {
        if (entry.policy === 'gap') {
            const item = byFdcId.get(entry.fdcNutrientId);
            // A mismatch row fills a key only when that key has no status yet.
            // An exact limit of quantification (null value, real status) must stay.
            if (item && !quality[entry.key]?.status) {
                nutrients[entry.key] = null;
                quality[entry.key] = { status: 'unknown', qualifier: `gap:${entry.gapReason}` };
                gaps[entry.key] = entry.gapReason;
                flags.push(`definition_mismatch:${entry.key}:${entry.fdcNutrientId}`);
            }
            continue;
        }
        // Skip specifically handled keys
        if (['calories', 'carbs', 'fiber', 'fiberTotal', 'fiberWeightedLegacy', 'omega3'].includes(entry.key)) {
            continue;
        }
        const item = byFdcId.get(entry.fdcNutrientId);
        if (!item || filledByExact.has(entry.key) || (item.isBelowLoq && otherQuantified(entry, item)))
            continue;
        if (item.isBelowLoq || (item.amount !== null && item.amount !== undefined && Number.isFinite(item.amount)))
            filledByExact.add(entry.key);
        if (item.isBelowLoq) {
            nutrients[entry.key] = null;
            quality[entry.key] = { status: 'below_quantification_limit', upperBound: convertUnit(entry.key, item.loq * scale, item.unitName || entry.sourceUnit).value };
            if (quality[entry.key].upperBound === undefined) {
                quality[entry.key] = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
                gaps[entry.key] = 'unit_not_convertible';
            }
            else
                fieldProvenance[entry.key] = { sourceKey, sourceNutrientId: String(entry.fdcNutrientId) };
        }
        else if (item.amount !== null && item.amount !== undefined && Number.isFinite(item.amount)) {
            const converted = convertUnit(entry.key, item.amount * scale, item.unitName || entry.sourceUnit);
            if (converted.error) {
                nutrients[entry.key] = null;
                quality[entry.key] = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
                gaps[entry.key] = 'unit_not_convertible';
            }
            else {
                nutrients[entry.key] = converted.value;
                quality[entry.key] = { status: fdcQualityStatus(item, result.dataType) };
                fieldProvenance[entry.key] = withDerivationCode({ sourceKey, sourceNutrientId: String(entry.fdcNutrientId) }, item);
            }
        }
    }
    // Apply a single unit/LOQ policy to the special energy, carbohydrate and fiber mappings.
    function setFdc(key, item, fallbackUnit) {
        if (!item)
            return;
        const fromUnit = item.unitName || fallbackUnit;
        const raw = item.isBelowLoq ? item.loq : item.amount;
        if (raw === null || raw === undefined)
            return;
        const converted = convertUnit(key, raw * scale, fromUnit);
        if (converted.error) {
            nutrients[key] = null;
            quality[key] = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
            gaps[key] = 'unit_not_convertible';
            delete fieldProvenance[key];
            return;
        }
        nutrients[key] = item.isBelowLoq ? null : converted.value;
        quality[key] = item.isBelowLoq ? { status: 'below_quantification_limit', upperBound: converted.value } : { status: fdcQualityStatus(item, result.dataType) };
        fieldProvenance[key] = withDerivationCode({ sourceKey, sourceNutrientId: String(item.nutrientId) }, item);
        if (key === 'calories' && !item.isBelowLoq && [2047, 2048].includes(item.nutrientId)) {
            quality[key].status = 'calculated';
            fieldProvenance[key].derivation = item.nutrientId === 2048 ? 'atwater_specific_factors' : 'atwater_general_factors';
        }
        delete gaps[key];
    }
    // Preference order is 1008, 2048, then 2047. A below-LOQ row is only
    // the energy value when none of those ids has a finite quantified amount.
    const quantifiedEnergy = item => item && Number.isFinite(item.amount) && !item.isBelowLoq;
    const energy = [n1008, n2048, n2047].find(quantifiedEnergy)
        || [n1008, n2048, n2047].find(item => item && item.isBelowLoq);
    setFdc('calories', energy, 'kcal');
    setFdc('carbs', byFdcId.get(1005), 'g');
    setFdc('fiberTotal', byFdcId.get(1079), 'g');
    setFdc('fiber', byFdcId.get(1079), 'g');
    if (fieldProvenance.fiber)
        fieldProvenance.fiber.derivation = 'same_as:fiberTotal';
    if (hasALA && hasEPA && hasDHA) {
        const values = [nALA, nEPA, nDHA].map(n => convertUnit('omega3', n.amount * scale, n.unitName || 'g'));
        if (values.some(v => v.error)) {
            nutrients.omega3 = null;
            quality.omega3 = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
            delete fieldProvenance.omega3;
        }
        else
            nutrients.omega3 = round6(values.reduce((sum, n) => sum + n.value, 0));
    }
    // Registry-key observations from manual/label adapters are already interpreted.
    for (const item of result.nutrients || []) {
        if (!item.key || !V2_KEYS.includes(item.key))
            continue;
        const key = item.key;
        const convert = amount => {
            if (!Number.isFinite(amount) || amount < 0)
                throw new TypeError(`Invalid observation bound/value: ${key}`);
            const converted = convertUnit(key, amount * scale, item.unit);
            if (converted.error)
                throw new TypeError(`Unconvertible unit: ${key}`);
            return converted.value;
        };
        const value = item.amount == null ? null : convert(item.amount);
        const reason = typeof item.reason === 'string' ? item.reason.replace(/^gap:/, '') : '';
        const qualifier = item.qualifier
            || (reason ? (String(item.reason).startsWith('gap:') ? item.reason : 'gap:' + reason) : '')
            || (item.status === 'below_quantification_limit' ? 'below_quantification_limit' : '')
            || (value === null && (!item.status || item.status === 'unknown') ? 'gap:not_reported_by_source' : '');
        nutrients[key] = value;
        quality[key] = { status: item.status, ...(item.roundingInterval !== undefined ? { roundingInterval: convert(item.roundingInterval) } : {}), ...(item.upperBound !== undefined ? { upperBound: convert(item.upperBound) } : {}), ...(qualifier ? { qualifier } : {}) };
        fieldProvenance[key] = { sourceKey, ...(item.derivation ? { derivation: item.derivation } : {}), ...(item.comparatorRef ? { comparatorRef: item.comparatorRef } : {}), ...(item.range ? { range: { min: convert(item.range.min), max: convert(item.range.max) } } : {}) };
        // A reported value or a real limit of quantification replaces the placeholder gap.
        const openGap = value === null && item.status !== 'below_quantification_limit' && item.status !== 'not_applicable';
        if (openGap)
            gaps[key] = reason || 'not_reported_by_source';
        else
            delete gaps[key];
    }
    // Guarantee every key in V2_KEYS has a status and value
    for (const key of V2_KEYS) {
        if (requestedSet && !requestedSet.has(key)) {
            nutrients[key] = null;
            quality[key] = { status: 'unknown', qualifier: 'gap:not_requested' };
            gaps[key] = 'not_requested';
            delete fieldProvenance[key];
        }
        else if (!quality[key]) {
            nutrients[key] = null;
            quality[key] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
            gaps[key] = 'not_reported_by_source';
        }
    }
    // Build portion conversions
    const conversions = [];
    if (Array.isArray(result.portions)) {
        for (const p of result.portions) {
            const portion = {
                schemaVersion: 1,
                variantRef: target.variantRef || undefined,
                kind: p.kind,
                unit: p.unit,
                unitQualifier: p.unitQualifier || undefined,
                amount: p.amount,
                grams: p.grams,
                state: dims.state || 'unspecified',
                source: sourceRecord,
                confidence: 1,
            };
            if (p.range && Number.isFinite(p.range.min) && Number.isFinite(p.range.max))
                portion.range = { min: p.range.min, max: p.range.max };
            conversions.push(portion);
        }
    }
    return {
        sourceKey,
        sourceRecord,
        sources,
        nutrients,
        ...conventionFields(result, quality),
        fieldProvenance,
        conversions,
        gaps,
        flags,
        extractedStateWords: result.extractedStateWords || [],
    };
}
