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
  const cols = header.split(delim).map(c => c.trim().toLowerCase());

  // Find the weight and date/time column indices
  const weightIdx = cols.findIndex(c => c.startsWith('weight'));
  const dateIdx = cols.findIndex(c => c.includes('date') || c.includes('time'));

  if (weightIdx === -1 || dateIdx === -1) {
    showMessage('CSV must have "Weight" and "Date/Time" columns.', true);
    return [];
  }

  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim);
    if (parts.length <= Math.max(weightIdx, dateIdx)) continue;

    const weightStr = parts[weightIdx].trim();
    const dateStr = parts[dateIdx].trim();

    const weight_lb = parseFloat(weightStr);
    if (isNaN(weight_lb) || weight_lb < 50 || weight_lb > 600) continue;

    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) continue;

    const date = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
    const time_min = parsed.getHours() * 60 + parsed.getMinutes();
    // Compact timestamp for deterministic doc ID
    const timestamp = parsed.toISOString().replace('Z', '').split('.')[0];

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
