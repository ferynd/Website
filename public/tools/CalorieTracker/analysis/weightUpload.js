/**
 * @file analysis/weightUpload.js
 * @description Handles weight CSV upload: parse → preview → batch-save → state update.
 *
 * Uses the robust parser from weightParser.js and saves to Firestore in
 * batched writes (≤450 per batch) for performance. Local state is updated
 * inline after each batch — no extra full refetch needed.
 */

import { state } from '../state/store.js';
import { saveWeightEntriesBatch } from '../services/firebase.js';
import { showMessage, debugLog } from '../utils/ui.js';
import { CONFIG } from '../config.js';
import { parseWeightCSV } from './weightParser.js';

// Re-export so any legacy import of parseWeightCSV from this file still works.
export { parseWeightCSV } from './weightParser.js';

/**
 * Handle the weight CSV file upload.
 * Parses the file, shows inline diagnostics, saves in batched Firestore writes,
 * then updates local state — no full refetch unless saving fails.
 *
 * @param {File} file - The uploaded File object.
 * @param {object} [opts]
 * @param {(msg: string, isError?: boolean, duration?: number) => void} [opts.onStatus]
 *   Called to display status messages. Defaults to the global showMessage toast.
 * @param {(saved: number, total: number, batchIdx: number, totalBatches: number) => void} [opts.onProgress]
 *   Called after each batch completes.
 * @returns {Promise<{
 *   total: number,
 *   parsed: number,
 *   saved: number,
 *   diagnostics: object | null,
 * }>}
 */
export async function handleWeightUpload(file, opts = {}) {
  const { onStatus = showMessage, onProgress } = opts;

  if (!state.userId) {
    onStatus('Please log in before uploading weight data.', true);
    return { total: 0, parsed: 0, saved: 0, diagnostics: null };
  }

  onStatus('Reading file…', false, 5000);

  let raw;
  try {
    raw = await file.text();
  } catch (e) {
    onStatus(`Failed to read file: ${e.message}`, true);
    return { total: 0, parsed: 0, saved: 0, diagnostics: null };
  }

  onStatus('Parsing CSV…', false, 8000);
  const { entries, diagnostics } = parseWeightCSV(raw, { timezone: CONFIG.TIMEZONE });
  debugLog('weight-upload', 'Parse complete', diagnostics);

  if (entries.length === 0) {
    const reasonParts = Object.entries(diagnostics.skippedReasons)
      .map(([r, n]) => `${r.replace(/_/g, ' ')}: ${n}`)
      .join('; ');
    const noColMsg = diagnostics.skippedReasons['no_weight_column']
      ? 'No weight column found — expected "Weight", "Weight (lb)", "Weight(kg)", or "Body Weight".'
      : diagnostics.skippedReasons['no_date_column']
        ? 'No date column found — expected "Date/Time", "Timestamp", "Date", "Measured At", or "Created At".'
        : `No valid rows found. ${reasonParts || 'Check column names and date format.'}`;
    onStatus(noColMsg, true, 12000);
    return { total: diagnostics.totalRows, parsed: 0, saved: 0, diagnostics };
  }

  const totalBatches = Math.ceil(entries.length / 450);
  onStatus(
    `Parsed ${entries.length} entries from ${diagnostics.totalRows} rows ` +
    `(${diagnostics.skippedRows} skipped, delimiter: ${diagnostics.detectedDelimiter}). ` +
    `Saving in ${totalBatches} batch${totalBatches === 1 ? '' : 'es'}…`,
    false,
    30000,
  );

  const result = await saveWeightEntriesBatch(entries, {
    onProgress: (saved, total, bi, bt) => {
      if (onProgress) onProgress(saved, total, bi, bt);
      debugLog('weight-upload', `Batch ${bi}/${bt}: ${saved}/${total} saved`);
    },
  });

  const totalInDB = state.weightEntries.size;
  const rangeFrom = diagnostics.detectedDateRange.from || '?';
  const rangeTo   = diagnostics.detectedDateRange.to   || '?';

  if (result.partialFailure) {
    // Some batches failed — already-saved batches are in local state
    const unsaved = result.skipped;
    if (result.saved === 0) {
      onStatus(
        `Upload failed: 0 of ${entries.length} entries saved. ` +
        `Check your connection and try again.`,
        true,
        12000,
      );
    } else {
      onStatus(
        `Partial upload: ${result.saved} of ${entries.length} entries saved` +
        ` (${unsaved} not saved — connection error). Re-uploading will retry the missing rows.`,
        true,
        12000,
      );
    }
  } else {
    onStatus(
      `Upload complete: ${result.saved} entries saved ` +
      `(${totalInDB} total in database, ` +
      `date range: ${rangeFrom} → ${rangeTo}).`,
      false,
      8000,
    );
  }

  debugLog('weight-upload', 'Upload complete', {
    parsed: entries.length,
    saved: result.saved,
    skipped: result.skipped,
    partialFailure: result.partialFailure,
    totalInDB,
    diagnostics,
  });

  return {
    total: diagnostics.totalRows,
    parsed: entries.length,
    saved: result.saved,
    skipped: result.skipped,
    partialFailure: result.partialFailure,
    diagnostics,
  };
}
