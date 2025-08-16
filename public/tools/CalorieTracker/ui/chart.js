/**
 * @file src/ui/chart.js
 * @description Complete chart rendering with working tooltips in target|actual|delta format
 */

import { state } from '../state/store.js';
import { CONFIG } from '../config.js';
import { allNutrients, averagedNutrients } from '../constants.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';

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
  
  // Tooltip styling
  TOOLTIP_CONFIG: {
    backgroundColor: 'rgba(0,0,0,0.9)',
    titleColor: 'white',
    bodyColor: 'white',
    borderColor: 'rgba(255,255,255,0.3)',
    borderWidth: 1,
    cornerRadius: 8,
    displayColors: true,
    bodySpacing: 4,
    padding: 10,
  },
  
  // Chart behavior
  DEFAULT_NUTRIENT: 'calories',
  DEFAULT_TIMEFRAME: 'week',
  ENABLE_DEBUG_LOGGING: true
};

// Chart colors are provided by CONFIG.CHART_COLORS

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
      <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p class="text-red-800 font-medium">Chart Error in ${operation}</p>
        <p class="text-red-600 text-sm">${error.message}</p>
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
 * Initialize chart controls and set up event listeners
 */
export function initializeChartControls() {
  try {
    debugLog('init-controls', 'Starting chart controls initialization');
    
    const chartNutrients = document.getElementById('chart-nutrients');
    const chartTimeframe = document.getElementById('chart-timeframe');
    const show3DayAvg = document.getElementById('show-3day-avg');
    const show7DayAvg = document.getElementById('show-7day-avg');

    if (!chartNutrients) {
      throw new Error('Chart nutrients selector not found');
    }

    // Populate nutrient selector
    chartNutrients.innerHTML = '';
    allNutrients.forEach(nutrient => {
      const option = document.createElement('option');
      option.value = nutrient;
      option.textContent = formatNutrientName(nutrient);
      if (nutrient === CHART_CONFIG.DEFAULT_NUTRIENT) option.selected = true;
      chartNutrients.appendChild(option);
    });

    // Set default timeframe
    if (chartTimeframe) {
      chartTimeframe.value = CHART_CONFIG.DEFAULT_TIMEFRAME;
    }

    // Add event listeners with error handling
    const addEventListenerSafe = (element, event, handler) => {
      if (element) {
        element.addEventListener(event, (e) => {
          try {
            handler(e);
          } catch (error) {
            handleChartError('event-handler', error);
          }
        });
      }
    };

    addEventListenerSafe(chartNutrients, 'change', updateChart);
    addEventListenerSafe(chartTimeframe, 'change', updateChart);
    addEventListenerSafe(show3DayAvg, 'change', updateChart);
    addEventListenerSafe(show7DayAvg, 'change', updateChart);

    debugLog('init-controls', 'Chart controls initialized successfully');

    // Initial chart render
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
    
    const endDate = new Date(`${state.dom.dateInput.value}T00:00:00`);
    
    // Determine number of days to show
    let days = 7;
    switch (timeframe) {
      case '3days': days = 3; break;
      case 'week': days = 7; break;
      case 'month': days = 30; break;
      default: days = 7;
    }

    // Get extra days for moving averages
    const maxAvgDays = Math.max(show3Day ? 3 : 0, show7Day ? 7 : 0);
    const totalDaysNeeded = days + maxAvgDays - 1;
    
    const allLabels = [];
    const displayLabels = [];
    const datasets = [];
    const tableData = {};

    // Generate all date labels
    for (let i = totalDaysNeeded - 1; i >= 0; i--) {
      const date = getPastDate(endDate, i);
      allLabels.push(formatDate(date));
    }

    // Generate display labels (the dates we actually show on chart)
    for (let i = days - 1; i >= 0; i--) {
      const date = getPastDate(endDate, i);
      const dateStr = formatDate(date);
      displayLabels.push(dateStr);
      tableData[dateStr] = {};
    }

    // Create datasets for each selected nutrient
    nutrientKeys.forEach((nutrient, idx) => {
      const color = CONFIG.CHART_COLORS[idx % CONFIG.CHART_COLORS.length];
      
      // Get target value
      const target = parseFloat(state.baselineTargets[nutrient]) || 1;
      
      // Main bar data (actual values as percentage of target)
      const actualData = displayLabels.map(dateStr => {
        const entry = state.dailyEntries.get(dateStr) || {};
        const actual = parseFloat(entry[nutrient]) || 0;
        return target > 0 ? (actual / target) * 100 : 0;
      });

      // Raw actual values for tooltips
      const actualValues = displayLabels.map(dateStr => {
        const entry = state.dailyEntries.get(dateStr) || {};
        return parseFloat(entry[nutrient]) || 0;
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
        _target: target,
        _actualValues: actualValues,
        _isAverage: false
      });

      // Populate table data
      displayLabels.forEach((dateStr, i) => {
        tableData[dateStr][nutrient] = {
          actual: actualValues[i],
          percentage: actualData[i],
          target: target
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
          avg3Data.push(target > 0 ? (avg / target) * 100 : 0);
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
          _target: target,
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
          avg7Data.push(target > 0 ? (avg / target) * 100 : 0);
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
          _target: target,
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

    const chartNutrients = document.getElementById('chart-nutrients');
    const chartTimeframe = document.getElementById('chart-timeframe');
    const show3DayAvg = document.getElementById('show-3day-avg');
    const show7DayAvg = document.getElementById('show-7day-avg');
    
    if (!chartNutrients) {
      throw new Error('Chart nutrients selector not found');
    }

    const selectedNutrients = Array.from(chartNutrients.selectedOptions).map(o => o.value);
    const timeframe = chartTimeframe?.value || CHART_CONFIG.DEFAULT_TIMEFRAME;
    const show3Day = show3DayAvg?.checked || false;
    const show7Day = show7DayAvg?.checked || false;

    if (selectedNutrients.length === 0) {
      debugLog('update-chart', 'No nutrients selected');
      return;
    }

    const { labels, datasets, tableData } = getChartData(selectedNutrients, timeframe, show3Day, show7Day);
    const canvas = document.getElementById('nutrition-chart');
    
    if (!canvas) {
      throw new Error('Chart canvas not found');
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
            label: 'Target (100%)',
            data: new Array(labels.length).fill(100),
            type: 'line',
            borderColor: '#6B7280',
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
            ...CHART_CONFIG.TOOLTIP_CONFIG,
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
                  const target = dataset._target;
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
      tableContainer.innerHTML = '<p class="text-gray-500 text-center py-4">No data available for selected nutrients and timeframe</p>';
      return;
    }

    let html = `
      <div class="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table class="min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Nutrient</th>`;
    
    labels.forEach(dateStr => {
      const date = new Date(`${dateStr}T00:00:00`);
      const shortDate = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      html += `<th class="px-3 py-3 text-center text-sm font-semibold text-gray-700">${shortDate}</th>`;
    });
    
    html += `</tr></thead><tbody class="divide-y divide-gray-200">`;

    nutrientKeys.forEach(nutrient => {
      html += `<tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-sm font-medium text-gray-900">${formatNutrientName(nutrient)}</td>`;
      
      labels.forEach(dateStr => {
        const data = tableData[dateStr][nutrient];
        if (data) {
          const colorClass = data.percentage >= 90 && data.percentage <= 110 ? 'text-green-600' :
                            data.percentage >= 70 ? 'text-yellow-600' : 'text-red-600';
          
          html += `
            <td class="px-3 py-3 text-center text-sm">
              <div class="font-medium">${data.actual.toFixed(1)}</div>
              <div class="${colorClass} text-xs">${data.percentage.toFixed(0)}%</div>
            </td>`;
        } else {
          html += `<td class="px-3 py-3 text-center text-sm text-gray-400">—</td>`;
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
