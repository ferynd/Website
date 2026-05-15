/**
 * @file src/staging/parser.js
 * @description Handles parsing nutrient text and managing the staging area actions.
 */

import { nutrientMap, allNutrients, SCHEMA_VERSIONS } from '../constants.js';
import { showMessage, formatNutrientName } from '../utils/ui.js';
import { state } from '../state/store.js';
import { saveDailyEntry, saveTargets } from '../services/firebase.js';
import { clearStagingArea, updateFoodItemsList, getCurrentDailyEntry } from '../services/data.js';
import { showConfirmationModal } from '../ui/modals.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';

// Configuration
const PARSER_CONFIG = {
  DEFAULT_QUANTITY: 1
};

/**
 * Parses text from the paste area and populates the staging input fields.
 * It uses a map of synonyms to identify nutrient names.
 */
const WARN_MAX_SHOWN = 10;

export function parseAndStage() {
  const text = document.getElementById('paste-area').value;
  const warningEl = document.getElementById('parse-missing-warning');

  if (!text) {
    if (warningEl) { warningEl.textContent = ''; warningEl.removeAttribute('title'); warningEl.classList.add('hidden'); }
    return showMessage('Paste area is empty.', true);
  }

  // Clear stale nutrient values so fields absent from the new text don't linger.
  // actual-quantity is intentionally preserved (user sets serving size separately).
  allNutrients.forEach(n => {
    const input = document.getElementById(`actual-${n}`);
    if (input) input.value = '';
  });

  const lines = text.split('\n');
  let valuesFound = 0;
  const parsed = new Set();

  lines.forEach(line => {
    const lowerLine = line.toLowerCase();
    for (const key in nutrientMap) {
      // Use a regex with word boundaries to avoid partial matches (e.g., 'fat' in 'fat-soluble').
      const re = new RegExp(`\\b${key}\\b`, 'i');
      if (re.test(lowerLine)) {
        // Extract the number from the line.
        let numberString = lowerLine.replace(re, '').replace(/(mg|mcg|g|kcal)/gi, '').replace(/,/g, '');
        const match = numberString.match(/-?[\d.]+/);
        if (match) {
          const nutrientKey = nutrientMap[key];
          const element = document.getElementById(`actual-${nutrientKey}`);
          if (element) {
            element.value = parseFloat(match[0]);
            valuesFound++;
            parsed.add(nutrientKey); // includes explicit zeros — they are present, not missing
          }
          break; // Move to the next line once a nutrient is found on this one.
        }
      }
    }
  });

  // Show a compact warning for nutrients absent from the pasted text.
  if (warningEl) {
    const absent = allNutrients.filter(n => !parsed.has(n));
    if (absent.length > 0) {
      const shown = absent.slice(0, WARN_MAX_SHOWN).map(formatNutrientName).join(', ');
      const overflow = absent.length - WARN_MAX_SHOWN;
      const suffix = overflow > 0 ? ` (+ ${overflow} more)` : '';
      warningEl.textContent =
        `No value detected for: ${shown}${suffix}. Review parsed nutrients before adding if this looks wrong.`;
      if (overflow > 0) {
        warningEl.title = `All missing: ${absent.map(formatNutrientName).join(', ')}`;
      } else {
        warningEl.removeAttribute('title');
      }
      warningEl.classList.remove('hidden');
    } else {
      warningEl.textContent = '';
      warningEl.removeAttribute('title');
      warningEl.classList.add('hidden');
    }
  }

  if (valuesFound > 0) {
    showMessage(`Parsed and staged ${valuesFound} fields.`);
  } else {
    showMessage('Could not find any recognizable nutrient values.', true);
  }
}

/**
 * Gathers all values currently in the staging area input fields.
 * @returns {object} An object with nutrient keys and their numeric values.
 */
export function getStagedValues() {
  const vals = {};
  allNutrients.forEach(n => {
    const input = document.getElementById(`actual-${n}`);
    if (input) vals[n] = parseFloat(input.value) || 0;
  });
  return vals;
}

/**
 * Adds the staged nutrient values to the current day's log.
 */
