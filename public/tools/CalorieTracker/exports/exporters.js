/**
 * @file src/exports/exporters.js
 * @description Contains functions for exporting user data to JSON and CSV formats.
 */

import { state } from '../state/store.js';
import { formatDate } from '../utils/time.js';
import { showMessage, handleError } from '../utils/ui.js';
import { fetchTargets, fetchAllEntries, db } from '../services/firebase.js';
import { allNutrients, NUTRIENT_MAX_BOUNDS } from '../constants.js';
import { appId } from '../config.js';
import { parseQty } from '../state/store.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

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
    const headers = ['name', 'quantity', 'lastUpdated', ...allNutrients];
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
  // Convenience flat columns extracted from estimateMeta for easy spreadsheet use.
  const estimateHeaders = [
    'estimateConfidence',
    'estimateMethod',
    'estimateLocked',
  ];
  const headers = [...coreHeaders, ...v2Headers, ...estimateHeaders];
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
      // Flat estimate metadata convenience columns
      if (h === 'estimateConfidence') {
        const v = e.estimateMeta?.confidence ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }
      if (h === 'estimateMethod') {
        const v = e.estimateMeta?.method ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }
      if (h === 'estimateLocked') return e.estimateMeta?.locked ? 'true' : 'false';
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

function parseCsvRow(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

function clampNutrientSilent(nutrient, raw) {
  if (Number.isNaN(raw) || raw < 0) return 0;
  const max = NUTRIENT_MAX_BOUNDS[nutrient];
  return (max != null && raw > max) ? max : raw;
}

function normalizeHeader(h) {
  return h.replace(/^﻿/, '').trim().replace(/\s+/g, '').toLowerCase();
}

export async function importSavedFoodsCsv(file) {
  if (!state.userId) return showMessage('Cannot import foods. Not authenticated.', true);
  if (!file) return;

  let text = await file.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return showMessage('CSV file is empty or has no data rows.', true);

  const rawHeaders = parseCsvRow(lines[0]);
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  const nutrientSet = new Set(allNutrients);
  const canonicalMap = new Map();
  allNutrients.forEach(n => canonicalMap.set(n.toLowerCase(), n));
  canonicalMap.set('quantity', 'quantity');

  const nameIdx = normalizedHeaders.indexOf('name');
  if (nameIdx < 0) return showMessage('CSV must have a "name" column.', true);

  const columnMap = normalizedHeaders.map((nh) => {
    if (nh === 'name' || nh === 'lastupdated') return nh;
    return canonicalMap.get(nh) || null;
  });

  const qtyColIdx = columnMap.indexOf('quantity');

  let imported = 0;
  let skipped = 0;
  let clamped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const name = (cells[nameIdx] || '').trim();
    if (!name) { skipped++; continue; }

    const foodData = { name, lastUpdated: new Date().toISOString() };

    if (qtyColIdx >= 0) {
      foodData.quantity = parseQty(cells[qtyColIdx]);
    } else {
      foodData.quantity = 0;
    }

    columnMap.forEach((canonical, idx) => {
      if (!canonical || canonical === 'name' || canonical === 'lastupdated' || canonical === 'quantity') return;
      if (!nutrientSet.has(canonical)) return;
      const raw = parseFloat(cells[idx]);
      if (isNaN(raw)) return;
      const val = clampNutrientSilent(canonical, raw);
      if (val !== raw) clamped++;
      foodData[canonical] = val;
    });

    const foodId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    try {
      await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/foodItems`, foodId), foodData);
      state.savedFoodItems.set(foodId, foodData);
      imported++;
    } catch (e) {
      handleError('import-food-row', e, `Failed to import "${name}"`);
      skipped++;
    }
  }

  let msg = `Import complete: ${imported} food(s) imported, ${skipped} skipped.`;
  if (clamped > 0) msg += ` ${clamped} value(s) clamped to bounds.`;
  showMessage(msg);
}
