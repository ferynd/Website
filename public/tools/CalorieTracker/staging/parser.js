/**
 * @file src/staging/parser.js
 * @description Handles parsing nutrient text and managing the staging area actions.
 */

import { allNutrients, SCHEMA_VERSIONS } from '../constants.js';
import { showMessage, flushPendingUndo, flashSaveConfirmation } from '../utils/ui.js';
import { state, parseQty } from '../state/store.js';
import { saveDailyEntry, saveTargets } from '../services/firebase.js';
import { clearStagingArea, updateFoodItemsList, getCurrentDailyEntry } from '../services/data.js';
import { showConfirmationModal } from '../ui/modals.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { resolveNutrientWriteVersion } from '../../../shared/nutrition/capabilities.js';
import { LEGACY_V1_KEYS, V2_KEYS, getNutrient } from '../../../shared/nutrition/nutrientRegistry.js';
import { parseNutritionText } from '../../../shared/nutrition/nutrientText.js';
import {
  applyLegacyInputOverlay,
  buildFoodWrite,
  targetsFromStagedRecord,
  v1StorageNotice,
} from '../nutrition/nutrientRecord.js';
import { renderNutrientDetail, setNutrientConflictsBlocked } from '../ui/nutrientDetail.js';

const PARSER_CONFIG = {
  DEFAULT_QUANTITY: 1
};

const WARN_MAX_SHOWN = 10;

function getStagedQuantity() {
  return parseQty(document.getElementById('actual-quantity')?.value) || PARSER_CONFIG.DEFAULT_QUANTITY;
}

function writeVersion() {
  return resolveNutrientWriteVersion();
}

function renderParseFeedback(record) {
  const warningEl = document.getElementById('parse-missing-warning');
  if (!warningEl) return;
  warningEl.replaceChildren();
  const blocked = record.conflicts.length > 0;
  setNutrientConflictsBlocked(blocked);

  const lines = [];
  if (record.unknownLabels.length) lines.push(`Unknown labels: ${record.unknownLabels.join(', ')}.`);
  for (const warning of record.warnings) {
    if (warning.level === 'review' && warning.code !== 'unknown_label') lines.push(warning.message);
  }
  const absent = LEGACY_V1_KEYS.filter((key) => record.values[key] == null && !record.conflicts.some((conflict) => conflict.key === key));
  if (absent.length > 0) {
    const shown = absent.slice(0, WARN_MAX_SHOWN).map((key) => getNutrient(key)?.label || key).join(', ');
    const overflow = absent.length - WARN_MAX_SHOWN;
    const suffix = overflow > 0 ? ` (+ ${overflow} more)` : '';
    lines.push(`No value detected for: ${shown}${suffix}. Review parsed nutrients before adding if this looks wrong.`);
  }

  if (lines.length === 0 && !blocked) {
    warningEl.classList.add('hidden');
    return;
  }
  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    warningEl.appendChild(paragraph);
  }
  if (blocked) {
    const note = document.createElement('p');
    note.textContent = 'Conflicting values need a choice before Add, Save, or Replace.';
    warningEl.appendChild(note);
    for (const conflict of record.conflicts) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `${getNutrient(conflict.key)?.label || conflict.key}: `;
      row.appendChild(label);
      for (const value of conflict.values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = value == null ? 'unknown' : String(value);
        button.addEventListener('click', () => {
          record.values[conflict.key] = value;
          record.conflicts = record.conflicts.filter((item) => item.key !== conflict.key);
          record.quality[conflict.key] = value == null ? { status: 'unknown' } : { status: 'label_reported' };
          const input = document.getElementById(`actual-${conflict.key}`);
          if (input) input.value = value == null ? '' : String(value);
          state.stagedRecord = record;
          renderParseFeedback(record);
          renderNutrientDetail(document.getElementById('nutrient-detail-staging'), record);
        });
        row.appendChild(button);
      }
      warningEl.appendChild(row);
    }
  }
  warningEl.classList.remove('hidden');
}

