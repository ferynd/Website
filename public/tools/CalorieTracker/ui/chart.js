/**
 * @file src/ui/chart.js
 * @description Complete chart rendering with working tooltips in target|actual|delta format
 */

import { state } from '../state/store.js';
import { CONFIG } from '../config.js';
import { allNutrients, averagedNutrients } from '../constants.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';
import { resolveRange, initDateRangeEvents, daysBetween } from './dateRange.js';
import { getEntryExerciseKcal } from '../exercise/met.js';
import { resolveWeightKg } from './nutrientHelpers.js';
import { resolveDailyBaseTargets } from '../targets/dailyTargetResolver.js';

// =========================
// CONFIGURATION (Top of file for easy modification)
// =========================
const CHART_CONFIG = {
  // Visual effects
  SHADOW_CONFIG: {
    color: 'rgba(0,0,0,0.3)',
    blur: 4,
    offsetX: 1,
    offsetY: 1
  },
  
  // Tooltip styling (structural defaults; colors resolved at render time via getTooltipConfig)
  TOOLTIP_STRUCTURAL: {
    borderWidth: 1,
    cornerRadius: 8,
    displayColors: true,
    bodySpacing: 4,
    padding: 10,
  },
  
  // Chart behavior
  DEFAULT_NUTRIENT: 'calories',
  DEFAULT_TIMEFRAME: 'week',
  ENABLE_DEBUG_LOGGING: false
};

// Pull border color token for target line
const css = getComputedStyle(document.documentElement);
const borderColor = `hsl(${css.getPropertyValue('--border').trim()})`;

export function getTooltipConfig() {
  const cs = getComputedStyle(document.documentElement);
  return {
    ...CHART_CONFIG.TOOLTIP_STRUCTURAL,
    backgroundColor: `hsl(${cs.getPropertyValue('--surface-1').trim()})`,
    titleColor: `hsl(${cs.getPropertyValue('--text').trim()})`,
    bodyColor: `hsl(${cs.getPropertyValue('--text').trim()})`,
    borderColor: `hsl(${cs.getPropertyValue('--border').trim()})`,
  };
}

// Chart colors are provided by CONFIG.CHART_COLORS

// ---------------------------------------------------------------------------
// Module-level chart state — persists across re-renders of the Nutrients tab
// ---------------------------------------------------------------------------
const _chartState = {
  selectedNutrients: new Set([CHART_CONFIG.DEFAULT_NUTRIENT]),
  timeframe: CHART_CONFIG.DEFAULT_TIMEFRAME,
  show3Day: false,
  show7Day: false,
};

// =========================
// HELPER FUNCTIONS
// =========================

/**
 * Logs debug information if debugging is enabled
 * @param {string} operation - The operation being performed
 * @param {*} data - Data to log
 */
function debugLog(operation, data) {
  if (CHART_CONFIG.ENABLE_DEBUG_LOGGING && CONFIG.DEBUG_MODE) {
    console.log(`📊 [CHART][${operation}]`, data);
  }
}

/**
 * Handles errors in chart operations
 * @param {string} operation - The operation that failed
 * @param {Error} error - The error object
 */
function handleChartError(operation, error) {
  console.error(`❌ [CHART-ERROR][${operation}]`, error);
  const errorDiv = document.getElementById('chart-error-display');
  if (errorDiv) {
    errorDiv.innerHTML = `
      <div class="p-4 border surface-1 rounded-lg">
        <p class="text-negative font-medium">Chart Error in ${operation}</p>
        <p class="text-negative text-sm">${error.message}</p>
      </div>
    `;
  }
}

/**
 * Adjusts color brightness for line variations
 * @param {string} color - Hex color string
 * @param {number} amount - Amount to adjust (-255 to +255)
 * @returns {string} Adjusted hex color
 */
