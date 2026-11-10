/**
 * #77 lossless-conversion analysis for flat v1 saved foods. Pure logic: no file,
 * network, or Firestore access. The CLI (conversionAnalysisCli.ts) reads a
 * foods-only extract kept outside the checkout and prints only `summarizeConversion()`.
 *
 * Conversion means the "direct profile" conversion: the food keeps its stored
 * serving basis. It is not decomposed into ingredients and is not given a
 * per-100 g basis. No stored value is lost, and no zero is invented.
 */
import {
  LEGACY_V1_KEYS,
  V2_DETAIL_KEYS,
  RESERVED_DOC_FIELDS,
  readNutrientFields,
  toV2Fields,
} from '../../public/shared/nutrition/nutrientRegistry.js';

export const REASON_CODES = [
  'missing_name',
  'missing_key',
  'null_value',
  'non_numeric_value',
  'negative_value',
  'extra_field',
  'v2_collision',
  'already_v2',
  'round_trip_mismatch',
  'invented_detail',
  'meta_mismatch',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const BASIS_CLASSES = ['weight_stated', 'count_unit_stated', 'other_basis_stated', 'no_explicit_basis'] as const;
export type BasisClass = (typeof BASIS_CLASSES)[number];

export type Verdict =
  | { status: 'clean'; reasons: []; roundTrip: RoundTrip }
  | { status: 'blocked'; reasons: ReasonCode[]; roundTrip: RoundTrip | null };

/** Per-food round-trip counts. Counts only; no stored value is kept. */
export type RoundTrip = {
  legacyIdentical: number;
  detailNull: number;
  detailNonNull: number;
  fiberMeaningSet: boolean;
  carbConventionSet: boolean;
};

/** The two site functions the round trip runs through. Injectable only so tests can prove the check bites. */
export type ConversionCodec = {
  readNutrientFields: typeof readNutrientFields;
  toV2Fields: typeof toV2Fields;
};

export const SITE_CODEC: ConversionCodec = { readNutrientFields, toV2Fields };

const LEGACY = new Set<string>(LEGACY_V1_KEYS);
const DETAIL = new Set<string>(V2_DETAIL_KEYS);
const RESERVED = new Set<string>(RESERVED_DOC_FIELDS);

type Doc = Record<string, unknown>;

const has = (doc: Doc, key: string): boolean => Object.prototype.hasOwnProperty.call(doc, key);

function isPlainObject(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A document is v2 when it declares nutrientSchemaVersion 2 or later. Anything else is v1. */
export function schemaVersionOf(doc: Doc): 1 | 2 {
  const version = Number(doc.nutrientSchemaVersion);
  return Number.isFinite(version) && version >= 2 ? 2 : 1;
}

function roundTrip(doc: Doc, codec: ConversionCodec): { trip: RoundTrip; reasons: ReasonCode[] } {
  const reasons = new Set<ReasonCode>();
  const record = codec.readNutrientFields(doc);
  const converted = codec.toV2Fields(record);
  const back = codec.readNutrientFields({
    ...converted.fields,
    nutrientSchemaVersion: converted.nutrientSchemaVersion,
    nutrientMeta: converted.nutrientMeta,
  });
  const fields = converted.fields as Record<string, unknown>;
  const backValues = back.values as Record<string, unknown>;
  const quality = (converted.nutrientMeta?.quality ?? {}) as Record<string, { status?: unknown } | undefined>;

  let legacyIdentical = 0;
  for (const key of LEGACY_V1_KEYS) {
    const stored = doc[key];
    if (Object.is(fields[key], stored) && Object.is(backValues[key], stored)) legacyIdentical += 1;
    else reasons.add('round_trip_mismatch');
    if (quality[key]?.status !== 'legacy_unclassified') reasons.add('meta_mismatch');
  }

  let detailNull = 0;
  let detailNonNull = 0;
  for (const key of V2_DETAIL_KEYS) {
    if (fields[key] === null && backValues[key] === null) detailNull += 1;
    else {
      detailNonNull += 1;
      reasons.add('invented_detail');
    }
    // A converted detail key carries no quality claim: unknown is the absence of one.
    if (quality[key] !== undefined) reasons.add('invented_detail');
  }

  const meta = converted.nutrientMeta as Record<string, unknown> | undefined;
  const fiberMeaningSet = meta !== undefined && has(meta, 'fiberMeaning');
  const carbConventionSet = meta !== undefined && has(meta, 'carbConvention');
  if (fiberMeaningSet || carbConventionSet) reasons.add('meta_mismatch');
  if (converted.nutrientSchemaVersion !== 2) reasons.add('meta_mismatch');

  return {
    trip: { legacyIdentical, detailNull, detailNonNull, fiberMeaningSet, carbConventionSet },
    reasons: [...reasons],
  };
}

/** Per-food verdict: clean (converts losslessly) or blocked with stable reason codes. */
export function conversionVerdict(doc: Doc, codec: ConversionCodec = SITE_CODEC): Verdict {
  const reasons = new Set<ReasonCode>();

  if (typeof doc.name !== 'string' || doc.name.trim() === '') reasons.add('missing_name');

  let valuesValid = true;
  for (const key of LEGACY_V1_KEYS) {
    if (!has(doc, key) || doc[key] === undefined) {
      reasons.add('missing_key');
      valuesValid = false;
      continue;
    }
    const value = doc[key];
    if (value === null) reasons.add('null_value');
    else if (typeof value !== 'number' || !Number.isFinite(value)) reasons.add('non_numeric_value');
    else if (value < 0) reasons.add('negative_value');
    else continue;
    valuesValid = false;
  }

  for (const key of Object.keys(doc)) {
    if (DETAIL.has(key) || key === 'nutrientMeta') reasons.add('v2_collision');
    else if (!LEGACY.has(key) && !RESERVED.has(key)) reasons.add('extra_field');
  }
  if (schemaVersionOf(doc) === 2) reasons.add('already_v2');

  let trip: RoundTrip | null = null;
  if (valuesValid && schemaVersionOf(doc) === 1) {
    const result = roundTrip(doc, codec);
    trip = result.trip;
    for (const reason of result.reasons) reasons.add(reason);
  }

  if (reasons.size === 0 && trip) return { status: 'clean', reasons: [], roundTrip: trip };
  return { status: 'blocked', reasons: REASON_CODES.filter(code => reasons.has(code)), roundTrip: trip };
}

const WEIGHT = /\d+(?:\.\d+)?\s*(?:g|oz|ml)\b/i;
const WEIGHT_TRAILING = /\d+(?:\.\d+)?\s*(?:g|oz|ml)$/i;
const UNIT_WORDS =
  'pc|pcs|piece|pieces|ct|count|cookie|cookies|bar|bars|can|cans|bottle|bottles|scoop|scoops|slice|slices|' +
  'pack|packs|packet|packets|bag|bags|serving|servings|each|unit|units|cup|cups|tbsp|tsp|egg|eggs|patty|patties|' +
  'link|links|stick|sticks|pouch|pouches|box|boxes|wrap|wraps|tortilla|tortillas|biscuit|biscuits';
const UNIT_IN_PAREN = new RegExp(`\\b(?:${UNIT_WORDS})\\b`, 'i');
const UNIT_TRAILING = new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${UNIT_WORDS})$`, 'i');
const TRAILING_PAREN = /\(([^()]*)\)\s*$/;

/**
 * Describes the serving basis already stated in a food name. Aggregate counts
 * only; the conversion never changes or creates a basis.
 */
export function classifyBasis(name: unknown): BasisClass {
  if (typeof name !== 'string') return 'no_explicit_basis';
  const text = name.trim();
  const paren = TRAILING_PAREN.exec(text);
  if (paren) {
    const inner = paren[1];
    if (WEIGHT.test(inner)) return 'weight_stated';
    if (UNIT_IN_PAREN.test(inner)) return 'count_unit_stated';
    return 'other_basis_stated';
  }
  if (WEIGHT_TRAILING.test(text)) return 'weight_stated';
  if (UNIT_TRAILING.test(text)) return 'count_unit_stated';
  return 'no_explicit_basis';
}

export type QuantityState = 'absent' | 'zero' | 'present_nonzero';

/** The quantity field is ignored by the food readers and carried verbatim; it is an observation, not an input. */
export function quantityState(doc: Doc): QuantityState {
  if (!has(doc, 'quantity') || doc.quantity === undefined) return 'absent';
  const q = doc.quantity;
  if (q === 0 || (typeof q === 'string' && q.trim() !== '' && Number(q) === 0)) return 'zero';
  return 'present_nonzero';
}

export type ConversionSummary = {
  total: number;
  schema: { v1: number; v2: number };
  clean: number;
  blocked: number;
  reasons: Record<ReasonCode, number>;
  basis: Record<BasisClass, number>;
  legacyValues: { checked: number; identical: number };
  convertedDetailValues: { null: number; nonNull: number };
  nutrientMeta: { fiberMeaningSet: number; carbConventionSet: number };
  quantity: { present: number; zero: number; absent: number };
};

/** Accepts `{ id?, data }` wrappers or bare food data. Anything else is an empty document. */
export function unwrapFood(item: unknown): Doc {
  if (!isPlainObject(item)) return {};
  if (isPlainObject(item.data)) return item.data;
  return item;
}

/** Counts only. The output carries no name, id, path, or nutrient value. */
export function summarizeConversion(items: readonly unknown[], codec: ConversionCodec = SITE_CODEC): ConversionSummary {
  const summary: ConversionSummary = {
    total: 0,
    schema: { v1: 0, v2: 0 },
    clean: 0,
    blocked: 0,
    reasons: Object.fromEntries(REASON_CODES.map(code => [code, 0])) as Record<ReasonCode, number>,
    basis: Object.fromEntries(BASIS_CLASSES.map(cls => [cls, 0])) as Record<BasisClass, number>,
    legacyValues: { checked: 0, identical: 0 },
    convertedDetailValues: { null: 0, nonNull: 0 },
    nutrientMeta: { fiberMeaningSet: 0, carbConventionSet: 0 },
    quantity: { present: 0, zero: 0, absent: 0 },
  };
  for (const item of items) {
    const doc = unwrapFood(item);
    summary.total += 1;
    summary.schema[schemaVersionOf(doc) === 2 ? 'v2' : 'v1'] += 1;
    const verdict = conversionVerdict(doc, codec);
    if (verdict.status === 'clean') summary.clean += 1;
    else summary.blocked += 1;
    for (const reason of verdict.reasons) summary.reasons[reason] += 1;
    summary.basis[classifyBasis(doc.name)] += 1;
    summary.legacyValues.checked += LEGACY_V1_KEYS.length;
    if (verdict.roundTrip) {
      summary.legacyValues.identical += verdict.roundTrip.legacyIdentical;
      summary.convertedDetailValues.null += verdict.roundTrip.detailNull;
      summary.convertedDetailValues.nonNull += verdict.roundTrip.detailNonNull;
      if (verdict.roundTrip.fiberMeaningSet) summary.nutrientMeta.fiberMeaningSet += 1;
      if (verdict.roundTrip.carbConventionSet) summary.nutrientMeta.carbConventionSet += 1;
    }
    const quantity = quantityState(doc);
    if (quantity === 'absent') summary.quantity.absent += 1;
    else {
      summary.quantity.present += 1;
      if (quantity === 'zero') summary.quantity.zero += 1;
    }
  }
  return summary;
}
