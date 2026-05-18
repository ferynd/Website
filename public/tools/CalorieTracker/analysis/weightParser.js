/**
 * @file analysis/weightParser.js
 * @description Robust weight CSV/TSV parser.
 *
 * Handles:
 *   - UTF-8 BOM
 *   - comma, tab, and semicolon delimiters
 *   - RFC-4180 quoted fields
 *   - CRLF and LF line endings
 *   - Headers with extra spaces, punctuation, casing, or units
 *   - Weight columns: Weight, Weight (lb), Weight(lbs), Body Weight, Weight(kg)
 *   - Date/time columns: Date/Time, Timestamp, Date, Time, Measured At, Created At
 *   - Separate Date + Time columns (combined before parsing)
 *   - Date formats: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, MM/DD/YYYY,
 *       MM/DD/YYYY HH:mm AM/PM, Jul 13 2017 07:20:13 AM, Jul 13, 2017 07:20:13 AM
 *   - kg-to-lb conversion when column header indicates kg
 *
 * Returns both parsed entries and row-level diagnostics.
 * No external dependencies — safe to run in Node.js for tests.
 */

export const PARSER_VERSION = '2';
export const WEIGHT_BATCH_SIZE = 450;

const MONTH_NAMES = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// ── Low-level string helpers ─────────────────────────────────────────────────

function stripBOM(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

/**
 * Detect the dominant delimiter in a header line.
 * Counts occurrences outside quoted fields; prefers tab > semicolon > comma.
 */
function detectDelimiter(line) {
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch in counts) counts[ch]++;
  }
  if (counts['\t'] > 0 && counts['\t'] >= counts[';'] && counts['\t'] >= counts[',']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

/** Split one CSV row respecting RFC-4180 double-quote escaping. */
function splitRow(line, delim) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Normalize a header string for fuzzy matching:
 * lowercase, strip zero-width/BOM chars, collapse non-alphanumeric to spaces.
 */
function normalizeHeader(h) {
  return h
    .toLowerCase()
    // Strip zero-width chars and BOM explicitly (avoid range classes)
    .replace(/​|‌|‍|﻿/g, '')
    // Collapse everything that is not a letter or digit into a single space
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ── Column classification ─────────────────────────────────────────────────────

/** @returns {{ unit: 'kg' | 'lb' } | null} */
function classifyWeightHeader(norm) {
  // Require "weight" as a whole word so "notweight" is not matched
  if (!/\bweight\b/.test(norm)) return null;
  if (/\bkg\b/.test(norm)) return { unit: 'kg' };
  return { unit: 'lb' };
}

/** @returns {'datetime' | 'date' | 'time' | null} */
function classifyDateHeader(norm) {
  // Compound datetime — check before plain 'date'
  if (
    norm.includes('timestamp') ||
    norm.includes('measured at') ||
    norm.includes('created at') ||
    (norm.includes('date') && norm.includes('time'))
  ) return 'datetime';
  // Date-only
  if (norm === 'date' || norm.startsWith('date ') || norm.endsWith(' date')) return 'date';
  // Time-only
  if (norm === 'time' || norm.startsWith('time ') || norm.endsWith(' time')) return 'time';
  return null;
}

// ── Explicit date parsers ────────────────────────────────────────────────────

/**
 * Return true when the source string contained an explicit time component
 * (contains digits around a colon, or AM/PM).
 */
function sourceHasTime(s) {
  return /\d:\d|[AaPp][Mm]/.test(s);
}

/**
 * Interpret (year, month, day, hour, min, sec) wall-clock components as being
 * in `timezone` and return the corresponding UTC-based Date.
 *
 * Without a timezone the components are treated as browser-local time (same as
 * `new Date(y, m-1, d, h, mi, s)`).
 *
 * The iterative algorithm finds the UTC instant such that, when formatted in
 * the target timezone, it reads as the given wall-clock components. Converges
 * in ≤3 iterations for all real-world IANA timezone offsets.
 */
function parseDateInTimezone(year, month, day, hour, min, sec, timezone) {
  if (!timezone) return new Date(year, month - 1, day, hour, min, sec);
  try {
    let utcMs = Date.UTC(year, month - 1, day, hour, min, sec);
    for (let i = 0; i < 3; i++) {
      const d = new Date(utcMs);
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = t => parseInt(parts.find(p => p.type === t)?.value ?? '0');
      let tzH = get('hour'); if (tzH === 24) tzH = 0;
      const gotMs  = Date.UTC(get('year'), get('month') - 1, get('day'), tzH, get('minute'), get('second'));
      const wantMs = Date.UTC(year, month - 1, day, hour, min, sec);
      const diff = gotMs - wantMs;
      if (Math.abs(diff) < 1000) break;
      utcMs -= diff;
    }
    return new Date(utcMs);
  } catch (_) {
    return new Date(year, month - 1, day, hour, min, sec);
  }
}

/**
 * Parse a date string using explicit format matchers.
 * Falls back to new Date() as a last resort.
 * @param {string} s
 * @param {string|null} [timezone]  – IANA timezone name (e.g. "America/Chicago")
 * @returns {Date | null}
 */
function parseExplicitDate(s, timezone) {
  s = (s || '').trim();
  if (!s) return null;

  let m;

  // YYYY-MM-DD [T|space HH:mm[:ss]]
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return parseDateInTimezone(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), timezone);
  }

  // MM/DD/YYYY [HH:mm[:ss] [AM/PM]]  — optional 12-hour suffix; bare 24-hour also accepted
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let h = +(m[4] || 0), mi = +(m[5] || 0), sec = +(m[6] || 0);
    if (m[7]) {
      const pm = m[7].toLowerCase() === 'pm';
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return parseDateInTimezone(+m[3], +m[1], +m[2], h, mi, sec, timezone);
  }

  // Mon[ ]DD[,] YYYY HH:mm[:ss] AM/PM  (e.g. "Jul 13 2017 07:20:13 AM")
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (m) {
    const moIdx = MONTH_NAMES[m[1].toLowerCase()];
    if (moIdx === undefined) return null;
    let h = +m[4];
    const pm = m[7].toLowerCase() === 'pm';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return parseDateInTimezone(+m[3], moIdx + 1, +m[2], h, +m[5], +(m[6] || 0), timezone);
  }

  // Final fallback (no timezone applied — string has no parseable components)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── Doc-ID helpers ────────────────────────────────────────────────────────────

/**
 * Extract YYYY-MM-DD in the given timezone (or browser-local time when absent).
 * Using Intl.DateTimeFormat with 'en-CA' reliably returns ISO-style YYYY-MM-DD.
 */
function localDateStr(d, timezone) {
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
    } catch (_) { /* fall through */ }
  }
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Build a "YYYY-MM-DDTHH-MM-SS" timestamp string in the given timezone.
 */
