/**
 * @file src/exports/exporters.js
 * @description Contains functions for exporting user data to JSON and CSV formats.
 */

import { state } from '../state/store.js';
import { formatDate } from '../utils/time.js';
import { showMessage, handleError } from '../utils/ui.js';
import { fetchTargets, fetchAllEntries } from '../services/firebase.js';
import { allNutrients } from '../constants.js';

/**
 * Exports the user's baseline targets as a JSON file.
 */
export async function exportTargetsJson() {
  if (!state.userId) return showMessage('Cannot export targets. Not authenticated.', true);
  try {
    const targets = await fetchTargets();
    const blob = new Blob([JSON.stringify(targets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutrition_targets_${formatDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('Targets exported successfully as JSON!');
  } catch (e) {
    handleError('export-targets', e, 'Failed to export targets.');
  }
}

/**
 * Exports the user's saved food items as a CSV file.
 */
export async function exportSavedFoodsCsv() {
  if (!state.userId) return showMessage('Cannot export saved foods. Not authenticated.', true);
  try {
    const foods = Array.from(state.savedFoodItems.values());
    if (!foods.length) return showMessage('No saved food items to export.', true);

    // Define headers, including all possible nutrients.
    const headers = ['name', 'lastUpdated', ...allNutrients];
    let csv = headers.map(h => `"${h}"`).join(',') + '\n';

    // Create a row for each food item.
    foods.forEach(f => {
      const row = headers.map(h => {
        let v = f[h] ?? '';
        // Properly escape quotes within string values.
        if (typeof v === 'string') v = `"${v.replace(/"/g, '""')}"`;
        return v;
      }).join(',');
      csv += row + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved_food_items_${formatDate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('Saved food items exported successfully as CSV!');
  } catch (e) {
    handleError('export-saved-foods', e, 'Failed to export saved food items.');
  }
}

/**
 * Exports the user's entire daily log history as a CSV file.
 */
export async function exportDailyLogCsv() {
  if (!state.userId) return showMessage('Cannot export daily log. Not authenticated.', true);
  showMessage('Fetching all daily log data for export...', false, 10000); // Show a longer message

  const entries = await fetchAllEntries();
  if (!entries.length) return showMessage('No daily log data to export.', true);

  // Core columns are unchanged — old importers that stop reading at 'foodItems'
  // are unaffected by the v2 columns appended afterwards.
  const coreHeaders = ['date', ...allNutrients, 'foodItems'];
  // Full v2 column set, in a stable order for diffable exports.
  const v2Headers = [
    'schemaVersion',
    'entryType',
    'dayActivityLevel',
    'vacationDayType',
    'manualLock',
    'exerciseSessions',
    'calorieAdjustmentItems',
    'estimateMeta',
  ];
  const headers = [...coreHeaders, ...v2Headers];
  let csv = headers.map(h => `"${h}"`).join(',') + '\n';

  // entries from fetchAllEntries() are already normalized, so all v2 fields exist.
  entries.forEach(e => {
    const row = headers.map(h => {
      // Arrays and objects are serialized as JSON strings inside the CSV cell.
      if (h === 'foodItems') {
        return `"${JSON.stringify(e.foodItems || []).replace(/"/g, '""')}"`;
      }
      if (h === 'exerciseSessions') {
        return `"${JSON.stringify(e.exerciseSessions || []).replace(/"/g, '""')}"`;
      }
      if (h === 'calorieAdjustmentItems') {
        return `"${JSON.stringify(e.calorieAdjustmentItems || []).replace(/"/g, '""')}"`;
      }
      if (h === 'estimateMeta') {
        return `"${JSON.stringify(e.estimateMeta ?? null).replace(/"/g, '""')}"`;
      }
      // Boolean
      if (h === 'manualLock') return e.manualLock ? 'true' : 'false';
      // Numeric schema version
      if (h === 'schemaVersion') return e.schemaVersion ?? '0';
      // Nullable string fields
      if (h === 'entryType' || h === 'dayActivityLevel' || h === 'vacationDayType') {
        const v = e[h] ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }
      let v = e[h] ?? '0';
      if (typeof v === 'string') v = `"${v.replace(/"/g, '""')}"`;
      return v;
    });
    csv += row.join(',') + '\n';
  });

  // Use a data URI to trigger the download.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nutrition_daily_log_export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMessage('Daily log export complete!', false);
}
