/**
 * @file src/ui/chart.js
 * @description Manages the creation, updating, and rendering of the progress chart and its associated data table.
 */

import { state } from '../state/store.js';
import { CONFIG } from '../config.js';
import { allNutrients, dailyTrackedNutrients } from '../constants.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';

/**
 * Initializes the chart controls (select dropdowns, checkbox) and attaches event listeners.
 */
export function initializeChartControls() {
  const chartNutrients = document.getElementById('chart-nutrients');
  const chartTimeframe = document.getElementById('chart-timeframe');
  const show3DayAvg = document.getElementById('show-3day-avg');

  if (!chartNutrients) return; // Exit if controls are not in the DOM yet.

  // Populate the nutrient selector dropdown.
  chartNutrients.innerHTML = '';
  allNutrients.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = formatNutrientName(n);
    if (n === CONFIG.DEFAULT_CHART_NUTRIENT) opt.selected = true;
    chartNutrients.appendChild(opt);
  });

  // Set the default timeframe.
  chartTimeframe.value = CONFIG.DEFAULT_CHART_TIMEFRAME;

  // Add event listeners to update the chart when controls change.
  chartNutrients.addEventListener('change', updateChart);
  chartTimeframe.addEventListener('change', updateChart);
  show3DayAvg.addEventListener('change', updateChart);

  // Initial chart render.
  updateChart();
}

/**
 * Gathers and processes data for the chart based on selected options.
 * @param {string[]} nutrientKeys - An array of nutrient keys to display.
 * @param {string} timeframe - The selected time frame (e.g., 'week', 'month').
 * @param {boolean} [showAvg=false] - Whether to show the 3-day rolling average line.
 * @returns {object} An object containing labels, datasets, and tableData for rendering.
 */
function getChartData(nutrientKeys, timeframe, showAvg = false) {
  const endDate = new Date(`${state.dom.dateInput.value}T00:00:00`);
  let days = 7;
  if (timeframe === '3days') days = 3;
  else if (timeframe === 'week') days = 7;
  else if (timeframe === 'month') days = 30;
  else if (timeframe === 'year') days = 365;

  // Fetch extra days to calculate rolling average for the first few visible days.
  const extendedDays = days + CONFIG.CHART_AVERAGE_LOOKBACK;
  const extendedStart = getPastDate(endDate, extendedDays - 1);
  const displayStart = getPastDate(endDate, days - 1);

  const allLabels = []; // Labels for the full extended date range.
  const displayLabels = []; // Labels for the visible date range.
  const datasets = [];
  const tableData = {};

  // Populate date labels.
  for (let i = 0; i < extendedDays; i++) {
    const d = new Date(extendedStart);
    d.setDate(extendedStart.getDate() + i);
    allLabels.push(formatDate(d));
  }
  for (let i = 0; i < days; i++) {
    const d = new Date(displayStart);
    d.setDate(displayStart.getDate() + i);
    const ds = formatDate(d);
    displayLabels.push(ds);
    tableData[ds] = {};
  }

  // Generate a dataset for each selected nutrient.
  nutrientKeys.forEach((n, idx) => {
    // Data for the main bar chart (as a percentage of the baseline target).
    const displayData = displayLabels.map(ds => {
      const entry = state.dailyEntries.get(ds) || {};
      const actual = parseFloat(entry[n]) || 0;
      const baseline = parseFloat(state.baselineTargets[n]) || 1; // Avoid division by zero.
      return baseline > 0 ? (actual / baseline) * 100 : 0;
    });

    // Raw actual values for tooltips.
    const actualVals = displayLabels.map(ds => {
      const entry = state.dailyEntries.get(ds) || {};
      return parseFloat(entry[n]) || 0;
    });

    datasets.push({
      label: formatNutrientName(n),
      data: displayData,
      backgroundColor: CONFIG.CHART_COLORS[idx % CONFIG.CHART_COLORS.length],
      borderColor: CONFIG.CHART_COLORS[idx % CONFIG.CHART_COLORS.length],
      borderWidth: 1,
      actualValues: actualVals, // Custom property for tooltip formatting.
    });

    // Populate data for the summary table.
    displayLabels.forEach((ds, i) => {
      tableData[ds][n] = {
        actual: actualVals[i],
        percentage: displayData[i],
        baseline: parseFloat(state.baselineTargets[n]) || 0
      };
    });

    // If requested, add a 3-day rolling average line dataset.
    if (showAvg && !dailyTrackedNutrients.includes(n)) {
      const avgData = displayLabels.map((ds) => {
        const idxAll = allLabels.indexOf(ds);
        if (idxAll < 2) return null; // Not enough data for a 3-day average.
        let sum = 0;
        for (let j = 0; j < 3; j++) {
          const lookbackDate = allLabels[idxAll - j];
          const entry = state.dailyEntries.get(lookbackDate) || {};
          sum += parseFloat(entry[n]) || 0;
        }
        const avg = sum / 3;
        const baseline = parseFloat(state.baselineTargets[n]) || 1;
        return baseline > 0 ? (avg / baseline) * 100 : 0;
      });

      datasets.push({
        label: `${formatNutrientName(n)} (3-day avg)`,
        data: avgData,
        type: 'line',
        borderColor: CONFIG.CHART_COLORS[idx % CONFIG.CHART_COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        spanGaps: false,
        tension: 0.4,
        order: 0, // Render lines on top of bars.
      });
    }
  });

  return { labels: displayLabels, datasets, tableData };
}

/**
 * Main function to update and re-render the chart.
 */
export function updateChart() {
  if (!state.userId || Object.keys(state.baselineTargets).length === 0) return;

  const chartNutrients = document.getElementById('chart-nutrients');
  const chartTimeframe = document.getElementById('chart-timeframe');
  const show3DayAvg = document.getElementById('show-3day-avg');
  if (!chartNutrients) return;

  const selected = Array.from(chartNutrients.selectedOptions).map(o => o.value);
  const timeframe = chartTimeframe.value;
  const showAvg = show3DayAvg.checked;
  if (selected.length === 0) return;

  const { labels, datasets, tableData } = getChartData(selected, timeframe, showAvg);
  const canvas = document.getElementById('nutrition-chart');
  if (!canvas) return;

  // Destroy the old chart instance before creating a new one.
  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }

  // Create a new Chart.js instance.
  state.chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        // Add a dashed line at 100% to represent the target.
        {
          label: 'Target (100%)',
          data: new Array(labels.length).fill(100),
          type: 'line',
          borderColor: '#6B7280',
          borderDash: [5, 5],
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          order: 1,
        },
        ...datasets,
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '% of Baseline Target' } },
        x: { title: { display: true, text: 'Date' } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            // Custom tooltip to show both actual value and percentage.
            label: (ctx) => {
              if (ctx.datasetIndex === 0) return 'Target: 100%';
              const dsIdx = ctx.datasetIndex - 1;
              if (datasets[dsIdx] && datasets[dsIdx].actualValues) {
                const actual = datasets[dsIdx].actualValues[ctx.dataIndex];
                const pct = ctx.parsed.y;
                return `${ctx.dataset.label}: ${actual.toFixed(1)} (${pct.toFixed(1)}%)`;
              }
              return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
            }
          }
        },
        legend: { display: true }
      }
    }
  });

  updateChartTable(tableData, selected, labels);
}