function adjustColor(color, amount) {
  try {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch (error) {
    handleChartError('color-adjustment', error);
    return color; // Return original color if adjustment fails
  }
}

// =========================
// CHART INITIALIZATION
// =========================

/**
 * Initialize chart controls with chip-based nutrient picker and set up event listeners.
 */
export function initializeChartControls() {
  try {
    debugLog('init-controls', 'Starting chart controls initialization');

    const chipContainer = document.getElementById('chart-nutrient-chips');
    const show3DayAvg = document.getElementById('show-3day-avg');
    const show7DayAvg = document.getElementById('show-7day-avg');

    if (!chipContainer) {
      debugLog('init-controls', 'chart-nutrient-chips not in DOM – skipping init');
      return;
    }

    chipContainer.innerHTML = '';
    allNutrients.forEach(nutrient => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chart-chip';
      btn.dataset.nutrient = nutrient;
      btn.textContent = formatNutrientName(nutrient);
      if (_chartState.selectedNutrients.has(nutrient)) btn.classList.add('active');
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        if (btn.classList.contains('active')) {
          _chartState.selectedNutrients.add(nutrient);
        } else {
          _chartState.selectedNutrients.delete(nutrient);
        }
        try { updateChart(); } catch (err) { handleChartError('chip-click', err); }
      });
      chipContainer.appendChild(btn);
    });

    if (show3DayAvg)   show3DayAvg.checked   = _chartState.show3Day;
    if (show7DayAvg)   show7DayAvg.checked   = _chartState.show7Day;

    const safe = (el, ev, fn) => {
      if (el) el.addEventListener(ev, e => { try { fn(e); } catch (err) { handleChartError('event-handler', err); } });
    };
    safe(show3DayAvg,   'change', (e) => { _chartState.show3Day  = e.target.checked; updateChart(); });
    safe(show7DayAvg,   'change', (e) => { _chartState.show7Day  = e.target.checked; updateChart(); });

    initDateRangeEvents('nutrient-chart', () => { try { updateChart(); } catch (err) { handleChartError('date-range', err); } });

    debugLog('init-controls', 'Chart controls initialized successfully');
    updateChart();

  } catch (error) {
    handleChartError('init-controls', error);
  }
}

// =========================
// DATA PROCESSING
// =========================

/**
 * Get chart data for selected nutrients and timeframe
 * @param {string[]} nutrientKeys - Selected nutrients to display
 * @param {string} timeframe - Time period to show
 * @param {boolean} show3Day - Show 3-day average lines
 * @param {boolean} show7Day - Show 7-day average lines
 * @returns {Object} Chart data object
 */
