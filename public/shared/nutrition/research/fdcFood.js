import { canonicalJson, sha256Hex } from '../contentHash.js';

export class PermanentSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentSourceError';
  }
}

export const STATE_WORDS = Object.freeze([
  'raw', 'cooked', 'boiled', 'drained', 'undrained', 'canned',
  'dried', 'dry', 'roasted', 'baked', 'fried', 'pan-fried',
  'grilled', 'braised', 'steamed', 'fresh', 'frozen',
  'salted', 'unsalted', 'fortified', 'unfortified'
]);

export function extractStateWords(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9_-]+/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  const found = new Set();
  for (const w of words) {
    if (STATE_WORDS.includes(w)) {
      found.add(w);
    }
  }
  // Check multi-word state phrases
  if (normalized.includes('pan fried') || normalized.includes('pan-fried')) {
    found.add('pan-fried');
  }
  if (normalized.includes('without salt') || normalized.includes('without added salt') || normalized.includes('no added salt')) {
    found.add('unsalted');
  }
  if (normalized.includes('with salt') || normalized.includes('with added salt')) {
    found.add('salted');
  }
  return [...found];
}

function classifyPortionKind(unit, modifier) {
  const text = `${unit || ''} ${modifier || ''}`.toLowerCase();
  const piecePatterns = /\b(piece|slice|item|fruit|berry|cookie|egg|leaf|clove|stalk|spear|fillet|pat|unit|head|sprig|wedge|bar|can|bottle|packet)\b/;
  if (piecePatterns.test(text)) return 'piece';
  return 'household';
}

function normalizePortionUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'portion';
  const u = unit.trim().toLowerCase();
  if (['c', 'cup', 'cups'].includes(u)) return 'cup';
  if (['tbsp', 'tbs', 'tablespoon', 'tablespoons'].includes(u)) return 'tbsp';
  if (['tsp', 'teaspoon', 'teaspoons'].includes(u)) return 'tsp';
  if (['fl oz', 'fluid ounce', 'fluid ounces'].includes(u)) return 'fl oz';
  if (['oz', 'ounce', 'ounces'].includes(u)) return 'oz';
  if (['g', 'gram', 'grams'].includes(u)) return 'g';
  if (['ml', 'milliliter', 'milliliters'].includes(u)) return 'mL';
  return unit.trim();
}

/**
 * Parses raw USDA FoodData Central food record (supports both bulk download shape
 * and API responses).
 *
 * Throws PermanentSourceError on malformed input, non-numeric amounts, or duplicate nutrient IDs.
 */
