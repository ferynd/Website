/**
 * Tracker glue around the shared registry. Version 1 writes stay the pre-#60
 * food document: name, quantity, 24 numbers, lastUpdated. No coverage field
 * is stored on day documents.
 */
import { resolveNutrientWriteVersion } from '../../../shared/nutrition/capabilities.js';
import {
  LEGACY_V1_KEYS,
  V2_DETAIL_KEYS,
  V2_KEYS,
  checkPer100g,
  checkPerUnit,
  emptyStagedRecord,
  getNutrient,
  projectToV1,
  readNutrientFields,
  toV2Fields,
} from '../../../shared/nutrition/nutrientRegistry.js';

export class NewerSchemaError extends Error {
  constructor() {
    super('saved by a newer version — reload');
    this.name = 'NewerSchemaError';
  }
}

export class NutrientBoundsError extends Error {
  constructor(key) {
    super(`${key} is outside the registry bounds`);
    this.name = 'NutrientBoundsError';
    this.key = key;
  }
}

/** v2 numbers may exceed the legacy per-unit cap when they still fit per 100 g (salt). */
function assertV2Value(key, value) {
  if (value == null) return;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new NutrientBoundsError(key);
  if (checkPerUnit(key, number) === 'ok') return;
  if (checkPer100g(key, number) === 'ok') return;
  throw new NutrientBoundsError(key);
}

export function readFoodNutrients(doc) {
  return readNutrientFields(doc);
}

function silentClampLegacy(key, value) {
  const max = getNutrient(key)?.bounds?.perUnit?.max;
  let number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (number < 0) number = 0;
  if (max != null && number > max) number = max;
  return number;
}

function cloneRecord(record) {
  const next = emptyStagedRecord();
  if (!record) return next;
  for (const key of V2_KEYS) {
    const value = record.values?.[key];
    next.values[key] = typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : null;
    const quality = record.quality?.[key];
    next.quality[key] = quality ? { ...quality } : { status: 'unknown' };
  }
  if (record.fiberMeaning) next.fiberMeaning = record.fiberMeaning;
  if (record.carbConvention) next.carbConvention = record.carbConvention;
  next.conflicts = (record.conflicts || []).map((conflict) => ({ key: conflict.key, values: [...conflict.values] }));
  next.unknownLabels = [...(record.unknownLabels || [])];
  next.warnings = (record.warnings || []).map((warning) => ({ ...warning }));
  return next;
}

/** Manual staging inputs win. A blank input stays null and never becomes the string "null". */
export function applyLegacyInputOverlay(record, inputs) {
  const next = cloneRecord(record);
  for (const key of LEGACY_V1_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(inputs || {}, key)) continue;
    const raw = inputs[key];
    if (raw === '' || raw == null) {
      if (next.values[key] !== null) {
        next.conflicts = next.conflicts.filter((conflict) => conflict.key !== key);
      }
      next.values[key] = null;
      next.quality[key] = { status: 'unknown' };
      continue;
    }
    const number = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(number)) {
      next.values[key] = null;
      next.quality[key] = { status: 'unknown' };
      continue;
    }
    if (next.values[key] !== number) {
      next.values[key] = number;
      next.quality[key] = { status: 'label_reported' };
      next.conflicts = next.conflicts.filter((conflict) => conflict.key !== key);
    }
  }
  return next;
}

export function buildFoodWrite(record, options = {}) {
  const writeVersion = options.writeVersion ?? resolveNutrientWriteVersion();
  const existingVersion = Number(options.existingDoc?.nutrientSchemaVersion);
  if (writeVersion !== 2 && existingVersion >= 2) throw new NewerSchemaError();

  const name = options.name;
  const quantity = options.quantity;
  const lastUpdated = options.lastUpdated;

  if (writeVersion === 2) {
    for (const key of V2_KEYS) assertV2Value(key, record?.values?.[key]);
    const v2 = toV2Fields(record);
    const doc = {
      name,
      quantity,
      ...v2.fields,
      nutrientSchemaVersion: v2.nutrientSchemaVersion,
      nutrientMeta: v2.nutrientMeta,
      lastUpdated,
    };
    return { doc, fields: v2.fields, zeroFilled: [], droppedDetail: [] };
  }

  const projected = projectToV1(record);
  const fields = {};
  for (const key of LEGACY_V1_KEYS) fields[key] = silentClampLegacy(key, projected.fields[key]);
  const doc = { name, quantity, ...fields, lastUpdated };
  return { doc, fields, zeroFilled: projected.zeroFilled, droppedDetail: projected.droppedDetail };
}

/**
 * Read the food at `ref` inside the caller's transaction, then write only when
 * that snapshot is safe for this write version. A cached document is ignored.
 * Flag-off writes stay the v1 object from buildFoodWrite.
 */
export async function commitSavedFoodWrite(transaction, ref, record, options = {}) {
  const snap = await transaction.get(ref);
  const existingDoc = typeof snap?.exists === 'function' && snap.exists() ? snap.data() : null;
  const built = buildFoodWrite(record, { ...options, existingDoc });
  transaction.set(ref, built.doc);
  return built;
}

