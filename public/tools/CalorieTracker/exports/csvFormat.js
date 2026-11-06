/**
 * Pure saved-food CSV. Version 1 keeps today's columns and omits empty cells.
 * Version 2 appends detail keys and a nutrientMeta JSON column.
 */
import { resolveNutrientWriteVersion } from '../../../shared/nutrition/capabilities.js';
import {
  LEGACY_V1_KEYS,
  V2_DETAIL_KEYS,
  V2_KEYS,
  emptyStagedRecord,
  getNutrient,
  lookupLabel,
  resolveAmount,
} from '../../../shared/nutrition/nutrientRegistry.js';
import { NewerSchemaError, NutrientBoundsError, buildFoodWrite } from '../nutrition/nutrientRecord.js';

const LEGACY_HEADERS = ['name', 'quantity', 'lastUpdated', ...LEGACY_V1_KEYS];

function quoteString(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function parseCsvRow(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function compact(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/\s+/g, '').toLowerCase();
}

const HEADER_MAP = new Map();
for (const key of V2_KEYS) {
  HEADER_MAP.set(compact(key), key);
  const def = getNutrient(key);
  HEADER_MAP.set(compact(def.label), key);
  for (const label of def.labels || []) HEADER_MAP.set(compact(label), key);
  for (const alias of def.legacyAliases || []) HEADER_MAP.set(compact(alias), key);
}

/**
 * A header that names folic acid is not a folate DFE column unless it also
 * says DFE and is not itself the folic-acid nutrient. There is no cell value
 * here, so the header text is the whole check.
 */
function folicAcidHeaderRejected(trimmed) {
  if (!/\bfolic\s+acid\b/i.test(trimmed)) return false;
  const folateMeasure = /\bdfe\b/i.test(trimmed) && !/^\s*folic\s+acid\b/i.test(trimmed);
  return !folateMeasure;
}

function describeHeader(raw) {
  const trimmed = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (folicAcidHeaderRejected(trimmed)) {
    return { key: null, unit: null, rejected: 'nondefensible_conversion' };
  }
  const packed = compact(trimmed);
  if (packed === 'name' || packed === 'quantity') return { key: packed, unit: null };
  if (packed === 'lastupdated') return { key: 'lastUpdated', unit: null };
  if (packed === 'nutrientmeta') return { key: 'nutrientMeta', unit: null };
  if (HEADER_MAP.has(packed)) return { key: HEADER_MAP.get(packed), unit: null };
  const looked = lookupLabel(trimmed);
  if (!looked) return { key: null, unit: null };
  return { key: looked.key, unit: looked.unit || null };
}

export function mapSavedFoodHeader(raw) {
  return describeHeader(raw).key;
}

/** A bare number stays as written. A trailing unit is kept so it can disagree with the header unit. */
function splitCsvAmount(cell) {
  const trimmed = String(cell ?? '').trim();
  const match = trimmed.match(/^([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*([a-zA-Zµμ]+)$/);
  if (!match) return { value: parseFloat(trimmed), unit: '' };
  return { value: Number(match[1].replace(/,/g, '')), unit: match[2] };
}

function silentClamp(key, raw) {
  if (Number.isNaN(raw) || raw < 0) return 0;
  const max = getNutrient(key)?.bounds?.perUnit?.max;
  return max != null && raw > max ? max : raw;
}

export function formatSavedFoodsCsv(foods, writeVersion = resolveNutrientWriteVersion()) {
  const headers = writeVersion === 2
    ? [...LEGACY_HEADERS, ...V2_DETAIL_KEYS, 'nutrientMeta']
    : [...LEGACY_HEADERS];
  let csv = headers.map((header) => quoteString(header)).join(',') + '\n';
  for (const food of foods || []) {
    const row = headers.map((header) => {
      if (header === 'nutrientMeta') {
        if (food.nutrientMeta == null) return '';
        return quoteString(JSON.stringify(food.nutrientMeta));
      }
      const value = food[header];
      if (value == null) return '';
      if (typeof value === 'string') return quoteString(value);
      return value;
    }).join(',');
    csv += row + '\n';
  }
  return csv;
}

function applyMeta(record, meta) {
  if (!meta || typeof meta !== 'object') return;
  if (meta.fiberMeaning) record.fiberMeaning = meta.fiberMeaning;
  if (meta.carbConvention) record.carbConvention = meta.carbConvention;
  const quality = meta.quality && typeof meta.quality === 'object' ? meta.quality : {};
  for (const key of Object.keys(quality)) {
    if (!record.quality[key]) continue;
    record.quality[key] = { ...record.quality[key], ...quality[key] };
  }
}

/**
 * @returns {{ rows: object[], unknownHeaders: string[], warnings: object[] }}
 */
export function parseSavedFoodsCsv(text, writeVersion = resolveNutrientWriteVersion()) {
  let source = String(text ?? '');
  if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const warnings = [];
  const unknownHeaders = [];
  if (lines.length === 0) return { rows: [], unknownHeaders, warnings, missingName: true };
  const rawHeaders = parseCsvRow(lines[0]);
  const mapped = rawHeaders.map((header) => {
    const described = describeHeader(header);
    return { raw: header, key: described.key, unit: described.unit, rejected: described.rejected || null };
  });
  const missingName = !mapped.some((column) => column.key === 'name');
  for (const column of mapped) {
    if (!String(column.raw).trim()) continue;
    if (column.rejected) {
      warnings.push({
        level: 'review',
        code: column.rejected,
        key: 'folate',
        message: `Folic acid is not converted to folate DFE (${String(column.raw).trim()}).`,
      });
      continue;
    }
    if (!column.key && !unknownHeaders.includes(column.raw.trim())) unknownHeaders.push(column.raw.trim());
  }
  if (unknownHeaders.length) {
    warnings.push({
      level: 'review',
      code: 'unknown_header',
      message: `Unknown CSV headers: ${unknownHeaders.join(', ')}.`,
    });
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const nameColumn = mapped.findIndex((column) => column.key === 'name');
    const name = nameColumn >= 0 ? (cells[nameColumn] || '').trim() : '';
    if (!name) continue;
    const quantityColumn = mapped.findIndex((column) => column.key === 'quantity');
    const quantity = quantityColumn >= 0 ? (parseFloat(cells[quantityColumn]) || 0) : 0;
    const record = emptyStagedRecord();
    const fields = {};
    const seen = new Map();
    let meta = null;
    let clamped = 0;
    let rejected = false;
    mapped.forEach((column, index) => {
      if (!column.key || column.key === 'name' || column.key === 'quantity' || column.key === 'lastUpdated') return;
      const cell = cells[index] ?? '';
      if (column.key === 'nutrientMeta') {
        if (!cell.trim()) return;
        if (writeVersion !== 2) {
          warnings.push({ level: 'info', code: 'detail_not_stored', message: 'nutrientMeta is not stored while v2 writes are off.' });
          return;
        }
        try { meta = JSON.parse(cell); } catch { warnings.push({ level: 'review', code: 'bad_meta', message: 'nutrientMeta was not valid JSON.' }); }
        return;
      }
      if (cell.trim() === '') {
        if (writeVersion === 2 && !seen.has(column.key)) record.values[column.key] = null;
        return;
      }
      const parsedAmount = splitCsvAmount(cell);
      let raw = parsedAmount.value;
      if (Number.isNaN(raw)) {
        warnings.push({ level: 'review', code: 'bad_number', key: column.key, message: `Could not read ${column.key}.` });
        return;
      }
      if (column.unit || parsedAmount.unit) {
        const resolved = resolveAmount(column.key, raw, parsedAmount.unit, column.unit || '');
        if (resolved.error) {
          warnings.push({
            level: 'review',
            code: resolved.error,
            key: column.key,
            message: resolved.error === 'unit_mismatch'
              ? `${String(column.raw).trim()} mixes units and was not stored.`
              : `${String(column.raw).trim()} could not be converted (${resolved.error}).`,
          });
          return;
        }
        raw = resolved.value;
      }
      if (seen.has(column.key)) {
        if (seen.get(column.key) !== raw) {
          rejected = true;
          delete fields[column.key];
          record.values[column.key] = null;
          record.quality[column.key] = { status: 'unknown' };
          warnings.push({
            level: 'review',
            code: 'duplicate_column',
            key: column.key,
            message: `Conflicting duplicate values for ${column.key}.`,
          });
        }
        return;
      }
      seen.set(column.key, raw);
      if (writeVersion === 2) {
        record.values[column.key] = raw;
        record.quality[column.key] = { status: 'label_reported' };
      } else if (LEGACY_V1_KEYS.includes(column.key)) {
        const val = silentClamp(column.key, raw);
        if (val !== raw) clamped += 1;
        fields[column.key] = val;
        record.values[column.key] = val;
        record.quality[column.key] = { status: 'legacy_unclassified' };
      } else {
        warnings.push({
          level: 'info',
          code: 'detail_not_stored',
          key: column.key,
          message: `${column.key} is stored once v2 storage is enabled.`,
        });
      }
    });
    if (meta) applyMeta(record, meta);
    rows.push({ name, quantity, fields, record, clamped: rejected ? 0 : clamped, rejected });
  }
  return { rows, unknownHeaders, warnings, missingName };
}

/** Firestore id shared by names that differ only by non-alphanumeric characters. */
export function savedFoodDocId(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Decide a saved-food CSV write from the document that actually occupies the slugged id.
 * Flag-off writes stay the v1 object: name, quantity, present legacy fields, lastUpdated.
 */
export function decideCsvFoodWrite(row, existingDoc, writeVersion, lastUpdated) {
  if (row?.rejected) return { action: 'skip', reason: 'conflict' };
  if (writeVersion === 2) {
    try {
      const built = buildFoodWrite(row.record, {
        writeVersion,
        existingDoc,
        name: row.name,
        quantity: row.quantity,
        lastUpdated,
      });
      return { action: 'write', doc: built.doc };
    } catch (error) {
      if (error instanceof NewerSchemaError || error?.name === 'NewerSchemaError') {
        return { action: 'skip', reason: 'newer-schema' };
      }
      if (error instanceof NutrientBoundsError || error?.name === 'NutrientBoundsError') {
        return { action: 'skip', reason: 'bounds' };
      }
      throw error;
    }
  }
  if (Number(existingDoc?.nutrientSchemaVersion) >= 2) return { action: 'skip', reason: 'newer-schema' };
  return {
    action: 'write',
    doc: { name: row.name, quantity: row.quantity, ...row.fields, lastUpdated },
  };
}

/** Read the target doc inside the caller's transaction, then set only when the write is allowed. */
export async function writeImportedFood(transaction, ref, row, writeVersion, lastUpdated) {
  if (row?.rejected) return { action: 'skip', reason: 'conflict' };
  const snap = await transaction.get(ref);
  const existingDoc = typeof snap?.exists === 'function' && snap.exists() ? snap.data() : null;
  const outcome = decideCsvFoodWrite(row, existingDoc, writeVersion, lastUpdated);
  if (outcome.action === 'write') transaction.set(ref, outcome.doc);
  return outcome;
}

/**
 * Import summary. Errored rows are failures, not skips, so the toast is an
 * error when any transaction failed. `offline` adds the unavailable message.
 */
export function summarizeCsvImport(counts) {
  const imported = counts?.imported || 0;
  const skipped = counts?.skipped || 0;
  const errored = counts?.errored || 0;
  const unattempted = counts?.unattempted || 0;
  const stopped = Boolean(counts?.offline);
  let message = stopped
    ? `Import stopped: ${imported} food(s) imported, ${skipped} skipped, ${errored} failed, ${unattempted} not attempted.`
    : errored > 0
      ? `Import complete: ${imported} food(s) imported, ${skipped} skipped, ${errored} failed.`
      : `Import complete: ${imported} food(s) imported, ${skipped} skipped.`;
  if (counts?.clamped > 0) message += ` ${counts.clamped} value(s) clamped to bounds.`;
  if (counts?.newer > 0) message += ` ${counts.newer} skipped because they were saved by a newer version — reload.`;
  if (counts?.bounds > 0) message += ` ${counts.bounds} skipped because a nutrient is outside the registry bounds.`;
  if (counts?.unknownHeaders?.length) message += ` Unknown headers: ${counts.unknownHeaders.join(', ')}.`;
  const warningText = summarizeCsvImportWarnings(counts?.warnings);
  if (warningText) message += ` ${warningText}`;
  if (counts?.offline) message += ' Offline — not saved.';
  return { message, isError: errored > 0 };
}

/** Completion text for parser warnings. Unknown headers are reported separately. */
export function summarizeCsvImportWarnings(warnings) {
  const list = warnings || [];
  const count = (code) => list.filter((warning) => warning.code === code).length;
  const parts = [];
  const detail = count('detail_not_stored');
  const badNumbers = count('bad_number');
  const duplicates = count('duplicate_column');
  if (detail) parts.push(`${detail} detail value(s) were not stored while v2 writes are off.`);
  if (badNumbers) parts.push(`${badNumbers} malformed number(s) were omitted.`);
  if (count('bad_meta')) parts.push('nutrientMeta was not valid JSON.');
  if (duplicates) parts.push(`${duplicates} conflicting duplicate column(s) blocked a row.`);
  const unitProblems = count('nondefensible_conversion') + count('unit_mismatch');
  if (unitProblems) parts.push(`${unitProblems} value(s) were not converted and need review.`);
  return parts.join(' ');
}
