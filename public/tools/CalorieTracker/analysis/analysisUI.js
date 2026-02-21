/**
 * @file analysis/analysisUI.js
 * @description Renders the Analysis tab within the dashboard: weight chart,
 * KPIs, TDEE/BMR cards, imputation table, and plateau status.
 */

import { state } from '../state/store.js';
import { runAnalysis, getBlankDaysForPopulation } from './engine.js';
import { handleWeightUpload } from './weightUpload.js';
import { debugLog, showMessage } from '../utils/ui.js';
import { CONFIG } from '../config.js';
import { saveEstimatedEntry } from '../services/firebase.js';

// Chart instance for the weight trend chart (separate from nutrition chart)
let weightChartInstance = null;

// ==========================================
// MAIN ENTRY: render + wire
// ==========================================

/**
 * Render the full analysis section HTML and initialize its chart/events.
 * Call this from updateDashboard() in dashboard.js.
 * @returns {string} HTML string for the analysis section
 */
export function renderAnalysisSection() {
  // Run analysis pipeline (cached result stored in state for other consumers)
  const results = runAnalysis(state.weightEntries, state.dailyEntries);
  state.analysisResults = results;

  // Pre-compute blank days once so both the table and event handler can use them.
  state._blankDaysForPopulation = results.error
    ? []
    : getBlankDaysForPopulation(results.rows, state.dailyEntries, state.baselineTargets);

  return `
    <div class="mb-8">
      <h2 class="text-responsive-2xl font-bold text-secondary mb-4">📈 Weight & Energy Analysis</h2>

      <!-- CSV Upload -->
      ${renderUploadArea()}

      ${results.error
        ? renderNoDataMessage(results.error)
        : `
          <!-- KPI Cards -->
          ${renderKPICards(results)}

          <!-- Weight Trend Chart -->
          ${renderWeightChart()}

          <!-- Plateau Status -->
          ${renderPlateauStatus(results.plateau)}

          <!-- TDEE / BMR Detail -->
          ${renderEnergyDetail(results.bmrModel)}

          <!-- Imputation Table -->
          ${renderImputationTable(results.rows)}

          <!-- Fill Blank Days -->
          ${renderBlankDaysSection(state._blankDaysForPopulation)}
        `
      }
    </div>
  `;
}

/**
 * Initialize chart and wire events after the HTML has been inserted into the DOM.
 * Must be called after renderAnalysisSection()'s HTML is in the page.
 */