/**
 * Renders the data table below the chart.
 * @param {object} tableData - The processed data for the table.
 * @param {string[]} nutrientKeys - The selected nutrient keys.
 * @param {string[]} labels - The date labels for the columns.
 */
export function updateChartTable(tableData, nutrientKeys, labels) {
  const tableContainer = document.getElementById('chart-table');
  if (!tableContainer || !Object.keys(tableData).length || !nutrientKeys.length) {
    if (tableContainer) tableContainer.innerHTML = '<p class="text-gray-500 text-center">No data available</p>';
    return;
  }

  let html = `
    <div class="overflow-x-auto">
      <table class="min-w-full bg-white border border-gray-300 rounded-lg">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-2 border-b text-left font-semibold text-gray-700">Nutrient</th>`;
  labels.forEach(d => html += `<th class="px-2 py-2 border-b text-center font-semibold text-gray-700 text-xs">${d}</th>`);
  html += `</tr></thead><tbody>`;

  nutrientKeys.forEach(n => {
    html += `<tr class="hover:bg-gray-50"><td class="px-4 py-2 border-b font-medium">${formatNutrientName(n)}</td>`;
    labels.forEach(d => {
      const data = tableData[d][n];
      if (data) {
        const color = (data.percentage >= 90 && data.percentage <= 110) ?
          'text-green-600' : (data.percentage >= 75 ? 'text-yellow-600' : 'text-red-600');
        html += `<td class="px-2 py-2 border-b text-center text-xs"><div>${data.actual.toFixed(1)}</div><div class="${color}">${data.percentage.toFixed(0)}%</div></td>`;
      } else {
        html += `<td class="px-2 py-2 border-b text-center text-xs">-</td>`;
      }
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  tableContainer.innerHTML = html;
}
