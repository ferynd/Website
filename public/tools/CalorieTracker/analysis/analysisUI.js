/**
 * @file analysis/analysisUI.js
 * @description Renders the Analysis tab: weight chart, KPIs, TDEE/BMR cards,
 * confidence, imputation table, and plateau status.
 */

import { state } from '../state/store.js';
import { runAnalysis, getBlankDaysForPopulation } from './engine.js';
import { handleWeightUpload } from './weightUpload.js';
import { debugLog, showMessage } from '../utils/ui.js';
import { CONFIG } from '../config.js';
import { saveEstimatedEntry } from '../services/firebase.js';

let weightChartInstance = null;

// ==========================================
// MAIN ENTRY: render + wire
// ==========================================

export function renderAnalysisSection() {
  const results = runAnalysis(
    state.weightEntries,
    state.dailyEntries,
    state.userProfile || null,
    state.weightEntriesMulti || null,
  );
  state.analysisResults = results;

  state._blankDaysForPopulation = results.error
    ? []
    : getBlankDaysForPopulation(results.rows, state.dailyEntries, state.baselineTargets);

  return `
    <div class="mb-8">
      <h2 class="text-responsive-2xl font-bold text-secondary mb-4">📈 Weight & Energy Analysis</h2>

      ${renderUploadArea()}

      ${results.error
        ? renderNoDataMessage(results.error)
        : `
          ${renderKPICards(results)}
          ${renderConfidenceCard(results.confidence, results)}
          ${renderWeightChart()}
          ${renderPlateauStatus(results.plateau)}
          ${renderEnergyDetail(results)}
          ${renderImputationTable(results.rows)}
          ${renderBlankDaysSection(state._blankDaysForPopulation)}
        `
      }
    </div>
  `;
}

export function initAnalysisEvents() {
  const uploadInput = document.getElementById('weight-csv-input');
  const uploadBtn   = document.getElementById('weight-upload-btn');
  const uploadArea  = document.getElementById('weight-upload-area');
  const statusEl    = document.getElementById('weight-upload-status');
  const progressEl  = document.getElementById('weight-upload-progress');
  const barEl       = document.getElementById('weight-upload-bar');
  const progressTxt = document.getElementById('weight-upload-progress-text');

  function onStatus(msg, isErr = false) {
    state.lastWeightUploadStatus = { message: msg, isError: isErr };
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `text-xs mt-2 ${isErr ? 'text-negative' : 'text-muted'}`;
  }

  function onProgress(saved, total, bi, bt) {
    if (!progressEl || !barEl || !progressTxt) return;
    const pct = total > 0 ? Math.round((saved / total) * 100) : 0;
    progressEl.classList.remove('hidden');
    barEl.style.width = `${pct}%`;
    progressTxt.textContent = `Batch ${bi}/${bt} — ${saved}/${total} entries (${pct}%)`;
  }

  async function runUpload(file) {
    if (!file) return;
    if (uploadBtn) uploadBtn.disabled = true;
    if (progressEl) progressEl.classList.remove('hidden');
    if (barEl) barEl.style.width = '0%';
    if (progressTxt) progressTxt.textContent = '';

    const result = await handleWeightUpload(file, { onStatus, onProgress });

    if (uploadBtn) uploadBtn.disabled = false;
    if (progressEl && result.saved > 0) {
      if (barEl) barEl.style.width = '100%';
      setTimeout(() => { if (progressEl) progressEl.classList.add('hidden'); }, 3000);
    } else if (progressEl) {
      progressEl.classList.add('hidden');
    }

    if (result.diagnostics && result.parsed > 0 && !result.partialFailure) {
      const d = result.diagnostics;
      const skipStr = d.skippedRows > 0
        ? ` | Skipped: ${d.skippedRows} (${Object.keys(d.skippedReasons).join(', ')})`
        : '';
      const rangeStr = d.detectedDateRange.from
        ? ` | Range: ${d.detectedDateRange.from} → ${d.detectedDateRange.to}`
        : '';
      onStatus(`Saved ${result.saved}/${result.total} rows${skipStr}${rangeStr}`, false);
    }

    const { updateDashboard } = await import('../ui/dashboard.js');
    updateDashboard();
  }

  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      uploadInput.value = '';
      await runUpload(file);
    });
  }

  if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      await runUpload(e.dataTransfer?.files?.[0]);
    });
  }

  if (state.analysisResults && !state.analysisResults.error) {
    drawWeightChart(state.analysisResults.rows);
  }

  const timeframeSelect = document.getElementById('weight-chart-timeframe');
  if (timeframeSelect) {
    timeframeSelect.addEventListener('change', () => {
      if (state.analysisResults && !state.analysisResults.error) {
        drawWeightChart(state.analysisResults.rows);
      }
    });
  }

  // Blank-day population controls
  const blankDays = state._blankDaysForPopulation || [];
  if (blankDays.length === 0) return;

  function updateFillBtn() {
    const checked = document.querySelectorAll('.blank-day-check:checked').length;
    const btn = document.getElementById('blank-fill-btn');
    const countEl = document.getElementById('blank-fill-count');
    if (btn) btn.disabled = checked === 0;
    if (countEl) countEl.textContent = checked;
  }

  document.getElementById('blank-days-tbody')?.addEventListener('change', e => {
    if (e.target.classList.contains('blank-day-check')) updateFillBtn();
  });
  document.getElementById('blank-check-all')?.addEventListener('change', e => {
    document.querySelectorAll('.blank-day-check').forEach(cb => { cb.checked = e.target.checked; });
    updateFillBtn();
  });
  document.getElementById('blank-select-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.blank-day-check').forEach(cb => { cb.checked = true; });
    const allBox = document.getElementById('blank-check-all');
    if (allBox) allBox.checked = true;
    updateFillBtn();
  });
  document.getElementById('blank-deselect-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.blank-day-check').forEach(cb => { cb.checked = false; });
    const allBox = document.getElementById('blank-check-all');
    if (allBox) allBox.checked = false;
    updateFillBtn();
  });
  document.getElementById('blank-select-range-btn')?.addEventListener('click', () => {
    const fromVal = document.getElementById('blank-range-from')?.value;
    const toVal   = document.getElementById('blank-range-to')?.value;
    if (!fromVal || !toVal) return;
    document.querySelectorAll('.blank-day-check').forEach(cb => {
      cb.checked = cb.dataset.date >= fromVal && cb.dataset.date <= toVal;
    });
    updateFillBtn();
  });

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
    const { updateDashboard } = await import('../ui/dashboard.js');
    updateDashboard();
  });
}