function localTimestamp(d, timezone) {
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = t => parts.find(p => p.type === t)?.value ?? '00';
      let h = get('hour'); if (h === '24') h = '00';
      return `${get('year')}-${get('month')}-${get('day')}T${h}-${get('minute')}-${get('second')}`;
    } catch (_) { /* fall through */ }
  }
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h  = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s  = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}-${mi}-${s}`;
}

/**
 * Extract hour and minute in the given timezone (or browser-local).
 */
function localHourMin(d, timezone) {
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = t => parseInt(parts.find(p => p.type === t)?.value ?? '0');
      let h = get('hour'); if (h === 24) h = 0;
      return { h, mi: get('minute') };
    } catch (_) { /* fall through */ }
  }
  return { h: d.getHours(), mi: d.getMinutes() };
}

/** djb2-variant hash of a string → unsigned 32-bit base-36. */
function rowHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Deterministic Firestore document ID:
 * - Rows with a precise time → local timestamp ("2017-07-13T07-20-13")
 * - Date-only rows           → "date_weight_hash" (stable across re-uploads)
 */
function computeDocId(d, weight_lb, rawRow, hasTime, timezone) {
  if (hasTime) return localTimestamp(d, timezone);
  return `${localDateStr(d, timezone)}_${weight_lb}_${rowHash(rawRow)}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse a raw weight CSV/TSV string.
 *
 * @param {string} raw - Raw file content.
 * @param {{ timezone?: string }} [opts]
 * @returns {{
 *   entries: Array<{
 *     docId: string,
 *     date: string,
 *     weight_lb: number,
 *     time_min: number,
 *     timestamp: string,
 *     originalUnit: string,
 *     parserVersion: string,
 *     sourceHash: string,
 *     importedAt: string,
 *   }>,
 *   diagnostics: {
 *     totalRows: number,
 *     parsedRows: number,
 *     skippedRows: number,
 *     duplicateRows: number,
 *     skippedReasons: Record<string, number>,
 *     skippedExamples: Record<string, number[]>,
 *     detectedDelimiter: string,
 *     detectedColumns: { weight?: string, datetime?: string, date?: string, time?: string },
 *     detectedDateRange: { from?: string, to?: string },
 *     weightUnit: string,
 *   }
 * }}
 */
