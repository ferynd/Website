/**
 * @file src/ui/dashboard.js
 * @description Handles rendering the main dashboard UI, including nutrient cards and calculations.
 */

import { state } from '../state/store.js';
import { allNutrients, nutrients, dailyTrackedNutrients } from '../constants.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';
import { CONFIG } from '../config.js';
import { initializeChartControls } from './chart.js';

/**
 * Helper function to get the user-defined fat minimum, with a fallback to the default.
 * @returns {number} The minimum fat target in grams.
 */
const getFatMinimum = () => parseFloat(state.baselineTargets.fatMinimum) || CONFIG.DEFAULT_FAT_MINIMUM;

/**
 * Calculates all metrics for the dashboard based on daily entries and targets.
 * @returns {object} An object containing the calculated metrics.
 */
export function calculateDashboardMetrics() {
  const todayStr = state.dom.dateInput.value;
  const today = new Date(`${todayStr}T00:00:00`);
  const yesterday = getPastDate(today, 1);

  const todayEntry = state.dailyEntries.get(formatDate(today)) || {};
  const yesterdayEntry = state.dailyEntries.get(formatDate(yesterday)) || {};

  // Helper to get a baseline target value.
  const T = (name) => parseFloat(state.baselineTargets[name] || 0);

  // Calculates the adjusted target for "averaged" nutrients.
  const calcAdjusted = (nutrient) => {
    const baselineTarget = T(nutrient);
    // If yesterday's data is missing, assume they hit the target to avoid wild swings.
    const yActual = parseFloat(yesterdayEntry[nutrient]) || baselineTarget;
    const variance = baselineTarget - yActual;
    // Today's target is adjusted by yesterday's variance.
    return Math.max(0, baselineTarget + variance);
  };

  const metrics = {};
  allNutrients.forEach(n => {
    const base = T(n);
    // "Daily" nutrients have a fixed target; others are adjusted.
    const isDaily = dailyTrackedNutrients.includes(n) || n === 'calories' || n === 'protein';
    const adjustedTarget = isDaily ? base : calcAdjusted(n);
    metrics[n] = {
      name: n,
      baselineTarget: base,
      adjustedTarget,
      actualToday: parseFloat(todayEntry[n]) || 0,
    };
  });

  // Dynamically calculate the carb target based on the remaining calorie budget.
  const adjustedCalorieTarget = metrics['calories'].adjustedTarget;
  const proteinGrams = metrics['protein'].adjustedTarget;
  const proteinCalories = proteinGrams * 4;

  let adjustedFatGrams = metrics['fat'].adjustedTarget;
  const fatMin = getFatMinimum();
  if (adjustedFatGrams < fatMin) {
    adjustedFatGrams = fatMin; // Ensure fat doesn't drop below the minimum.
  }
  const fatCalories = adjustedFatGrams * 9;

  const carbCalories = adjustedCalorieTarget - proteinCalories - fatCalories;
  const adjustedCarbGrams = Math.max(0, carbCalories / 4);

  // Update the fat and carb metrics with the newly calculated adjusted targets.
  metrics['fat'].adjustedTarget = adjustedFatGrams;
  metrics['carbs'].adjustedTarget = adjustedCarbGrams;

  // Final pass to calculate percentage and difference for each nutrient.
  for (const n in metrics) {
    const m = metrics[n];
    m.percentage = m.adjustedTarget > 0 ? (m.actualToday / m.adjustedTarget) * 100 : 0;
    m.diff = m.actualToday - m.adjustedTarget;
  }
  return { metrics };
}

/**
 * Renders the entire dashboard UI, including info boxes, charts, and nutrient cards.
 */