function getChartData(nutrientKeys, timeframe, show3Day = false, show7Day = false) {
  try {
    debugLog('get-data', { nutrientKeys, timeframe, show3Day, show7Day });

    const range = resolveRange('nutrient-chart');
    const endDate = new Date(`${range.endDate}T00:00:00`);

    let days;
    if (typeof timeframe === 'number') {
      days = timeframe;
    } else {
      days = daysBetween(range.startDate, range.endDate);
    }

    // Get extra days for moving averages
    const maxAvgDays = Math.max(show3Day ? 3 : 0, show7Day ? 7 : 0);
    const totalDaysNeeded = days + maxAvgDays - 1;
    
    const allLabels = [];
    const displayLabels = [];
    const datasets = [];
    const tableData = {};

    for (let i = totalDaysNeeded - 1; i >= 0; i--) {
      allLabels.push(formatDate(getPastDate(endDate, i)));
    }
    for (let i = days - 1; i >= 0; i--) {
      const dateStr = formatDate(getPastDate(endDate, i));
      displayLabels.push(dateStr);
      tableData[dateStr] = {};
    }

    // Resolve weight once for all calorie-target calculations (approximation for history)
    const weightKg = resolveWeightKg();

    const isAutoGoal = (state.goalSettings?.targetMode === 'autoGoal');

    // Resolve exerciseAddMode once from today's target so the chart agrees with Today/Energy.
    // When TDEE source is empirical_observed or empirical, historical activity is already
    // baked in and adding logged exercise would double-count it.
    const chartExerciseAddMode = isAutoGoal
      ? (resolveDailyBaseTargets(displayLabels[displayLabels.length - 1] ?? formatDate(new Date()), state).exerciseAddMode ?? 'add')
      : 'add';

    nutrientKeys.forEach((nutrient, idx) => {
      const color = CONFIG.CHART_COLORS[idx % CONFIG.CHART_COLORS.length];
      const baseTarget = parseFloat(state.baselineTargets[nutrient]) || 1;
      const getDateTarget = (dateStr) => {
        if (nutrient === 'calories') {
          const calBase = isAutoGoal
            ? (parseFloat(resolveDailyBaseTargets(dateStr, state).targets?.calories) || baseTarget)
            : baseTarget;
          const exerciseKcal = chartExerciseAddMode === 'skip'
            ? 0
            : getEntryExerciseKcal(state.dailyEntries.get(dateStr) || {}, weightKg);
          return calBase + exerciseKcal;
        }
        if (isAutoGoal) {
          const resolved = parseFloat(resolveDailyBaseTargets(dateStr, state).targets?.[nutrient]);
          return resolved > 0 ? resolved : baseTarget;
        }
        return baseTarget;
      };

      // Per-date target values (used for % bars, tooltips, and the data table)
      const targetValues = displayLabels.map(dateStr => getDateTarget(dateStr));

      // Main bar data (actual values as percentage of per-date target)
      const actualValues = displayLabels.map(dateStr => {
        const entry = state.dailyEntries.get(dateStr) || {};
        return parseFloat(entry[nutrient]) || 0;
      });

      const actualData = displayLabels.map((dateStr, i) => {
        const t = targetValues[i];
        return t > 0 ? (actualValues[i] / t) * 100 : 0;
      });

      // Add main bar dataset with metadata for tooltips
      datasets.push({
        label: formatNutrientName(nutrient),
        data: actualData,
        backgroundColor: color + '80', // Semi-transparent
        borderColor: color,
        borderWidth: 1,
        type: 'bar',
        order: 3, // Bars in back
        // Metadata for tooltip system
        _nutrient: nutrient,
        _target: baseTarget,        // fallback / non-date-sensitive reference
        _targetValues: targetValues, // per-date targets for accurate tooltip deltas
        _actualValues: actualValues,
        _isAverage: false
      });

      // Populate table data with per-date targets
      displayLabels.forEach((dateStr, i) => {
        tableData[dateStr][nutrient] = {
          actual: actualValues[i],
          percentage: actualData[i],
          target: targetValues[i]
        };
      });

      // Add 3-day average line if requested
      if (show3Day) {
        const avg3Data = [];
        const avg3Values = [];
        
        displayLabels.forEach((dateStr, displayIdx) => {
          const allIdx = allLabels.indexOf(dateStr);
          if (allIdx < 2) {
            avg3Data.push(null);
            avg3Values.push(null);
            return;
          }
          
          let sum = 0;
          for (let j = 0; j < 3; j++) {
            const avgDateStr = allLabels[allIdx - j];
            const entry = state.dailyEntries.get(avgDateStr) || {};
            sum += parseFloat(entry[nutrient]) || 0;
          }
          const avg = sum / 3;
          avg3Data.push(targetValues[displayIdx] > 0 ? (avg / targetValues[displayIdx]) * 100 : 0);
          avg3Values.push(avg);
        });

        datasets.push({
          label: `${formatNutrientName(nutrient)} (3-day avg)`,
          data: avg3Data,
          type: 'line',
          borderColor: adjustColor(color, -30),
          backgroundColor: 'transparent',
          borderWidth: 3,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          tension: 0.4,
          order: 1,
          // Metadata for tooltip system
          _nutrient: nutrient,
          _target: baseTarget,
          _targetValues: targetValues,
          _actualValues: avg3Values,
          _isAverage: true,
          _avgType: '3-day'
        });
      }

      // Add 7-day average line if requested
      if (show7Day) {
        const avg7Data = [];
        const avg7Values = [];
        
        displayLabels.forEach((dateStr, displayIdx) => {
          const allIdx = allLabels.indexOf(dateStr);
          if (allIdx < 6) {
            avg7Data.push(null);
            avg7Values.push(null);
            return;
          }
          
          let sum = 0;
          for (let j = 0; j < 7; j++) {
            const avgDateStr = allLabels[allIdx - j];
            const entry = state.dailyEntries.get(avgDateStr) || {};
            sum += parseFloat(entry[nutrient]) || 0;
          }
          const avg = sum / 7;
          avg7Data.push(targetValues[displayIdx] > 0 ? (avg / targetValues[displayIdx]) * 100 : 0);
          avg7Values.push(avg);
        });

        datasets.push({
          label: `${formatNutrientName(nutrient)} (7-day avg)`,
          data: avg7Data,
          type: 'line',
          borderColor: adjustColor(color, 30),
          backgroundColor: 'transparent',
          borderWidth: 3,
          fill: false,
          pointRadius: 0,
          spanGaps: false,
          tension: 0.4,
          order: 2,
          // Metadata for tooltip system
          _nutrient: nutrient,
          _target: baseTarget,
          _targetValues: targetValues,
          _actualValues: avg7Values,
          _isAverage: true,
          _avgType: '7-day'
        });
      }
    });

    debugLog('get-data-success', { 
      labels: displayLabels.length, 
      datasets: datasets.length,
      tableData: Object.keys(tableData).length
    });

    return { labels: displayLabels, datasets, tableData };

  } catch (error) {
    handleChartError('get-data', error);
    return { labels: [], datasets: [], tableData: {} };
  }
}

