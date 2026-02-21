/**
 * @file analysis/weightUpload.js
 * @description Parses weight CSV/TSV files and saves to Firestore with automatic dedup.
 *
 * Expected CSV format (tab-delimited from smart scale export):
 *   Weight (lb)\tBody Fat\tMuscle Mass\tWater\tBMI\tBone Mass\tDate/Time
 *   185.8\t19.80%\t43.10%\t59.20%\t25.9\t0%\tJul 13 2017 07:20:13 AM
 *
 * Only date/time and weight are used — everything else is ignored.
 * Re-uploading the full CSV is safe: deterministic Firestore doc IDs mean
 * existing rows are overwritten, not duplicated.
 */

import { state } from '../state/store.js';
import { saveWeightEntries, fetchWeightEntries } from '../services/firebase.js';
import { showMessage, debugLog } from '../utils/ui.js';
import { CONFIG } from '../config.js';

/**
 * Format a Date in the app's local timezone as YYYY-MM-DD.
 * Mirrors the approach used by nutrition entries (en-CA locale = YYYY-MM-DD).
 * @param {Date} d
 * @returns {string}
 */
function localDateStr(d) {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: CONFIG.TIMEZONE });
  } catch {
    // Fallback: manual local-time formatting
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/**
 * Build a deterministic, timezone-stable timestamp string for Firestore doc IDs.
 * Uses local time components so re-uploads always produce the same ID
 * regardless of daylight-saving shifts in toISOString().
 * @param {Date} d
 * @returns {string} e.g. "2017-07-13T07-20-13"
 */
function localTimestamp(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day}T${h}-${mi}-${s}`;
}

/**
 * Split a single CSV row respecting RFC-4180 double-quote rules.
 *
 * A naive split(',') breaks when a field like "Jul 13, 2017 07:20:13 AM" is
 * surrounded by quotes — the embedded comma is split into separate columns,
 * causing the date parser to receive a partial string and silently drop the row.
 *
 * For tab-delimited files the split is always naive because tabs never appear
 * inside quoted date/time fields from common scale exports.
 *
 * @param {string} line  - A single row from the file.
 * @param {string} delim - ',' or '\t'.
 * @returns {string[]}
 */
function splitCsvRow(line, delim) {
  if (delim !== ',') return line.split(delim);

  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double-quote inside a quoted field ("" → ")
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a weight CSV/TSV string into structured entries.
 * @param {string} raw - The raw file content.
 * @returns {Array<{date: string, weight_lb: number, time_min: number, timestamp: string}>}
 */
export function parseWeightCSV(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter: tab or comma
  const header = lines[0];
  const delim = header.includes('\t') ? '\t' : ',';
  // Use splitCsvRow so that a quoted header cell (rare but valid) is handled correctly.
  const cols = splitCsvRow(header, delim).map(c => c.toLowerCase());

  // Find the weight and date/time column indices
  const weightIdx = cols.findIndex(c => c.startsWith('weight'));
  const dateIdx = cols.findIndex(c => c.includes('date') || c.includes('time'));

  if (weightIdx === -1 || dateIdx === -1) {
    showMessage('CSV must have "Weight" and "Date/Time" columns.', true);
    return [];
  }

  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvRow(lines[i], delim);
    if (parts.length <= Math.max(weightIdx, dateIdx)) continue;

    const weightStr = parts[weightIdx].trim();
    const dateStr = parts[dateIdx].trim();

    const weight_lb = parseFloat(weightStr);
    if (isNaN(weight_lb) || weight_lb < 50 || weight_lb > 600) continue;

    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) continue;

    // Use local time (matches nutrition entry dates) — NOT UTC via toISOString()
    const date = localDateStr(parsed);
    const time_min = parsed.getHours() * 60 + parsed.getMinutes();
    const timestamp = localTimestamp(parsed);

    entries.push({ date, weight_lb, time_min, timestamp });
  }

  return entries;
}

/**
 * Handle the weight CSV file upload.
 * Parses the file, saves to Firestore (dedup via doc ID), refreshes state.
 * @param {File} file - The uploaded file.
 * @returns {Promise<{total: number, saved: number}>}
 */
export async function handleWeightUpload(file) {
  if (!state.userId) {
    showMessage('Please log in before uploading weight data.', true);
    return { total: 0, saved: 0 };
  }

  showMessage('Parsing weight file...', false, 10000);

  const raw = await file.text();
  const entries = parseWeightCSV(raw);

  if (entries.length === 0) {
    showMessage('No valid weight entries found in file. Check format.', true);
    return { total: 0, saved: 0 };
  }

  debugLog('weight-upload', `Parsed ${entries.length} weight entries from CSV`);
  showMessage(`Uploading ${entries.length} weight entries (duplicates auto-skipped)...`, false, 15000);

  const result = await saveWeightEntries(entries);

  // Refresh the full weight dataset from Firestore
  state.weightEntries = await fetchWeightEntries();

  showMessage(`Upload complete: ${result.saved} entries saved (${state.weightEntries.size} total in database).`);
  debugLog('weight-upload', `Upload complete`, { parsed: entries.length, saved: result.saved, totalInDB: state.weightEntries.size });

  return { total: entries.length, saved: result.saved };
}