// ==========================================
// RENDER HELPERS
// ==========================================

function renderUploadArea() {
  const hasData = state.weightEntries.size > 0;
  const stored = state.lastWeightUploadStatus;
  const statusMsg = stored
    ? stored.message
    : hasData
      ? `${state.weightEntries.size} weight readings loaded. Re-uploading the same export will update matching rows without creating duplicates.`
      : 'Export your scale data as CSV/TSV and upload it here. Supports comma, tab, and semicolon delimiters, kg or lb columns, and most date formats.';
  const statusClass = stored?.isError ? 'text-negative' : 'text-muted';

  return `
    <div id="weight-upload-area" class="mb-6 p-4 staging-section" style="text-align:center;">
      <input type="file" id="weight-csv-input" accept=".csv,.tsv,.txt" class="hidden">
      <button id="weight-upload-btn" class="btn btn-primary">
        <i class="fas fa-upload" style="margin-right:.5rem;"></i>${hasData ? 'Re-upload' : 'Upload'} Weight CSV
      </button>
      <p id="weight-upload-status" class="text-xs mt-2 ${statusClass}" style="word-break:break-word;">${statusMsg}</p>
      <div id="weight-upload-progress" class="mt-2 hidden" style="max-width:100%;box-sizing:border-box;">
        <div class="progress-bar-bg" style="overflow:hidden;border-radius:999px;">
          <div id="weight-upload-bar" class="progress-bar-fill" style="width:0%;"></div>
        </div>
        <p id="weight-upload-progress-text" class="text-xs text-muted mt-2" style="word-break:break-word;"></p>
      </div>
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

  // Prefer observed TDEE over model TDEE for the top KPI
  const displayTdee = s.observedTdee ?? s.tdee;
  if (displayTdee != null) {
    cards.push(kpiCard('Observed TDEE', `${displayTdee} kcal`, 'fa-fire', 'text-warning'));
  }

  if (s.restDayCaloriesOut != null) {
    cards.push(kpiCard('Predicted Rest-Day TDEE', `${s.restDayCaloriesOut} kcal`, 'fa-couch', 'text-accent'));
  } else if (s.bmr != null) {
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

// ==========================================
// CONFIDENCE CARD
// ==========================================

function renderConfidenceCard(confidence, results) {
  if (!confidence) return '';

  const { label, score, reasons } = confidence;

  const configs = {
    not_enough: { icon: 'fa-circle-question', color: 'text-muted',    bar: 'bg-muted',     title: 'Not enough data yet',          subtitle: 'Upload weight data and log food consistently to enable estimates.' },
    rough:      { icon: 'fa-circle-exclamation', color: 'text-warning', bar: 'bg-warning',   title: 'Rough estimate',               subtitle: 'Early data. Treat numbers as ballpark figures, not precision targets.' },
    moderate:   { icon: 'fa-circle-check', color: 'text-accent',       bar: 'bg-accent',     title: 'Moderate confidence',          subtitle: 'Reasonable estimates. Keep logging for better accuracy.' },
    high:       { icon: 'fa-circle-check', color: 'text-positive',     bar: 'bg-positive',   title: 'High confidence',              subtitle: 'Strong data history. Estimates are likely within 5–10% of reality.' },
  };
  const cfg = configs[label] || configs.not_enough;

  const reasonList = reasons.map(r => `<li class="text-xs text-muted">${r}</li>`).join('');

  // Uncertainty footnote
  let uncertaintyNote = '';
  if (results.waterWeightUncertaintyLb != null) {
    const methodLabel = results.waterCorrectionMethod === 'ols_regression' ? 'regression-fitted' : 'median-bucket';
    uncertaintyNote = `<p class="text-xs text-muted mt-2">Day-to-day water weight noise: ±${results.waterWeightUncertaintyLb} lb (${methodLabel} correction). This sets a floor on how precisely any single weigh-in can be interpreted.</p>`;
  }

  return `
    <div class="mb-6 surface-2 rounded-lg border p-4">
      <div class="flex items-center gap-3 mb-3">
        <i class="fas ${cfg.icon} ${cfg.color} text-xl"></i>
        <div>
          <div class="font-semibold">${cfg.title}</div>
          <div class="text-xs text-muted">${cfg.subtitle}</div>
        </div>
        <div class="ml-auto text-right">
          <div class="text-xs text-muted mb-1">${score}%</div>
          <div class="w-24 h-2 rounded-full surface-1 overflow-hidden">
            <div class="${cfg.bar} h-full rounded-full transition-all" style="width:${score}%;"></div>
          </div>
        </div>
      </div>
      <ul class="space-y-1 pl-1">
        ${reasonList}
      </ul>
      ${uncertaintyNote}
    </div>
  `;
}

// ==========================================
// WEIGHT CHART
// ==========================================

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

// ==========================================
// ENERGY DETAIL CARD
// ==========================================

function renderEnergyDetail(results) {
  const { bmrModel, tdeeByHorizon, loggingResidual, waterWeightUncertaintyLb, profileRmr } = results;

  if (!bmrModel) {
    return `<div class="mb-6 p-4 surface-2 rounded-lg border"><div class="text-sm text-muted">Energy estimates not yet available.</div></div>`;
  }

  const hasError = !!bmrModel.error;
  const isFallback = bmrModel.source === 'profile_prior';

  // ── Section: TDEE horizon table ──────────────────────────────────────────
  const horizonRows = Object.entries(tdeeByHorizon || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([days, info]) => {
      if (!info.available) return `
        <tr>
          <td class="px-3 py-2 text-sm">${days}-day window</td>
          <td class="px-3 py-2 text-sm text-center text-muted" colspan="2">Not enough data yet</td>
        </tr>`;
      return `
        <tr>
          <td class="px-3 py-2 text-sm">${days}-day window</td>
          <td class="px-3 py-2 text-sm text-center font-semibold">${info.tdee} kcal</td>
          <td class="px-3 py-2 text-sm text-center text-muted">${info.daysUsed} block estimates</td>
        </tr>`;
    }).join('');

  const horizonSection = Object.keys(tdeeByHorizon || {}).length > 0 ? `
    <div class="mb-6">
      <h4 class="font-semibold text-secondary mb-2 text-sm uppercase tracking-wide">Observed TDEE at Different Horizons</h4>
      <p class="text-xs text-muted mb-2">Each number is a trimmed average of 14-day rolling block estimates in that window. Longer windows are more stable; short windows react faster to recent changes. Do not act on differences smaller than ~100 kcal — that is within normal noise.</p>
      <div class="overflow-x-auto">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Window</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">TDEE</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Data points</th>
            </tr>
          </thead>
          <tbody class="divide-y">${horizonRows}</tbody>
        </table>
      </div>
    </div>` : '';

  // ── Section: BMR / RMR cards ─────────────────────────────────────────────
  let bmrSection = '';

  if (!hasError || isFallback) {
    const profileRmrNote = profileRmr
      ? `<div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Profile-predicted RMR</div>
          <div class="font-bold text-lg">${profileRmr.rmr} kcal</div>
          <div class="text-xs text-muted mt-1">${profileRmr.note}. Used as a starting point before enough data exists.</div>
        </div>`
      : '';

    const residualSign = (bmrModel.modelResidual ?? bmrModel.adaptation ?? 0) > 0 ? '+' : '';
    const residual = bmrModel.modelResidual ?? bmrModel.adaptation ?? 0;
    const residualColor = residual < 0 ? 'text-negative' : 'text-positive';
    const sd = bmrModel.modelResidualSd ?? bmrModel.adaptationSD ?? '?';

    const bmrCards = isFallback
      ? `${profileRmrNote}
         <div class="surface-2 rounded-lg border p-4 text-sm text-warning">
           <i class="fas fa-info-circle mr-2"></i>${bmrModel.error}
         </div>`
      : `
        ${profileRmrNote}
        <div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Fitted BMR (weight-based regression)</div>
          <div class="font-bold text-lg text-accent">${bmrModel.fittedBmr ?? bmrModel.bmr_current} kcal</div>
          <div class="text-xs text-muted mt-1">Pure regression output: BMR ~ a + b × weight_kg, fitted to your historical data. Used directly in daily targets and rest-day TDEE prediction.</div>
        </div>
        <div class="surface-2 rounded-lg border p-4">
          <div class="text-sm text-muted mb-1">Model residual (last 21 days)</div>
          <div class="font-bold text-lg ${residualColor}">${residualSign}${residual} <span class="font-normal text-base">± ${sd} kcal</span></div>
          <div class="text-xs text-muted mt-1 space-y-1">
            <p>Gap between the regression prediction and what your weight-change + calories data implies. A negative value means the model over-predicts your burn; positive means it under-predicts.</p>
            <p class="text-warning">This gap is ambiguous — it reflects some combination of logging inaccuracy (missed entries, incorrect amounts), water weight noise, and activity variation. Scale data alone cannot separate these. Do not label this "metabolic adaptation."</p>
            ${bmrModel.loggingResidualNote ? `<p class="text-warning">${bmrModel.loggingResidualNote}</p>` : ''}
          </div>
        </div>`;

    bmrSection = `
      <div class="grid grid-cols-1 gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        ${bmrCards}
      </div>`;
  } else {
    bmrSection = `
      <div class="mb-6 p-4 surface-2 rounded-lg border text-sm text-muted">
        <i class="fas fa-info-circle mr-2"></i>${bmrModel.error}
      </div>`;
  }

  // ── Section: Rest-day vs total spend ────────────────────────────────────
  let expenditureRow = '';
  if (bmrModel.modelPredictedRestDayTdee != null || bmrModel.observedTdee != null) {
    const restVal = bmrModel.modelPredictedRestDayTdee != null
      ? `${bmrModel.modelPredictedRestDayTdee} kcal`
      : '<span class="text-muted">Not enough model data</span>';
    const totalVal = bmrModel.observedTdee != null
      ? `${bmrModel.observedTdee} kcal`
      : '<span class="text-muted">Estimating…</span>';

    expenditureRow = `
      <div class="mb-6 surface-2 rounded-lg border p-4">
        <h4 class="font-semibold text-secondary mb-3 text-sm uppercase tracking-wide">Calories Out — Model Estimates</h4>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div class="text-muted text-xs mb-1">Predicted rest-day TDEE</div>
            <div class="font-semibold">${restVal}</div>
            <div class="text-xs text-muted mt-1">Fitted BMR × rest-day PAL. Model-predicted energy burn on days without intentional exercise.</div>
          </div>
          <div>
            <div class="text-muted text-xs mb-1">Overall observed TDEE</div>
            <div class="font-semibold">${totalVal}</div>
            <div class="text-xs text-muted mt-1">Trimmed mean across all available 14-day blocks. Includes all activity levels.</div>
          </div>
        </div>
      </div>`;
  }

  // ── Section: Logging residual ────────────────────────────────────────────
  let residualSection = '';
  if (loggingResidual) {
    const sign = loggingResidual.medianKcalPerDay > 0 ? '+' : '';
    const color = Math.abs(loggingResidual.medianKcalPerDay) < 100 ? 'text-positive' : 'text-warning';
    residualSection = `
      <div class="mb-6 surface-2 rounded-lg border p-4">
        <h4 class="font-semibold text-secondary mb-2 text-sm uppercase tracking-wide">Model vs Observed Gap</h4>
        <div class="font-semibold ${color} mb-1">${sign}${loggingResidual.medianKcalPerDay} kcal/day median gap (±${loggingResidual.sdKcalPerDay})</div>
        <p class="text-xs text-muted">${loggingResidual.note}</p>
      </div>`;
  }

  // ── Section: PAL table (only for fitted model) ────────────────────────────
  let palSection = '';
  if (!hasError && !isFallback && bmrModel.pals) {
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

    palSection = `
      <h4 class="font-semibold text-secondary mb-2 text-sm uppercase tracking-wide">Retrospective TDEE by Activity Level</h4>
      <div class="mb-3 p-3 surface-2 rounded-lg border text-xs text-muted space-y-1">
        <p><strong>What this table is:</strong> A data-fitted model. The PAL multiplier for each training-bump category was chosen by minimising BMR volatility across your history. It reflects what your total expenditure appears to have been on days of each type.</p>
        <p><strong>Prospective budgets are separate:</strong> Your daily calorie target uses a fixed flat bump (Rest +0, Light +100, Hard +280, HIIT +400 kcal), not these PAL multipliers. That is intentional.</p>
        ${palInverted ? `<p class="text-warning"><strong>Why does Light show higher than Hard?</strong> Hard-training days often have higher sodium and carbs, which causes temporary water retention. That inflates the apparent scale weight on hard days, making the implied TDEE look smaller — so the grid search assigns a lower PAL. This is a water/glycogen signal, not a bug. Use the flat bumps in your daily plan.</p>` : ''}
      </div>
      <div class="overflow-x-auto mb-4">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Activity</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Fitted PAL</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Implied TDEE</th>
            </tr>
          </thead>
          <tbody class="divide-y">${palRows}</tbody>
        </table>
      </div>`;
  }

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-4">Energy Model Detail</h3>
      ${horizonSection}
      ${expenditureRow}
      ${bmrSection}
      ${residualSection}
      ${palSection}
    </div>
  `;
}