function countParsed(record) {
  return V2_KEYS.filter((key) => {
    const value = record.values[key];
    return (typeof value === 'number' && Number.isFinite(value)) || record.quality[key]?.upperBound != null;
  }).length;
}

/**
 * Parses text from the paste area and populates the staging input fields.
 */
export function parseAndStage() {
  const text = document.getElementById('paste-area').value;
  const warningEl = document.getElementById('parse-missing-warning');

  if (!text) {
    if (warningEl) {
      warningEl.replaceChildren();
      warningEl.classList.add('hidden');
    }
    return showMessage('Paste area is empty.', true);
  }

  allNutrients.forEach(n => {
    const input = document.getElementById(`actual-${n}`);
    if (input) input.value = '';
  });

  const record = parseNutritionText(text);
  state.stagedRecord = record;
  for (const key of LEGACY_V1_KEYS) {
    const input = document.getElementById(`actual-${key}`);
    if (!input) continue;
    const value = record.values[key];
    input.value = value == null ? '' : String(value);
  }
  renderParseFeedback(record);
  renderNutrientDetail(document.getElementById('nutrient-detail-staging'), record);

  const valuesFound = countParsed(record);
  if (valuesFound > 0) showMessage(`Parsed and staged ${valuesFound} fields.`);
  else showMessage('Could not find any recognizable nutrient values.', true);
}

/** Full staged record. Blank inputs stay null. Manual edits overlay the 24 legacy fields. */
export function getStagedRecord() {
  const inputs = {};
  for (const key of LEGACY_V1_KEYS) {
    const input = document.getElementById(`actual-${key}`);
    if (input) inputs[key] = input.value;
  }
  const record = applyLegacyInputOverlay(state.stagedRecord, inputs);
  state.stagedRecord = record;
  return record;
}

/**
 * Gathers all values currently in the staging area input fields.
 * @returns {object} Legacy keys mapped to clamped numbers. Nulls become 0.
 */
export function getStagedValues() {
  return targetsFromStagedRecord(getStagedRecord());
}

function blockedByConflicts(record) {
  if (!record?.conflicts?.length) return false;
  showMessage('Resolve conflicting nutrient values before continuing.', true);
  return true;
}

function findDailyDuplicate(name, calories) {
  const lowerName = name.toLowerCase();
  return state.dailyFoodItems.find(
    item => (item.name || '').toLowerCase() === lowerName
         && Math.round(parseFloat(item.calories) || 0) === Math.round(parseFloat(calories) || 0)
  ) || null;
}

function applyLegacyDelta(entry, fields, qty, sign) {
  for (const key of LEGACY_V1_KEYS) {
    const amount = typeof fields[key] === 'number' && Number.isFinite(fields[key]) ? fields[key] : 0;
    const next = (parseFloat(entry[key]) || 0) + sign * qty * amount;
    entry[key] = sign < 0 ? Math.max(0, next) : next;
  }
}

function foodFields(record, foodName, qty) {
  return buildFoodWrite(record, {
    writeVersion: writeVersion(),
    name: foodName,
    quantity: qty,
    lastUpdated: new Date().toISOString(),
  });
}