export async function addStagedNutrientsToDailyLog() {
  const staged = getStagedValues();
  const dateStr = state.dom.dateInput.value;
  // getCurrentDailyEntry always returns a v2-shaped entry (creates one if needed).
  const todayEntry = getCurrentDailyEntry();
  const qty = parseFloat(document.getElementById('actual-quantity')?.value) || PARSER_CONFIG.DEFAULT_QUANTITY;

  // Add staged values to the existing daily totals with quantity.
  allNutrients.forEach(n => todayEntry[n] = (parseFloat(todayEntry[n]) || 0) + (qty * (staged[n] || 0)));

  // Create a food item record for this addition.
  const foodName = document.getElementById('food-item-input')?.value.trim() || '(Staged Entry)';
  const foodItem = { id: crypto.randomUUID(), name: foodName, quantity: qty, timestamp: new Date().toISOString(), ...staged };
  state.dailyFoodItems.push(foodItem);

  await saveDailyEntry(dateStr, todayEntry);
  showMessage("Staged nutrients added to today's log!");
  clearStagingArea();

  // Refresh UI.
  updateDashboard();
  updateChart();
  updateFoodItemsList();
}

/**
 * Subtracts the staged nutrient values from the current day's log.
 */
export async function subtractStagedNutrientsFromDailyLog() {
  const staged = getStagedValues();
  const dateStr = state.dom.dateInput.value;
  // getCurrentDailyEntry always returns a v2-shaped entry (creates one if needed).
  const todayEntry = getCurrentDailyEntry();
  const qty = parseFloat(document.getElementById('actual-quantity')?.value) || PARSER_CONFIG.DEFAULT_QUANTITY;

  // Subtract staged values, ensuring totals don't go below zero.
  allNutrients.forEach(n => todayEntry[n] = Math.max(0, (parseFloat(todayEntry[n]) || 0) - (qty * (staged[n] || 0))));

  // Create a food item record for this subtraction with negative values.
  const negativeStaged = Object.fromEntries(Object.entries(staged).map(([k, v]) => [k, -(qty * (v || 0))]));
  const foodName = document.getElementById('food-item-input')?.value.trim() || '(Staged Subtraction)';
  const foodItem = { id: crypto.randomUUID(), name: `${foodName} (subtracted)`, quantity: qty, timestamp: new Date().toISOString(), ...negativeStaged };
  state.dailyFoodItems.push(foodItem);

  await saveDailyEntry(dateStr, todayEntry);
  showMessage("Staged nutrients subtracted from today's log!");
  clearStagingArea();

  // Refresh UI.
  updateDashboard();
  updateChart();
  updateFoodItemsList();
}

/**
 * Handles actions that use the staging area values, like replacing a day's log or updating baseline targets.
 * @param {string} mode - The action to perform ('replace' or 'updateTargets').
 */
export function handleStagingAction(mode) {
  const staged = getStagedValues();
  const dateStr = state.dom.dateInput.value;

  if (mode === 'updateTargets') {
    showConfirmationModal('Update your baseline targets with these staged values?', async () => {
      await saveTargets(staged);
      showMessage('Targets saved successfully!');
      // Refresh UI after updating targets.
      updateDashboard();
      updateChart();
    });
    return;
  }

  if (mode === 'replace') {
    showConfirmationModal(`Replace all of ${dateStr} with staged values? This will overwrite existing data for this day.`, async () => {
      const qty = parseFloat(document.getElementById('actual-quantity')?.value) || PARSER_CONFIG.DEFAULT_QUANTITY;
      // Start with v2 defaults so the replaced entry retains schema compliance.
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
      allNutrients.forEach(n => newEntry[n] = qty * (staged[n] || 0));

      // Create a single food item record representing the entire day's replacement.
      const foodName = document.getElementById('food-item-input')?.value.trim() || '(Replaced Day)';
      state.dailyFoodItems = [{ id: crypto.randomUUID(), name: foodName, quantity: qty, timestamp: new Date().toISOString(), ...staged }];

      await saveDailyEntry(dateStr, newEntry);
      showMessage("Day's log replaced with staged values!");
      clearStagingArea();

      // Refresh UI.
      updateDashboard();
      updateChart();
      updateFoodItemsList();
    });
  }
}