// ==========================================
// IMPUTATION TABLE
// ==========================================

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
      <p class="text-sm text-muted mb-4">Days without logged calories are estimated using your TDEE model and weight change. Estimates only appear after 14+ days have passed and enough weight data exists.</p>
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

// ==========================================
// BLANK DAYS SECTION
// ==========================================

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

  const minDate = blankDays[0].date;
  const maxDate = blankDays[blankDays.length - 1].date;

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-2">📅 Fill Blank Days</h3>
      <p class="text-sm text-muted mb-4">
        These days have no logged food but enough weight history for the model to estimate calories.
        Macros are distributed to sum to the estimated calorie total (protein and fat from your
        targets; carbs fill the remainder).
        <strong>Filling a day overwrites any partial data already there.</strong>
      </p>

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
  const cutoffIdx = Math.max(0, rows.length - daysBack);
  const visible = rows.slice(cutoffIdx);

  const labels = [], rawData = [], smoothData = [];
  for (const r of visible) {
    labels.push(r.date);
    rawData.push(r.weight_lb);
    smoothData.push(r.wt_smooth_lb);
  }

  if (weightChartInstance) { weightChartInstance.destroy(); weightChartInstance = null; }

  const chartColors = CONFIG.CHART_COLORS || [];
  const rawColor = chartColors[0] || '#6366f1';
  const smoothColor = chartColors[1] || '#f59e0b';
  const css = getComputedStyle(document.documentElement);

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
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 15 } },
      },
    },
  });
}