export function updateDashboard() {
  const { dashboard } = state.dom;

  // If user is not logged in or has no targets, show a welcome/setup message.
  if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
    dashboard.innerHTML = `
      <div class="text-center p-8 bg-white rounded-lg shadow-md">
        <h3 class="text-xl font-semibold text-gray-700">Welcome!</h3>
        <p class="mt-2 text-gray-500">Please log in and set your baseline targets to get started.</p>
        <button onclick="document.getElementById('open-settings-btn').click()"
          class="mt-4 px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">Set Targets</button>
      </div>`;
    return;
  }

  const { metrics } = calculateDashboardMetrics();

  // Template for a single nutrient card.
  const card = (m) => {
    const pct = m.percentage;
    let color = 'bg-red-500';
    if (pct >= 90 && pct <= 110) color = 'bg-green-500';
    else if (pct >= 75 || pct > 110) color = 'bg-yellow-500';

    const diffText = m.diff > 0 ? `+${m.diff.toFixed(1)}` : m.diff.toFixed(1);
    const diffColor = m.diff >= 0 ? 'text-green-600' : 'text-red-600';

    return `
      <div class="bg-white p-4 rounded-lg shadow-md nutrient-card">
        <h4 class="font-bold capitalize text-gray-800">${formatNutrientName(m.name)}</h4>
        <p class="text-sm text-gray-500">${m.actualToday.toFixed(1)} / ${m.adjustedTarget.toFixed(1)}</p>
        <div class="w-full progress-bar-bg rounded-full h-2.5 mt-2">
          <div class="progress-bar-fill h-2.5 rounded-full ${color}" style="width:${Math.min(100, pct)}%"></div>
        </div>
        <p class="text-sm font-medium text-gray-600 mt-2">Status: <span class="font-bold ${diffColor}">${diffText}</span></p>
      </div>`;
  };

  // Template for a group of nutrient cards.
  const group = (title, keys) => `
    <div class="mb-8">
      <h3 class="text-2xl font-bold text-gray-700 mb-4">${title}</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${keys.map(k => metrics[k] ? card(metrics[k]) : '').join('')}
      </div>
    </div>`;

  // Template for the informational box explaining the logic.
  const infoBox = `
    <div class="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
      <h3 class="font-semibold text-blue-900 mb-2"><i class="fas fa-info-circle mr-2"></i>How This Works</h3>
      <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
        <li><strong>Daily Nutrients:</strong> Targets for these nutrients (like Protein) are fixed each day.</li>
        <li><strong>Averaged Nutrients:</strong> Today's targets adjust based on yesterday's intake to get you back to baseline tomorrow.</li>
        <li><strong>Carbs:</strong> The carb target is dynamic, filling the remainder of your adjusted calorie budget.</li>
      </ul>
    </div>`;

  // Template for the chart section, including controls.
  const chartSection = `
    <div class="mb-8 bg-white p-6 rounded-lg shadow-lg">
      <h3 class="text-2xl font-bold text-gray-700 mb-4">Nutrition Progress Chart</h3>
      <div class="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label for="chart-nutrients" class="block text-sm font-medium text-gray-700 mb-1">Select Nutrients (hold Ctrl/Cmd for multiple)</label>
          <select id="chart-nutrients" multiple class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" size="4"></select>
        </div>
        <div>
          <label for="chart-timeframe" class="block text-sm font-medium text-gray-700 mb-1">Time Frame</label>
          <select id="chart-timeframe" class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
            <option value="3days">Last 3 Days</option>
            <option value="week">Last Week</option>
            <option value="month">Last Month</option>
            <option value="year">Last Year</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Options</label>
          <div class="flex items-center mt-2">
            <input type="checkbox" id="show-3day-avg" class="mr-2 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
            <label for="show-3day-avg" class="text-sm text-gray-700">Show 3-day average</label>
          </div>
        </div>
      </div>
      <div class="chart-container"><canvas id="nutrition-chart"></canvas></div>
      <div id="chart-table" class="mt-6"></div>
    </div>`;

  // Assemble the final HTML for the dashboard.
  state.dom.dashboard.innerHTML =
    infoBox +
    chartSection +
    group('Macronutrients', nutrients.macros) +
    group('Daily Vitamins (Fixed Target)', nutrients.vitaminsDaily) +
    group('Daily Minerals (Fixed Target)', nutrients.mineralsDaily) +
    group('Averaged Vitamins (Adjusted Target)', nutrients.vitaminsAvg) +
    group('Averaged Minerals (Adjusted Target)', nutrients.mineralsAvg) +
    group('Optional Nutrients (Adjusted Target)', nutrients.optional);

  // Initialize the chart controls now that they are in the DOM.
  initializeChartControls();
}

/**
 * Populates the settings form with the user's currently saved baseline targets.
 */
export function populateSettingsForm() {
  allNutrients.forEach(n => {
    const input = document.getElementById(`target-${n}`);
    if (input) input.value = state.baselineTargets[n] || '';
  });
  const fatMinInput = document.getElementById('target-fatMinimum');
  if (fatMinInput) {
    fatMinInput.value = state.baselineTargets.fatMinimum || CONFIG.DEFAULT_FAT_MINIMUM;
  }
}