export function initAnalysisEvents() {
  // Wire CSV upload
  const uploadInput = document.getElementById('weight-csv-input');
  const uploadBtn = document.getElementById('weight-upload-btn');
  const uploadArea = document.getElementById('weight-upload-area');

  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());

    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleWeightUpload(file);
      // Re-render dashboard to reflect new data
      const { updateDashboard } = await import('../ui/dashboard.js');
      updateDashboard();
    });
  }

  // Drag and drop
  if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      await handleWeightUpload(file);
      const { updateDashboard } = await import('../ui/dashboard.js');
      updateDashboard();
    });
  }

  // Draw weight chart if data exists
  if (state.analysisResults && !state.analysisResults.error) {
    drawWeightChart(state.analysisResults.rows);
  }

  // Wire timeframe selector
  const timeframeSelect = document.getElementById('weight-chart-timeframe');
  if (timeframeSelect) {
    timeframeSelect.addEventListener('change', () => {
      if (state.analysisResults && !state.analysisResults.error) {
        drawWeightChart(state.analysisResults.rows);
      }
    });
  }

  // ── Blank-day population controls ──────────────────────────────────────────
  const blankDays = state._blankDaysForPopulation || [];
  if (blankDays.length === 0) return;

  /** Refresh the fill-button label based on checked count. */
  function updateFillBtn() {
    const checked = document.querySelectorAll('.blank-day-check:checked').length;
    const btn = document.getElementById('blank-fill-btn');
    const countEl = document.getElementById('blank-fill-count');
    if (btn) btn.disabled = checked === 0;
    if (countEl) countEl.textContent = checked;
  }

  // Checkbox: update button on every change
  document.getElementById('blank-days-tbody')?.addEventListener('change', e => {
    if (e.target.classList.contains('blank-day-check')) updateFillBtn();
  });

  // Select-all header checkbox
  document.getElementById('blank-check-all')?.addEventListener('change', e => {
    document.querySelectorAll('.blank-day-check')
      .forEach(cb => { cb.checked = e.target.checked; });
    updateFillBtn();
  });

  // Select-all button
  document.getElementById('blank-select-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.blank-day-check').forEach(cb => { cb.checked = true; });
    const allBox = document.getElementById('blank-check-all');
    if (allBox) allBox.checked = true;
    updateFillBtn();
  });

  // Deselect-all button
  document.getElementById('blank-deselect-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.blank-day-check').forEach(cb => { cb.checked = false; });
    const allBox = document.getElementById('blank-check-all');
    if (allBox) allBox.checked = false;
    updateFillBtn();
  });

  // Select-range button
  document.getElementById('blank-select-range-btn')?.addEventListener('click', () => {
    const fromVal = document.getElementById('blank-range-from')?.value;
    const toVal   = document.getElementById('blank-range-to')?.value;
    if (!fromVal || !toVal) return;
    document.querySelectorAll('.blank-day-check').forEach(cb => {
      cb.checked = cb.dataset.date >= fromVal && cb.dataset.date <= toVal;
    });
    updateFillBtn();
  });

  // Fill selected days
  document.getElementById('blank-fill-btn')?.addEventListener('click', async () => {
    const selectedDates = Array.from(document.querySelectorAll('.blank-day-check:checked'))
      .map(cb => cb.dataset.date);
    if (selectedDates.length === 0) return;

    const blankMap = new Map(blankDays.map(d => [d.date, d]));

    const fillBtn = document.getElementById('blank-fill-btn');
    if (fillBtn) fillBtn.disabled = true;
    showMessage(`Filling ${selectedDates.length} blank day(s)…`, false, 30000);

    let savedCount = 0;
    for (const dateStr of selectedDates) {
      const estimated = blankMap.get(dateStr);
      if (!estimated) continue;
      try {
        await saveEstimatedEntry(dateStr, estimated);
        savedCount++;
      } catch (e) {
        debugLog('blank-fill', `Failed to save ${dateStr}: ${e.message}`);
      }
    }

    showMessage(`Filled ${savedCount} blank day(s) with estimated values.`);

    // Re-render dashboard (dynamic import avoids circular dependency)
    const { updateDashboard } = await import('../ui/dashboard.js');
    updateDashboard();
  });
}

// ==========================================
// RENDER HELPERS
// ==========================================

function renderUploadArea() {
  const hasData = state.weightEntries.size > 0;
  return `
    <div id="weight-upload-area" class="mb-6 p-4 staging-section" style="text-align:center;">
      <input type="file" id="weight-csv-input" accept=".csv,.tsv,.txt" class="hidden">
      <button id="weight-upload-btn" class="btn btn-primary">
        <i class="fas fa-upload" style="margin-right:.5rem;"></i>${hasData ? 'Re-upload' : 'Upload'} Weight CSV
      </button>
      <p class="text-xs text-muted mt-2">
        ${hasData
          ? `${state.weightEntries.size} weight readings loaded. Upload your full export anytime — duplicates are auto-skipped.`
          : 'Export your scale data as CSV/TSV and upload it here. Only date/time and weight are used.'
        }
      </p>
    </div>
  `;
}

function renderNoDataMessage(msg) {
  return `
    <div class="text-center p-8 surface-2 rounded-lg border">
      <i class="fas fa-weight text-3xl text-muted mb-3" style="display:block;"></i>
      <p class="text-muted">${msg}</p>
    </div>
  `;
}

function renderKPICards(results) {
  const s = results.summary;
  const cards = [];

  if (s.currentWeight != null) {
    cards.push(kpiCard('Current Weight', `${s.currentWeight} lb`, 'fa-weight', 'text-accent'));
  }
  if (s.totalWeightChange != null) {
    const sign = s.totalWeightChange > 0 ? '+' : '';
    const color = s.totalWeightChange <= 0 ? 'text-positive' : 'text-warning';
    cards.push(kpiCard('Total Change', `${sign}${s.totalWeightChange} lb`, 'fa-arrow-trend-down', color));
  }
  if (s.tdee != null) {
    cards.push(kpiCard('Est. TDEE', `${s.tdee} kcal`, 'fa-fire', 'text-warning'));
  }
  if (s.bmr != null) {
    cards.push(kpiCard('Est. BMR', `${s.bmr} kcal`, 'fa-heart-pulse', 'text-accent'));
  }

  if (cards.length === 0) return '';

  return `
    <div class="mb-6" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
      ${cards.join('')}
    </div>
  `;
}