function dayItemFromFields(fields, foodName, qty) {
  const item = {
    id: crypto.randomUUID(),
    name: foodName,
    quantity: qty,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  if (writeVersion() === 2) {
    item.nutrientSchemaVersion = 2;
  }
  return item;
}

async function commitStagedToLog(record, qty, foodName) {
  flushPendingUndo();

  const dateStr = state.dom.dateInput.value;
  const todayEntry = getCurrentDailyEntry();
  const built = foodFields(record, foodName, qty);
  applyLegacyDelta(todayEntry, built.fields, qty, 1);

  state.dailyFoodItems.push(dayItemFromFields(built.fields, foodName, qty));

  await saveDailyEntry(dateStr, todayEntry);
  const notice = writeVersion() === 1 ? v1StorageNotice(built) : '';
  showMessage(notice ? `Staged nutrients added to today's log! ${notice}` : "Staged nutrients added to today's log!");
  flashSaveConfirmation(document.getElementById('add-day-btn'));
  clearStagingArea();

  updateDashboard();
  updateChart();
  updateFoodItemsList();
}

export async function addStagedNutrientsToDailyLog() {
  const record = getStagedRecord();
  if (blockedByConflicts(record)) return;
  const staged = targetsFromStagedRecord(record);
  const qty = getStagedQuantity();
  const foodName = document.getElementById('food-item-input')?.value.trim() || '(Staged Entry)';

  const dup = findDailyDuplicate(foodName, staged.calories);
  if (dup) {
    const dupQty = parseQty(dup.quantity);
    const dupCals = Math.round(dupQty * (parseFloat(dup.calories) || 0));
    showConfirmationModal(
      `"${foodName}" (${dupCals} cal) is already in today's log. Add it again?`,
      () => commitStagedToLog(record, qty, foodName)
    );
    return;
  }

  await commitStagedToLog(record, qty, foodName);
}

export async function subtractStagedNutrientsFromDailyLog() {
  flushPendingUndo();
  const record = getStagedRecord();
  if (blockedByConflicts(record)) return;

  const dateStr = state.dom.dateInput.value;
  const todayEntry = getCurrentDailyEntry();
  const qty = getStagedQuantity();
  const built = foodFields(record, 'subtract', qty);
  applyLegacyDelta(todayEntry, built.fields, qty, -1);

  const negative = {};
  for (const [key, value] of Object.entries(built.fields)) {
    negative[key] = typeof value === 'number' ? -value : value;
  }
  const foodName = document.getElementById('food-item-input')?.value.trim() || '(Staged Subtraction)';
  state.dailyFoodItems.push(dayItemFromFields(negative, `${foodName} (subtracted)`, qty));

  await saveDailyEntry(dateStr, todayEntry);
  showMessage("Staged nutrients subtracted from today's log!");
  clearStagingArea();

  updateDashboard();
  updateChart();
  updateFoodItemsList();
}

export function handleStagingAction(mode) {
  const record = getStagedRecord();
  if (blockedByConflicts(record)) return;
  const staged = targetsFromStagedRecord(record);
  const dateStr = state.dom.dateInput.value;

  if (mode === 'updateTargets') {
    showConfirmationModal('Update your baseline targets with these staged values?', async () => {
      await saveTargets(staged);
      showMessage('Targets saved successfully!');
      updateDashboard();
      updateChart();
    });
    return;
  }

  if (mode === 'replace') {
    showConfirmationModal(`Replace all of ${dateStr} with staged values? This will overwrite existing data for this day.`, async () => {
      flushPendingUndo();

      const qty = getStagedQuantity();
      const built = foodFields(record, 'replace', qty);
      const newEntry = {
        date: dateStr,
        schemaVersion: SCHEMA_VERSIONS.ENTRY,
        entryType: 'logged',
        exerciseSessions: [],
        dayActivityLevel: null,
        vacationDayType: null,
        manualLock: false,
        calorieAdjustmentItems: [],
        estimateMeta: null,
      };
      for (const key of LEGACY_V1_KEYS) {
        const amount = typeof built.fields[key] === 'number' ? built.fields[key] : 0;
        newEntry[key] = qty * amount;
      }

      const foodName = document.getElementById('food-item-input')?.value.trim() || '(Replaced Day)';
      state.dailyFoodItems = [dayItemFromFields(built.fields, foodName, qty)];

      await saveDailyEntry(dateStr, newEntry);
      const notice = writeVersion() === 1 ? v1StorageNotice(built) : '';
      showMessage(notice ? `Day's log replaced with staged values! ${notice}` : "Day's log replaced with staged values!");
      clearStagingArea();

      updateDashboard();
      updateChart();
      updateFoodItemsList();
    });
  }
}