export function parseWeightCSV(raw, opts = {}) {
  const importedAt = new Date().toISOString();
  const timezone   = opts.timezone ?? null;

  const diag = {
    totalRows: 0,
    parsedRows: 0,
    skippedRows: 0,
    duplicateRows: 0,
    skippedReasons: {},
    skippedExamples: {},
    detectedDelimiter: 'comma',
    detectedColumns: {},
    detectedDateRange: {},
    weightUnit: 'lb',
  };

  function skip(reason, rowNum) {
    diag.skippedRows++;
    diag.skippedReasons[reason] = (diag.skippedReasons[reason] || 0) + 1;
    if (!diag.skippedExamples[reason]) diag.skippedExamples[reason] = [];
    if (diag.skippedExamples[reason].length < 3) diag.skippedExamples[reason].push(rowNum);
  }

  if (!raw || typeof raw !== 'string') {
    skip('empty_input', 0);
    return { entries: [], diagnostics: diag };
  }

  const cleaned = stripBOM(raw);
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) {
    skip('empty_file', 0);
    return { entries: [], diagnostics: diag };
  }

  // ── Detect structure ──────────────────────────────────────────────────────

  const headerLine = lines[0];
  const delim = detectDelimiter(headerLine);
  diag.detectedDelimiter = delim === '\t' ? 'tab' : delim === ';' ? 'semicolon' : 'comma';

  const rawCols = splitRow(headerLine, delim);
  const normCols = rawCols.map(normalizeHeader);

  let weightIdx   = -1;
  let weightUnit  = 'lb';
  let datetimeIdx = -1;
  let dateIdx     = -1;
  let timeIdx     = -1;

  for (let i = 0; i < normCols.length; i++) {
    const n = normCols[i];
    const w = classifyWeightHeader(n);
    if (w && weightIdx === -1) {
      weightIdx = i;
      weightUnit = w.unit;
      diag.detectedColumns.weight = rawCols[i];
    }
    const dt = classifyDateHeader(n);
    if (dt === 'datetime' && datetimeIdx === -1) {
      datetimeIdx = i;
      diag.detectedColumns.datetime = rawCols[i];
    } else if (dt === 'date' && dateIdx === -1) {
      dateIdx = i;
      diag.detectedColumns.date = rawCols[i];
    } else if (dt === 'time' && timeIdx === -1) {
      timeIdx = i;
      diag.detectedColumns.time = rawCols[i];
    }
  }

  diag.weightUnit = weightUnit;

  if (weightIdx === -1) {
    skip('no_weight_column', 0);
    return { entries: [], diagnostics: diag };
  }
  if (datetimeIdx === -1 && dateIdx === -1) {
    skip('no_date_column', 0);
    return { entries: [], diagnostics: diag };
  }

  // ── Parse rows ────────────────────────────────────────────────────────────

  const entries = [];
  const seenDocIds = new Set();
  const maxNeededIdx = Math.max(weightIdx, datetimeIdx, dateIdx, timeIdx);

  for (let i = 1; i < lines.length; i++) {
    const rawRow = lines[i];
    diag.totalRows++;
    const parts = splitRow(rawRow, delim);

    if (parts.length <= maxNeededIdx) {
      skip('row_too_short', i + 1);
      continue;
    }

    // ── Weight ──────────────────────────────────────────────────────────────
    let weightStr = parts[weightIdx].replace(/%/g, '').trim();
    // For semicolon-delimited files commas are decimal separators
    if (delim === ';') weightStr = weightStr.replace(',', '.');
    let weight_lb = parseFloat(weightStr);
    if (isNaN(weight_lb)) { skip('invalid_weight', i + 1); continue; }
    if (weightUnit === 'kg') weight_lb = parseFloat((weight_lb * 2.20462).toFixed(1));
    if (weight_lb < 50 || weight_lb > 700) { skip('weight_out_of_range', i + 1); continue; }

    // ── Date string ──────────────────────────────────────────────────────────
    let dateStr;
    if (datetimeIdx !== -1) {
      dateStr = parts[datetimeIdx].trim();
    } else {
      const datePart = dateIdx !== -1 ? parts[dateIdx].trim() : '';
      const timePart = timeIdx !== -1 ? parts[timeIdx].trim() : '';
      dateStr = timePart ? `${datePart} ${timePart}` : datePart;
    }

    const parsed = parseExplicitDate(dateStr, timezone);
    if (!parsed || isNaN(parsed.getTime())) { skip('invalid_date', i + 1); continue; }

    const hasTime   = sourceHasTime(dateStr);
    const date      = localDateStr(parsed, timezone);
    const { h: hh, mi: mmi } = localHourMin(parsed, timezone);
    const time_min  = hh * 60 + mmi;
    const timestamp = localTimestamp(parsed, timezone);
    const sourceHash = rowHash(rawRow);
    const docId     = computeDocId(parsed, weight_lb, rawRow, hasTime, timezone);

    if (seenDocIds.has(docId)) {
      diag.duplicateRows++;
      skip('duplicate_in_file', i + 1);
      continue;
    }
    seenDocIds.add(docId);

    entries.push({
      docId,
      date,
      weight_lb,
      time_min,
      timestamp,
      originalUnit: weightUnit,
      parserVersion: PARSER_VERSION,
      sourceHash,
      importedAt,
    });
  }

  diag.parsedRows = entries.length;

  if (entries.length > 0) {
    // Use min/max so newest-first exports still report the correct range
    let minDate = entries[0].date;
    let maxDate = entries[0].date;
    for (const e of entries) {
      if (e.date < minDate) minDate = e.date;
      if (e.date > maxDate) maxDate = e.date;
    }
    diag.detectedDateRange = { from: minDate, to: maxDate };
  }

  return { entries, diagnostics: diag };
}