function kpiCard(label, value, icon, colorClass) {
  return `
    <div class="surface-2 rounded-lg border p-4 text-center">
      <i class="fas ${icon} ${colorClass} text-xl mb-2" style="display:block;"></i>
      <div class="text-responsive-xl font-bold">${value}</div>
      <div class="text-xs text-muted">${label}</div>
    </div>
  `;
}

function renderWeightChart() {
  return `
    <div class="mb-6 card p-6 shadow-lg">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-responsive-xl font-bold text-secondary">Weight Trend</h3>
        <select id="weight-chart-timeframe" class="p-2 border rounded-md" style="width:auto;">
          <option value="90">Last 90 Days</option>
          <option value="180">Last 180 Days</option>
          <option value="365">Last Year</option>
          <option value="all">All Time</option>
        </select>
      </div>
      <div style="position:relative; height:350px;">
        <canvas id="weight-trend-chart"></canvas>
      </div>
    </div>
  `;
}

function renderPlateauStatus(plateau) {
  if (!plateau || plateau.slopeLbPerWeek == null) return '';

  const icon = plateau.isPlateaued ? 'fa-pause-circle' : plateau.slopeLbPerWeek < 0 ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up';
  const color = plateau.isPlateaued ? 'text-warning' : plateau.slopeLbPerWeek < 0 ? 'text-positive' : 'text-negative';

  return `
    <div class="mb-6 p-4 surface-2 rounded-lg border flex items-center gap-4">
      <i class="fas ${icon} ${color} text-2xl"></i>
      <div>
        <div class="font-semibold">${plateau.isPlateaued ? 'Plateau Detected' : 'Weight Trending'}</div>
        <div class="text-sm text-muted">${plateau.message}</div>
      </div>
    </div>
  `;
}