/**
 * Day-log food item. Version 1 is id, name, quantity, timestamp, and the 24
 * numbers. Version 2 also keeps nutrientSchemaVersion and nutrientMeta.
 */
export function diaryFoodItem(built, identity, writeVersion = resolveNutrientWriteVersion()) {
  const item = {
    id: identity?.id,
    name: identity?.name,
    quantity: identity?.quantity,
    timestamp: identity?.timestamp,
    ...(built?.fields || {}),
  };
  if (writeVersion === 2) {
    item.nutrientSchemaVersion = 2;
    if (built?.doc?.nutrientMeta) item.nutrientMeta = built.doc.nutrientMeta;
  }
  return item;
}

export function v1StorageNotice(built) {
  const parts = [];
  if (built?.zeroFilled?.length) parts.push(`Zero-filled: ${built.zeroFilled.join(', ')}.`);
  if (built?.droppedDetail?.length) {
    parts.push(`Detail not stored yet (stored once v2 storage is enabled): ${built.droppedDetail.join(', ')}.`);
  }
  return parts.join(' ');
}

function v1Number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function assessFoodSave(existingDoc, record, writeVersion = resolveNutrientWriteVersion()) {
  const existingVersion = Number(existingDoc?.nutrientSchemaVersion);
  if (writeVersion !== 2 && existingVersion >= 2) {
    return { newerSchema: true, identical: false, differences: [] };
  }
  const existing = readNutrientFields(existingDoc);
  if (writeVersion === 2 || existingVersion === 2) {
    const differences = V2_KEYS.filter((key) => (existing.values[key] ?? null) !== (record?.values?.[key] ?? null));
    return { newerSchema: false, identical: differences.length === 0, differences };
  }
  const projected = targetsFromStagedRecord(record);
  const differences = LEGACY_V1_KEYS.filter((key) => v1Number(existing.values[key]) !== projected[key]);
  return { newerSchema: false, identical: differences.length === 0, differences };
}

export function targetsFromStagedRecord(record) {
  const projected = projectToV1(record);
  const fields = {};
  for (const key of LEGACY_V1_KEYS) fields[key] = silentClampLegacy(key, projected.fields[key]);
  return fields;
}

function itemQuantity(item, missingQuantity) {
  const raw = item?.quantity;
  if (raw == null || raw === '') return missingQuantity;
  return parseFloat(raw) || 0;
}

function isPartialV2(item, key) {
  if (Number(item?.nutrientSchemaVersion) !== 2) return false;
  const raw = item?.[key];
  return raw == null || raw === '';
}

/** Numeric sum matches adding 0 for unknown v2 keys. Does not mutate items. */
export function sumLegacyDayTotals(foodItems, options = {}) {
  const missingQuantity = options.missingQuantity ?? 0;
  const totals = {};
  const partialKeys = [];
  for (const key of LEGACY_V1_KEYS) {
    let sum = 0;
    let partial = false;
    for (const item of foodItems || []) {
      if (isPartialV2(item, key)) {
        partial = true;
        continue;
      }
      sum += itemQuantity(item, missingQuantity) * (parseFloat(item?.[key]) || 0);
    }
    totals[key] = sum;
    if (partial) partialKeys.push(key);
  }
  return { totals, partialKeys };
}

/**
 * Write the 24 numeric day totals. Unknown v2 keys contribute 0 and are not stored on the entry.
 * @returns {{ totals: Record<string, number>, partialKeys: string[] }}
 */
export function writeLegacyDayTotals(entry, foodItems, options = {}) {
  const summed = sumLegacyDayTotals(foodItems, options);
  const round = options?.round === true;
  for (const key of LEGACY_V1_KEYS) {
    const value = summed.totals[key];
    entry[key] = round ? Math.round(value) : value;
  }
  return summed;
}

export function legacyPartialNote(partialKeys) {
  if (!partialKeys?.length) return '';
  return `Partial day totals (≥): ${partialKeys.join(', ')}.`;
}

export function legacyItemAmount(item, key, options = {}) {
  const missingQuantity = options.missingQuantity ?? 0;
  if (isPartialV2(item, key)) return { amount: 0, partial: true };
  return {
    amount: itemQuantity(item, missingQuantity) * (parseFloat(item?.[key]) || 0),
    partial: false,
  };
}

export function deriveDayDetailTotals(foodItems) {
  const items = foodItems || [];
  const result = {};
  for (const key of V2_DETAIL_KEYS) {
    if (items.length === 0) {
      result[key] = { value: null, coverage: 'none' };
      continue;
    }
    let sum = 0;
    let seen = 0;
    for (const item of items) {
      const raw = item?.[key];
      const present = raw != null && raw !== '' && Number.isFinite(typeof raw === 'number' ? raw : Number(raw));
      if (!present) continue;
      const number = typeof raw === 'number' ? raw : Number(raw);
      sum += itemQuantity(item, 1) * number;
      seen += 1;
    }
    let coverage = 'none';
    if (seen === items.length) coverage = 'complete';
    else if (seen > 0) coverage = 'partial';
    result[key] = { value: seen > 0 ? sum : null, coverage };
  }
  return result;
}