export async function parseFdcFood(json, { release = 'unknown', accessedAt } = {}) {
  if (!json || typeof json !== 'object') {
    throw new PermanentSourceError('Invalid FDC food: expected JSON object');
  }

  const fdcId = json.fdcId;
  if (typeof fdcId !== 'number' || !Number.isSafeInteger(fdcId) || fdcId <= 0) {
    throw new PermanentSourceError(`Invalid or missing fdcId: ${fdcId}`);
  }

  const description = json.description;
  if (typeof description !== 'string' || !description.trim()) {
    throw new PermanentSourceError(`Invalid or missing description for fdcId ${fdcId}`);
  }

  if (!Array.isArray(json.foodNutrients)) {
    throw new PermanentSourceError(`Invalid or missing foodNutrients array for fdcId ${fdcId}`);
  }

  const seenNutrientIds = new Set();
  const nutrients = [];

  for (const item of json.foodNutrients) {
    if (!item || typeof item !== 'object') {
      throw new PermanentSourceError(`Malformed foodNutrient item in fdcId ${fdcId}`);
    }

    const nutrientId = item.nutrient?.id ?? item.nutrientId;
    if (typeof nutrientId !== 'number' || !Number.isSafeInteger(nutrientId)) {
      throw new PermanentSourceError(`Invalid or missing nutrient ID in fdcId ${fdcId}`);
    }

    if (seenNutrientIds.has(nutrientId)) {
      throw new PermanentSourceError(`Duplicate nutrientId ${nutrientId} in fdcId ${fdcId}`);
    }
    seenNutrientIds.add(nutrientId);

    const rawAmount = item.amount !== undefined ? item.amount : item.value;
    if (rawAmount !== null && rawAmount !== undefined) {
      if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount)) {
        throw new PermanentSourceError(`Non-numeric amount for nutrient ${nutrientId} in fdcId ${fdcId}: ${rawAmount}`);
      }
    }

    const nutrientNumber = item.nutrient?.number ?? item.nutrientNumber ?? '';
    const nutrientName = item.nutrient?.name ?? item.nutrientName ?? '';
    const unitName = item.nutrient?.unitName ?? item.unitName ?? '';

    // LOQ detection: amount 0 with a quantification limit above 0
    let loq = null;
    if (Number.isFinite(Number(item.loq)) && Number(item.loq) > 0) {
      loq = Number(item.loq);
    } else if (Number.isFinite(Number(item.limitOfQuantification)) && Number(item.limitOfQuantification) > 0) {
      loq = Number(item.limitOfQuantification);
    } else if (Array.isArray(item.nutrientAnalysisDetails)) {
      for (const d of item.nutrientAnalysisDetails) {
        if (Number.isFinite(Number(d.loq)) && Number(d.loq) > 0) {
          loq = Number(d.loq);
          break;
        }
        if (Number.isFinite(Number(d.limitOfQuantification)) && Number(d.limitOfQuantification) > 0) {
          loq = Number(d.limitOfQuantification);
          break;
        }
      }
    }

    const derivationCode = item.foodNutrientDerivation?.code || item.derivationCode;
    const isLoq = ((rawAmount === 0 || rawAmount === null || rawAmount === undefined) && loq !== null && loq > 0) ||
      (derivationCode === 'LOQ' && loq !== null && loq > 0);

    nutrients.push({
      nutrientId,
      nutrientNumber: String(nutrientNumber),
      nutrientName: String(nutrientName),
      unitName: String(unitName),
      amount: rawAmount !== null && rawAmount !== undefined ? Number(rawAmount) : null,
      min: Number.isFinite(Number(item.min)) ? Number(item.min) : null,
      max: Number.isFinite(Number(item.max)) ? Number(item.max) : null,
      median: Number.isFinite(Number(item.median)) ? Number(item.median) : null,
      loq,
      isBelowLoq: Boolean(isLoq),
    });
  }

  // Portion parsing
  const portions = [];
  if (Array.isArray(json.foodPortions)) {
    for (const p of json.foodPortions) {
      if (!p || typeof p !== 'object') continue;
      const gramWeight = Number(p.gramWeight);
      if (!Number.isFinite(gramWeight) || gramWeight <= 0) continue;
      const amount = Number.isFinite(Number(p.amount)) && Number(p.amount) > 0 ? Number(p.amount) : 1;
      const unitRaw = p.measureUnit?.name || p.modifier || 'portion';
      const unit = normalizePortionUnit(unitRaw);
      const unitQualifier = p.modifier && p.measureUnit?.name ? String(p.modifier).trim() : undefined;
      const kind = classifyPortionKind(unit, p.modifier);
      portions.push({
        kind,
        unit,
        unitQualifier,
        amount,
        grams: gramWeight,
      });
    }
  }

  const checksum = 'sha256:' + await sha256Hex(canonicalJson(json));
  const dataType = json.dataType || 'Foundation';
  const publishedAt = json.publicationDate || undefined;
  const accessDate = accessedAt || new Date().toISOString().slice(0, 10);

  return {
    type: 'fdc',
    recordId: String(fdcId),
    fdcId,
    dataType,
    title: description.trim(),
    description: description.trim(),
    release: String(release),
    publishedAt,
    accessedAt: accessDate,
    originalBasis: 'per_100g_edible',
    permittedUse: 'CC0 1.0 (re-verify at pin)',
    checksum,
    nutrients,
    portions,
    servingSize: Number.isFinite(Number(json.servingSize)) ? Number(json.servingSize) : null,
    servingSizeUnit: json.servingSizeUnit ? String(json.servingSizeUnit).trim() : null,
    extractedStateWords: extractStateWords(description),
  };
}