function renderEnergyDetail(bmrModel) {
  if (!bmrModel || bmrModel.error) {
    return `
      <div class="mb-6 p-4 surface-2 rounded-lg border">
        <div class="text-sm text-muted">
          <i class="fas fa-info-circle mr-2"></i>${bmrModel?.error || 'Energy estimates not yet available.'}
        </div>
      </div>
    `;
  }

  // Detect confusing inversion: light PAL > hard PAL
  const palLight = bmrModel.pals[100];
  const palHard  = bmrModel.pals[280];
  const palInverted = palLight != null && palHard != null && palLight > palHard;

  const palRows = Object.entries(bmrModel.pals)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([bump, pal]) => {
      const labels = { '0': 'Rest day', '100': 'Light lift (+100 kcal)', '280': 'Hard lift (+280 kcal)', '400': 'HIIT (+400 kcal)' };
      const label = labels[bump] || `+${bump} kcal`;
      const tdee = Math.round(bmrModel.bmr_current * pal);
      return `<tr>
        <td class="px-3 py-2 text-sm">${label}</td>
        <td class="px-3 py-2 text-sm text-center">${pal.toFixed(2)}</td>
        <td class="px-3 py-2 text-sm text-center">${tdee} kcal</td>
      </tr>`;
    }).join('');

  const adaptationSign = bmrModel.adaptation > 0 ? '+' : '';
  const adaptationColor = bmrModel.adaptation < 0 ? 'text-negative' : 'text-positive';
  const adaptationMeaning = bmrModel.adaptation < 0
    ? 'Your metabolism is running slower than a textbook BMR-for-weight formula predicts — a common response to sustained calorie restriction ("adaptive thermogenesis"). This means your body is burning fewer calories at rest than your weight alone would suggest.'
    : bmrModel.adaptation > 0
      ? 'Your metabolism is running faster than a textbook BMR-for-weight formula predicts — consistent with high non-exercise activity, a higher-than-average muscle mass, or a recent period of re-feeding.'
      : 'Your metabolism is tracking right on the textbook prediction for your weight.';

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-4">Energy Model Detail</h3>

      <!-- BMR cards -->
      <div class="grid grid-cols-1 gap-4 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Baseline BMR (weight-based)</div>
          <div class="font-bold text-lg">${bmrModel.bmr_baseline} kcal</div>
          <div class="text-xs text-muted mt-1">Predicted by the BMR ~ a + b × weight_kg regression fit to your historical data.</div>
        </div>
        <div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Metabolic Adaptation</div>
          <div class="font-bold text-lg ${adaptationColor}">${adaptationSign}${bmrModel.adaptation} kcal</div>
          <div class="text-xs text-muted mt-1">${adaptationMeaning}</div>
        </div>
        <div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Current BMR (adapted)</div>
          <div class="font-bold text-lg text-accent">${bmrModel.bmr_current} kcal</div>
          <div class="text-xs text-muted mt-1">= Baseline + Adaptation. Used as the base for TDEE estimates below.</div>
        </div>
      </div>

      <!-- PAL table -->
      <h4 class="font-semibold text-secondary mb-2 text-sm uppercase tracking-wide">Retrospective TDEE by Activity Level</h4>
      <div class="mb-3 p-3 surface-2 rounded-lg border text-xs text-muted space-y-1">
        <p><strong>What this table is:</strong> A data-fitted model. The PAL (Physical Activity Level) multiplier for each training-bump category was chosen by a grid search that minimises BMR volatility in your historical data. It tells you what your actual total energy expenditure appears to have been on days of each type.</p>
        <p><strong>Two separate systems:</strong> The TDEE estimates here are a <em>retrospective analysis</em> tool. The <em>prospective</em> calorie target you see each day is driven by your base goal + the flat training bump you select (Rest +0, Light +100, Hard +280, HIIT +400 kcal) — not by the PAL multipliers. Changing the activity toggle adjusts your daily budget by exactly that flat amount, which is intentional and diet-plan-consistent.</p>
        ${palInverted ? `
        <p class="text-warning"><strong>Why does Light show a higher TDEE than Hard?</strong> This reflects a pattern in your actual data, not a bug. Hard training days often coincide with higher sodium/carb intake and glycogen-driven water retention, which temporarily inflates your scale weight. The EWMA smoother partially absorbs this noise, but if the retention is systematic it makes hard-day weight changes look smaller (or even positive) relative to calories — which pushes the implied TDEE lower, causing the grid search to assign a lower PAL. In short: the model is telling you that your hard days produce less apparent fat loss per calorie than your light days, which is real but primarily a water/glycogen effect. Use the flat bumps in your daily plan; treat the PAL table as a curiosity rather than an action item.
        </p>` : ''}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Activity (flat budget bump)</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Fitted PAL</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Implied TDEE</th>
            </tr>
          </thead>
          <tbody class="divide-y">${palRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderImputationTable(rows) {
  const imputed = rows.filter(r => r.calories_imputed);
  const pending = rows.filter(r => r.impute_status === 'pending');

  if (imputed.length === 0 && pending.length === 0) return '';

  const imputedRows = imputed.slice(-20).map(r => `
    <tr>
      <td class="px-3 py-2 text-sm">${formatDisplayDate(r.date)}</td>
      <td class="px-3 py-2 text-sm text-center">${r.calories} kcal</td>
      <td class="px-3 py-2 text-sm text-center"><span class="text-positive">Estimated</span></td>
    </tr>
  `).join('');

  const pendingRows = pending.slice(-10).map(r => `
    <tr>
      <td class="px-3 py-2 text-sm">${formatDisplayDate(r.date)}</td>
      <td class="px-3 py-2 text-sm text-center text-muted">—</td>
      <td class="px-3 py-2 text-sm text-center"><span class="text-warning">Pending</span></td>
    </tr>
  `).join('');

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-4">Missing Day Estimates</h3>
      <p class="text-sm text-muted mb-4">
        Days without logged calories are estimated using your TDEE model and weight change.
        Estimates only appear after 14+ days have passed and enough weight data exists.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Calories</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${imputedRows}
            ${pendingRows}
          </tbody>
        </table>
      </div>
      ${pending.length > 0 ? `<p class="text-xs text-muted mt-3">${pending.length} day(s) pending — need more time and/or weight readings.</p>` : ''}
    </div>
  `;
}

function renderBlankDaysSection(blankDays) {
  if (!blankDays || blankDays.length === 0) return '';

  const rows = blankDays.map(d => `
    <tr>
      <td class="px-3 py-2 text-center">
        <input type="checkbox" class="blank-day-check h-4 w-4" data-date="${d.date}" />
      </td>
      <td class="px-3 py-2 text-sm">${formatDisplayDate(d.date)}</td>
      <td class="px-3 py-2 text-sm text-center">${d.calories} kcal</td>
      <td class="px-3 py-2 text-sm text-center">${Math.round(d.protein)}g</td>
      <td class="px-3 py-2 text-sm text-center">${Math.round(d.carbs)}g</td>
      <td class="px-3 py-2 text-sm text-center">${Math.round(d.fat)}g</td>
    </tr>
  `).join('');

  // Date range defaults: full span of available blank days
  const minDate = blankDays[0].date;
  const maxDate = blankDays[blankDays.length - 1].date;

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-2">📅 Fill Blank Days</h3>
      <p class="text-sm text-muted mb-4">
        These days have no logged food but enough weight history for the model to estimate calories.
        Macros are distributed to sum to the estimated calorie total (protein and fat from your
        targets; carbs fill the remainder). All micronutrient fields are set to your baseline targets.
        Only days after your first logged food entry are shown.
        <strong>Filling a day overwrites any partial data already there.</strong>
      </p>

      <!-- Range controls -->
      <div class="flex flex-wrap gap-2 mb-3 items-end">
        <div>
          <label class="block text-xs text-muted mb-1">From</label>
          <input type="date" id="blank-range-from" value="${minDate}" class="p-1 border rounded-md text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">To</label>
          <input type="date" id="blank-range-to" value="${maxDate}" class="p-1 border rounded-md text-sm" />
        </div>
        <button id="blank-select-range-btn" class="btn btn-secondary btn-sm self-end">Select Range</button>
        <button id="blank-select-all-btn" class="btn btn-secondary btn-sm self-end">Select All</button>
        <button id="blank-deselect-all-btn" class="btn btn-secondary btn-sm self-end">Deselect All</button>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto mb-4">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-center w-10">
                <input type="checkbox" id="blank-check-all" class="h-4 w-4" title="Select all" />
              </th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. Calories</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. Protein</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. Carbs</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. Fat</th>
            </tr>
          </thead>
          <tbody class="divide-y" id="blank-days-tbody">${rows}</tbody>
        </table>
      </div>

      <button id="blank-fill-btn" class="btn btn-primary" disabled>
        <i class="fas fa-fill-drip mr-2"></i>Fill <span id="blank-fill-count">0</span> Selected Day(s)
      </button>
    </div>
  `;
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ==========================================
// WEIGHT TREND CHART (Chart.js)
// ==========================================

function drawWeightChart(rows) {
  const canvas = document.getElementById('weight-trend-chart');
  if (!canvas) return;

  const timeframeSelect = document.getElementById('weight-chart-timeframe');
  const daysBack = timeframeSelect?.value === 'all' ? rows.length : parseInt(timeframeSelect?.value || '90');

  // Filter rows to timeframe and only those with weight
  const cutoffIdx = Math.max(0, rows.length - daysBack);
  const visible = rows.slice(cutoffIdx);

  const labels = [];
  const rawData = [];
  const smoothData = [];

  for (const r of visible) {
    labels.push(r.date);
    rawData.push(r.weight_lb);
    smoothData.push(r.wt_smooth_lb);
  }

  if (weightChartInstance) {
    weightChartInstance.destroy();
    weightChartInstance = null;
  }

  const chartColors = CONFIG.CHART_COLORS || [];
  const rawColor = chartColors[0] || '#6366f1';
  const smoothColor = chartColors[1] || '#f59e0b';

  const css = getComputedStyle(document.documentElement);
  const borderColor = `hsl(${css.getPropertyValue('--border').trim()})`;

  weightChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Raw Weight',
          data: rawData,
          borderColor: rawColor + '80',
          backgroundColor: rawColor + '20',
          borderWidth: 1,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          fill: false,
          spanGaps: true,
          tension: 0,
          order: 2,
        },
        {
          label: 'Smoothed Trend',
          data: smoothData,
          borderColor: smoothColor,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false,
          spanGaps: true,
          tension: 0.3,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        y: {
          title: { display: true, text: 'Weight (lb)', font: { weight: 'bold' } },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: {
          title: { display: true, text: 'Date', font: { weight: 'bold' } },
          grid: { display: false },
          ticks: {
            maxTicksLimit: 12,
            callback: function (value) {
              const dateStr = this.getLabelForValue(value);
              const d = new Date(dateStr + 'T00:00:00');
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            },
          },
        },
      },
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.9)',
          titleColor: 'white',
          bodyColor: 'white',
          borderColor: 'rgba(255,255,255,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          callbacks: {
            title(items) {
              if (!items.length) return '';
              const d = new Date(items[0].label + 'T00:00:00');
              return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            },
            label(ctx) {
              const val = ctx.raw;
              if (val == null) return null;
              return `${ctx.dataset.label}: ${val.toFixed(1)} lb`;
            },
          },
        },
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, padding: 15 },
        },
      },
    },
  });
}
