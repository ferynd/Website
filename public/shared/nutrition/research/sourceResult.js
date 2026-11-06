import { V2_KEYS, convertUnit } from '../nutrientRegistry.js';
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

export function normalizeSourceResult(result, target = {}) {
  const dims = target.dims || {};
  const requestedFields = target.requestedFields;
  const requestedSet = Array.isArray(requestedFields) ? new Set(requestedFields) : null;

  // Determine scaling factor to per 100g edible weight
  let scale = 1;
  let unitNotConvertible = false;

  if (result.servingSize !== null && result.servingSize !== undefined) {
    const unit = (result.servingSizeUnit || '').trim().toLowerCase();
    if (unit === 'g' || unit === 'gram' || unit === 'grams') {
      if (result.servingSize <= 0) {
        throw new Error('Serving size in grams must be greater than zero');
      }
      scale = 100 / result.servingSize;
    } else if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
      // Per decision D3/D8: A serving given only in mL with no density becomes gap:unit_not_convertible
      unitNotConvertible = true;
    } else {
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
      nutrientMeta: {
        registryVersion: 2,
        quality,
        fiberMeaning: 'total',
        carbConvention: 'includes_fiber',
      },
      fieldProvenance,
      conversions: [],
      gaps,
      flags: ['serving_basis_missing_gram_weight'],
      extractedStateWords: result.extractedStateWords || [],
    };
  }

  const byFdcId = new Map((result.nutrients || []).map(n => [n.nutrientId, n]));

  // Energy preference: 1008, then 2048, then 2047
  const n1008 = byFdcId.get(1008);
  const n2048 = byFdcId.get(2048);
  const n2047 = byFdcId.get(2047);

  if (n1008 && Number.isFinite(n1008.amount)) {
    nutrients.calories = round6(n1008.amount * scale);
    quality.calories = { status: result.dataType === 'Branded' ? 'label_reported' : 'measured' };
    fieldProvenance.calories = { sourceKey, sourceNutrientId: '1008' };
  } else if (n2048 && Number.isFinite(n2048.amount)) {
    nutrients.calories = round6(n2048.amount * scale);
    quality.calories = { status: 'calculated' };
    fieldProvenance.calories = { sourceKey, sourceNutrientId: '2048', derivation: 'atwater_general_factors' };
  } else if (n2047 && Number.isFinite(n2047.amount)) {
    nutrients.calories = round6(n2047.amount * scale);
    quality.calories = { status: 'calculated' };
    fieldProvenance.calories = { sourceKey, sourceNutrientId: '2047', derivation: 'atwater_specific_factors' };
  } else {
    nutrients.calories = null;
    quality.calories = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    gaps.calories = 'not_reported_by_source';
  }

  // Carbs: 1005 with carbConvention: 'includes_fiber'
  const n1005 = byFdcId.get(1005);
  if (n1005 && Number.isFinite(n1005.amount)) {
    nutrients.carbs = round6(n1005.amount * scale);
    quality.carbs = { status: result.dataType === 'Branded' ? 'label_reported' : 'measured' };
    fieldProvenance.carbs = { sourceKey, sourceNutrientId: '1005' };
  } else if (n1005 && n1005.isBelowLoq) {
    nutrients.carbs = null;
    quality.carbs = { status: 'below_quantification_limit', upperBound: round6(n1005.loq * scale) };
    fieldProvenance.carbs = { sourceKey, sourceNutrientId: '1005' };
  } else {
    nutrients.carbs = null;
    quality.carbs = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    gaps.carbs = 'not_reported_by_source';
  }

  // Fiber (D9): 1079 fills fiberTotal and also fiber (derivation: 'same_as:fiberTotal')
  const n1079 = byFdcId.get(1079);
  if (n1079 && Number.isFinite(n1079.amount)) {
    const fiberVal = round6(n1079.amount * scale);
    nutrients.fiberTotal = fiberVal;
    quality.fiberTotal = { status: result.dataType === 'Branded' ? 'label_reported' : 'measured' };
    fieldProvenance.fiberTotal = { sourceKey, sourceNutrientId: '1079' };

    nutrients.fiber = fiberVal;
    quality.fiber = { status: result.dataType === 'Branded' ? 'label_reported' : 'measured' };
    fieldProvenance.fiber = { sourceKey, sourceNutrientId: '1079', derivation: 'same_as:fiberTotal' };
  } else if (n1079 && n1079.isBelowLoq) {
    nutrients.fiberTotal = null;
    quality.fiberTotal = { status: 'below_quantification_limit', upperBound: round6(n1079.loq * scale) };
    fieldProvenance.fiberTotal = { sourceKey, sourceNutrientId: '1079' };

    nutrients.fiber = null;
    quality.fiber = { status: 'below_quantification_limit', upperBound: round6(n1079.loq * scale) };
    fieldProvenance.fiber = { sourceKey, sourceNutrientId: '1079', derivation: 'same_as:fiberTotal' };
  } else {
    nutrients.fiberTotal = null;
    quality.fiberTotal = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    gaps.fiberTotal = 'not_reported_by_source';

    nutrients.fiber = null;
    quality.fiber = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    gaps.fiber = 'not_reported_by_source';
  }

  // fiberWeightedLegacy is always gap:not_computed
  nutrients.fiberWeightedLegacy = null;
  quality.fiberWeightedLegacy = { status: 'unknown', qualifier: 'gap:not_computed' };
  gaps.fiberWeightedLegacy = 'not_computed';

  // Omega-3 total (D10): calculated only when ALA (1404), EPA (1278), DHA (1272) are all present
  const nALA = byFdcId.get(1404);
  const nEPA = byFdcId.get(1278);
  const nDHA = byFdcId.get(1272);

  const hasALA = nALA && Number.isFinite(nALA.amount);
  const hasEPA = nEPA && Number.isFinite(nEPA.amount);
  const hasDHA = nDHA && Number.isFinite(nDHA.amount);

  if (hasALA && hasEPA && hasDHA) {
    const ala = nALA.amount * scale;
    const epa = nEPA.amount * scale;
    const dha = nDHA.amount * scale;
    nutrients.omega3 = round6(ala + epa + dha);
    quality.omega3 = { status: 'calculated' };
    fieldProvenance.omega3 = { sourceKey, derivation: 'sum:ALA+EPA+DHA' };
  } else {
    nutrients.omega3 = null;
    quality.omega3 = { status: 'unknown', qualifier: 'gap:partial_components' };
    gaps.omega3 = 'partial_components';
  }

  // Map remaining mapped entries from FDC_NUTRIENT_ENTRIES
  for (const entry of FDC_NUTRIENT_ENTRIES) {
    if (entry.policy === 'gap') {
      const item = byFdcId.get(entry.fdcNutrientId);
      if (item && nutrients[entry.key] == null) {
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
    if (!item) continue;

    if (item.isBelowLoq) {
      nutrients[entry.key] = null;
      quality[entry.key] = { status: 'below_quantification_limit', upperBound: round6(item.loq * scale) };
      fieldProvenance[entry.key] = { sourceKey, sourceNutrientId: String(entry.fdcNutrientId) };
    } else if (item.amount !== null && item.amount !== undefined && Number.isFinite(item.amount)) {
      const converted = convertUnit(entry.key, item.amount * scale, entry.sourceUnit);
      if (converted.error) {
        nutrients[entry.key] = null;
        quality[entry.key] = { status: 'unknown', qualifier: 'gap:unit_not_convertible' };
        gaps[entry.key] = 'unit_not_convertible';
      } else {
        nutrients[entry.key] = converted.value;
        quality[entry.key] = { status: result.dataType === 'Branded' ? 'label_reported' : 'measured' };
        fieldProvenance[entry.key] = { sourceKey, sourceNutrientId: String(entry.fdcNutrientId) };
      }
    }
  }

  // Guarantee every key in V2_KEYS has a status and value
  for (const key of V2_KEYS) {
    if (requestedSet && !requestedSet.has(key)) {
      nutrients[key] = null;
      quality[key] = { status: 'unknown', qualifier: 'gap:not_requested' };
      gaps[key] = 'not_requested';
      delete fieldProvenance[key];
    } else if (!quality[key]) {
      nutrients[key] = null;
      quality[key] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
      gaps[key] = 'not_reported_by_source';
    }
  }

  // Build portion conversions
  const conversions = [];
  if (Array.isArray(result.portions)) {
    for (const p of result.portions) {
      conversions.push({
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
      });
    }
  }

  return {
    sourceKey,
    sourceRecord,
    sources,
    nutrients,
    nutrientMeta: {
      registryVersion: 2,
      quality,
      fiberMeaning: 'total',
      carbConvention: 'includes_fiber',
    },
    fieldProvenance,
    conversions,
    gaps,
    flags,
    extractedStateWords: result.extractedStateWords || [],
  };
}