// =========================
// MAIN CHART UPDATE FUNCTION
// =========================

/**
 * Update and render the chart with proper error handling
 */
export function updateChart() {
  try {
    debugLog('update-chart', 'Starting chart update');

    // Validation checks
    if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
      debugLog('update-chart', 'Skipping update - no user data');
      return;
    }

    const show3DayAvg = document.getElementById('show-3day-avg');
    const show7DayAvg = document.getElementById('show-7day-avg');

    const chipContainer = document.getElementById('chart-nutrient-chips');
    if (!chipContainer) {
      debugLog('update-chart', 'chart-nutrient-chips not in DOM – skipping update');
      return;
    }

    const activeChips = chipContainer.querySelectorAll('.chart-chip.active');
    if (!activeChips.length) {
      if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
      }
      const tableContainer = document.getElementById('chart-table');
      if (tableContainer) {
        tableContainer.innerHTML = '<p class="text-muted text-center py-4">Select at least one nutrient above to show the chart.</p>';
      }
      return;
    }

    const selectedNutrients = Array.from(activeChips).map(c => c.dataset.nutrient);
    const range = resolveRange('nutrient-chart');
    const days = daysBetween(range.startDate, range.endDate);
    const show3Day = show3DayAvg?.checked || false;
    const show7Day = show7DayAvg?.checked || false;

    const { labels, datasets, tableData } = getChartData(selectedNutrients, days, show3Day, show7Day);
    const isAutoGoalMode = (state.goalSettings?.targetMode === 'autoGoal');
    const canvas = document.getElementById('nutrition-chart');
    
    if (!canvas) {
      debugLog('update-chart', 'Chart canvas not in DOM – skipping update');
      return;
    }

    // Destroy existing chart
    if (state.chartInstance) {
      state.chartInstance.destroy();
      state.chartInstance = null;
    }

    // Create new chart with working tooltips
    state.chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          // Target line at 100%
          {
            label: isAutoGoalMode ? 'Auto-goal target (100%)' : 'Manual target (100%)',
            data: new Array(labels.length).fill(100),
            type: 'line',
            borderColor: borderColor,
            borderDash: [5, 5],
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            order: 0,
            _isTargetLine: true // Special marker for tooltip filtering
          },
          ...datasets
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        scales: {
          y: { 
            beginAtZero: true, 
            title: { 
              display: true, 
              text: '% of Target',
              font: { weight: 'bold' }
            },
            grid: {
              color: 'rgba(0,0,0,0.1)'
            }
          },
          x: { 
            title: { 
              display: true, 
              text: 'Date',
              font: { weight: 'bold' }
            },
            grid: {
              display: false
            },
            ticks: {
              callback: function(value, index, values) {
                const date = new Date(`${this.getLabelForValue(value)}T00:00:00`);
                return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              }
            }
          }
        },
        plugins: {
          tooltip: {
            ...getTooltipConfig(),
            filter: function(tooltipItem) {
              return !tooltipItem.dataset._isTargetLine && !tooltipItem.dataset._isAverage;
            },
            callbacks: {
              title: function(tooltipItems) {
                if (tooltipItems.length > 0) {
                  const date = new Date(`${tooltipItems[0].label}T00:00:00`);
                  return date.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric'
                  });
                }
                return '';
              },
              label: function(context) {
                try {
                  const dataset = context.dataset;
                  const dataIndex = context.dataIndex;
                  const nutrient = dataset._nutrient;
                  // Use the per-date target when available (calories varies by training bump);
                  // fall back to the static baseline target for all other nutrients.
                  const target = (dataset._targetValues && dataset._targetValues[dataIndex] != null)
                    ? dataset._targetValues[dataIndex]
                    : dataset._target;
                  const actual = dataset._actualValues[dataIndex];

                  if (actual === null || actual === undefined) return null;

                  const delta = actual - target;
                  const deltaText = delta >= 0
                    ? `+${Math.round(delta)}`
                    : `${Math.round(delta)}`;

                  const nutrientName = formatNutrientName(nutrient);

                  return `${nutrientName}: ${Math.round(actual)} (${deltaText})`;

                } catch (error) {
                  handleChartError('tooltip-label', error);
                  return 'Error';
                }
              },
              afterLabel: function(context) {
                try {
                  const dataIndex = context.dataIndex;
                  const chart = context.chart;
                  const currentNutrient = context.dataset._nutrient;
                  const avgLines = [];

                  const avg3DayDataset = chart.data.datasets.find(ds => ds._nutrient === currentNutrient && ds._avgType === '3-day');
                  if (avg3DayDataset) {
                      const avgValue = avg3DayDataset._actualValues[dataIndex];
                      if (avgValue !== null && avgValue !== undefined) {
                          avgLines.push(`    3-Day Avg: ${Math.round(avgValue)}`);
                      }
                  }

                  const avg7DayDataset = chart.data.datasets.find(ds => ds._nutrient === currentNutrient && ds._avgType === '7-day');
                  if (avg7DayDataset) {
                      const avgValue = avg7DayDataset._actualValues[dataIndex];
                      if (avgValue !== null && avgValue !== undefined) {
                          avgLines.push(`    7-Day Avg: ${Math.round(avgValue)}`);
                      }
                  }

                  if (context.chart.tooltip.dataPoints.length > 1 && context.datasetIndex < context.chart.tooltip.dataPoints.length - 1) {
                    avgLines.push('');
                  }
                  
                  return avgLines;
                } catch (error) {
                  handleChartError('tooltip-afterLabel', error);
                  return [];
                }
              }
            }
          },
          legend: { 
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 15,
              filter: function(item, chart) {
                return !item.text.includes('Target (100%)') && !item.text.includes('avg');
              }
            }
          }
        }
      }
    });

    debugLog('update-chart-success', 'Chart updated successfully');

    updateChartTable(tableData, selectedNutrients, labels);

  } catch (error) {
    handleChartError('update-chart', error);
  }
}

// =========================
// TABLE UPDATE FUNCTION
// =========================

/**
 * Update the data table below the chart
 * @param {Object} tableData - Data for the table
 * @param {string[]} nutrientKeys - Selected nutrients
 * @param {string[]} labels - Date labels
 */
function updateChartTable(tableData, nutrientKeys, labels) {
  try {
    const tableContainer = document.getElementById('chart-table');
    if (!tableContainer) {
      debugLog('table-update', 'Table container not found');
      return;
    }

    if (!Object.keys(tableData).length || !nutrientKeys.length) {
      tableContainer.innerHTML = '<p class="text-muted text-center py-4">No data available for selected nutrients and timeframe</p>';
      return;
    }

    let html = `
      <div class="overflow-x-auto surface-1 rounded-lg border">
        <table class="min-w-full">
          <thead class="surface-2">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-semibold text-secondary">Nutrient</th>`;
    
    labels.forEach(dateStr => {
      const date = new Date(`${dateStr}T00:00:00`);
      const shortDate = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      html += `<th class="px-3 py-3 text-center text-sm font-semibold text-secondary">${shortDate}</th>`;
    });

    html += `</tr></thead><tbody class="divide-y">`;

    nutrientKeys.forEach(nutrient => {
      html += `<tr class="hover-surface-2">
        <td class="px-4 py-3 text-sm font-medium text-primary">${formatNutrientName(nutrient)}</td>`;
      
      labels.forEach(dateStr => {
        const data = tableData[dateStr][nutrient];
        if (data) {
          const colorClass = data.percentage >= 90 && data.percentage <= 110 ? 'text-positive' :
                            data.percentage >= 70 ? 'text-warning' : 'text-negative';
          
          html += `
            <td class="px-3 py-3 text-center text-sm">
              <div class="font-medium">${data.actual.toFixed(1)}</div>
              <div class="${colorClass} text-xs">${data.percentage.toFixed(0)}%</div>
            </td>`;
        } else {
          html += `<td class="px-3 py-3 text-center text-sm text-muted">—</td>`;
        }
      });
      
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    tableContainer.innerHTML = html;

    debugLog('table-update-success', 'Chart table updated successfully');

  } catch (error) {
    handleChartError('table-update', error);
  }
}
