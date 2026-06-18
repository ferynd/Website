/**
 * @file analysis/analysisUI.js
 * @description Renders the Analysis tab: weight chart, KPIs, TDEE/BMR cards,
 * confidence, imputation table, and plateau status.
 */

import { state } from '../state/store.js';
import {
  runAnalysis,
  getTrueUpCandidates,
  buildBlankDayEstimateEntry,
  buildVacationDayEntry,
  buildPartialDayAdjustment,
  classifyDay,
  estimateVacationCalories,
  computeWeekdayAverages,
  VACATION_TYPE_CONFIG,
} from './engine.js';
import { buildEatingPatternTargetSeries } from '../targets/targetEngine.js';
import { handleWeightUpload } from './weightUpload.js';
import { debugLog, showMessage, escapeHtml } from '../utils/ui.js';
import { CONFIG } from '../config.js';
import { getTodayInTimezone } from '../utils/time.js';
import {
  saveEstimatedEntry,
  removeEstimateItem,
  lockEstimateForDate,
} from '../services/firebase.js';

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
    getTodayInTimezone(),
  );
  state.analysisResults = results;

  state._trueUpCandidates = results.error
    ? []
    : getTrueUpCandidates(results.rows, state.dailyEntries, results.bmrModel, state.baselineTargets);

  return `
    <div class="mb-8">
      <h2 class="text-responsive-2xl font-bold text-secondary mb-4">📈 Weight & Energy Analysis</h2>

      ${renderUploadArea()}

      ${results.error
        ? renderNoDataMessage(results.error)
        : `
          ${renderKPICards(results)}
          ${renderConfidenceCard(results.confidence, results)}
          ${renderEatingPatternChart(results)}
          <details class="mb-6" id="weight-trend-details" open>
            <summary class="cursor-pointer font-semibold text-secondary p-2 surface-2 rounded-lg border mb-2 select-none">Scale trend details ▸</summary>
            ${renderWeightChart()}
          </details>
          ${renderPlateauStatus(results.plateau)}
          ${renderEnergyDetail(results)}
          ${renderImputationTable(results.rows)}
          ${renderMissingCaloriesSection(state._trueUpCandidates)}
          ${renderVacationEditorSection()}
          ${renderEstimateManagementSection()}
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
    drawEatingPatternChart(state.analysisResults.rows);
  }

  // Redraw eating pattern chart when the "include estimates" toggle changes
  document.getElementById('eating-chart-include-estimates')?.addEventListener('change', () => {
    if (state.analysisResults && !state.analysisResults.error) {
      drawEatingPatternChart(state.analysisResults.rows);
    }
  });

  const timeframeSelect = document.getElementById('weight-chart-timeframe');
  if (timeframeSelect) {
    timeframeSelect.addEventListener('change', () => {
      if (state.analysisResults && !state.analysisResults.error) {
        drawWeightChart(state.analysisResults.rows);
      }
    });
  }

  // ── Missing Calories section (unified candidates only) ────────────────────
  const allCandidates = state._trueUpCandidates || [];
  const candidateMap  = new Map(allCandidates.map(d => [d.date, d]));

  if (allCandidates.length > 0) {
    function getVisibleCheckboxes() {
      return Array.from(document.querySelectorAll('.blank-day-check')).filter(cb => {
        const row = cb.closest('tr');
        return row && !row.classList.contains('hidden');
      });
    }

    function updateFillBtn() {
      const checked = getVisibleCheckboxes().filter(cb => cb.checked).length;
      const btn = document.getElementById('blank-fill-btn');
      const countEl = document.getElementById('blank-fill-count');
      if (btn) btn.disabled = checked === 0;
      if (countEl) countEl.textContent = checked;
    }

    document.getElementById('blank-days-tbody')?.addEventListener('change', e => {
      if (e.target.classList.contains('blank-day-check')) updateFillBtn();
    });
    document.getElementById('blank-check-all')?.addEventListener('change', e => {
      getVisibleCheckboxes().forEach(cb => { cb.checked = e.target.checked; });
      updateFillBtn();
    });
    document.getElementById('blank-select-all-btn')?.addEventListener('click', () => {
      getVisibleCheckboxes().forEach(cb => { cb.checked = true; });
      const allBox = document.getElementById('blank-check-all');
      if (allBox) allBox.checked = true;
      updateFillBtn();
    });
    document.getElementById('blank-deselect-all-btn')?.addEventListener('click', () => {
      getVisibleCheckboxes().forEach(cb => { cb.checked = false; });
      const allBox = document.getElementById('blank-check-all');
      if (allBox) allBox.checked = false;
      updateFillBtn();
    });
    document.getElementById('blank-select-range-btn')?.addEventListener('click', () => {
      const fromVal = document.getElementById('blank-range-from')?.value;
      const toVal   = document.getElementById('blank-range-to')?.value;
      if (!fromVal || !toVal) return;
      getVisibleCheckboxes().forEach(cb => {
        const row = cb.closest('tr');
        const isReview = row?.dataset.review === 'true';
        // Never auto-select reviewManually rows via range — user must check them explicitly
        cb.checked = !isReview && cb.dataset.date >= fromVal && cb.dataset.date <= toVal;
      });
      updateFillBtn();
    });

    // Filter buttons
    document.querySelectorAll('.trueup-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.trueup-filter').forEach(b => b.classList.remove('active-filter'));
        btn.classList.add('active-filter');
        const filter = btn.dataset.filter;
        document.querySelectorAll('#blank-days-tbody tr').forEach(row => {
          let show = true;
          if (filter === 'blank') show = row.dataset.type === 'blank';
          else if (filter === 'partial') show = row.dataset.type === 'partial';
          else if (filter === 'high-medium') show = row.dataset.confidence !== 'low';
          else if (filter === 'review') show = row.dataset.review === 'true';
          row.classList.toggle('hidden', !show);
        });
        updateFillBtn();
      });
    });

    // Sort columns
    let _sortCol = 'date';
    let _sortAsc = false;
    document.querySelectorAll('.trueup-sort').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (_sortCol === col) { _sortAsc = !_sortAsc; }
        else { _sortCol = col; _sortAsc = col !== 'date'; }

        document.querySelectorAll('.trueup-sort-icon').forEach(ic => ic.textContent = '');
        th.querySelector('.trueup-sort-icon').textContent = _sortAsc ? '↑' : '↓';

        const tbody = document.getElementById('blank-days-tbody');
        if (!tbody) return;
        const trs = Array.from(tbody.querySelectorAll('tr'));
        trs.sort((a, b) => {
          let av, bv;
          if (col === 'date') { av = a.dataset.date; bv = b.dataset.date; }
          else if (col === 'type') { av = a.dataset.type; bv = b.dataset.type; }
          else if (col === 'delta') { av = +a.dataset.delta; bv = +b.dataset.delta; }
          else if (col === 'confidence') {
            const order = { high: 2, medium: 1, low: 0 };
            av = order[a.dataset.confidence] ?? 0;
            bv = order[b.dataset.confidence] ?? 0;
          }
          if (av < bv) return _sortAsc ? -1 : 1;
          if (av > bv) return _sortAsc ? 1 : -1;
          return 0;
        });
        trs.forEach(tr => tbody.appendChild(tr));
      });
    });

    document.getElementById('blank-fill-btn')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.blank-day-check:checked'));
      if (selected.length === 0) return;

      const fillBtn = document.getElementById('blank-fill-btn');
      if (fillBtn) fillBtn.disabled = true;
      showMessage(`Filling ${selected.length} day(s)…`, false, 30000);

      let savedCount = 0;
      let failCount = 0;
      for (const cb of selected) {
        const dateStr = cb.dataset.date;
        const kind = cb.dataset.kind;
        try {
          if (kind === 'partial') {
            const candidate = candidateMap.get(dateStr);
            const existingEntry = state.dailyEntries.get(dateStr);
            if (!candidate || !existingEntry) continue;
            const residual = candidate.recommendedDelta;
            const conf = candidate.confidence ?? 'low';
            const { adjustedEntry } = buildPartialDayAdjustment(
              dateStr, residual, existingEntry, state.baselineTargets, conf
            );
            await saveEstimatedEntry(dateStr, adjustedEntry);
          } else {
            const existingEntry = state.dailyEntries.get(dateStr);
            if (existingEntry?.estimateMeta?.locked) continue;
            const candidate = candidateMap.get(dateStr);
            if (!candidate) continue;
            // Build a proper v2 estimate entry — never save the raw candidate object
            const entryToSave = buildBlankDayEstimateEntry(
              dateStr, candidate, state.analysisResults, state.dailyEntries, state.baselineTargets
            );
            await saveEstimatedEntry(dateStr, entryToSave);
          }
          savedCount++;
        } catch (e) {
          debugLog('blank-fill', `Failed to save ${dateStr}: ${e.message}`);
          failCount++;
        }
      }

      showMessage(
        failCount > 0
          ? `Filled ${savedCount} day(s), ${failCount} failed — check console for details.`
          : `Filled ${savedCount} day(s) with estimated values.`,
        failCount > 0
      );
      const { updateDashboard } = await import('../ui/dashboard.js');
      updateDashboard();
    });

    // Initialize fill button count
    updateFillBtn();
  }

  // ── Vacation Editor ─────────────────────────────────────────────────────────
  const vacPreviewBtn = document.getElementById('vac-preview-btn');
  if (vacPreviewBtn) {
    vacPreviewBtn.addEventListener('click', () => _buildVacationPreview());

    // Batch type buttons
    for (const type of ['light', 'medium', 'heavy']) {
      document.getElementById(`vac-batch-${type}`)?.addEventListener('click', () => {
        _batchSetVacType(type);
      });
    }

    document.getElementById('vac-check-all')?.addEventListener('change', e => {
      document.querySelectorAll('.vac-day-check').forEach(cb => { cb.checked = e.target.checked; });
      _updateVacFillCount();
    });

    document.getElementById('vac-preview-tbody')?.addEventListener('change', e => {
      if (e.target.classList.contains('vac-day-check')) _updateVacFillCount();
      if (e.target.classList.contains('vac-type-select')) _onVacTypeChange(e.target);
    });

    document.getElementById('vac-preview-tbody')?.addEventListener('input', e => {
      if (!e.target.classList.contains('vac-custom-kcal')) return;
      const dateStr = e.target.dataset.date;
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        state.vacationEditor.customCalories.set(dateStr, val);
      } else {
        state.vacationEditor.customCalories.delete(dateStr);
      }
      _refreshVacRowEstimate(dateStr, 'custom');
    });

    document.getElementById('vac-fill-btn')?.addEventListener('click', async () => {
      await _applyVacationFill();
    });
  }

  // ── Estimate Management ─────────────────────────────────────────────────────
  document.querySelectorAll('.estimate-lock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dateStr = btn.dataset.date;
      const currentlyLocked = btn.dataset.locked === 'true';
      const newLocked = !currentlyLocked;
      btn.disabled = true;
      try {
        await lockEstimateForDate(dateStr, newLocked);
        showMessage(`Estimate for ${dateStr} ${newLocked ? 'locked' : 'unlocked'}.`);
        const { updateDashboard } = await import('../ui/dashboard.js');
        updateDashboard();
      } catch {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('.estimate-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dateStr = btn.dataset.date;
      const itemId  = btn.dataset.itemId;
      btn.disabled = true;
      try {
        await removeEstimateItem(dateStr, itemId);
        showMessage(`Estimate item removed from ${dateStr}. Real food items preserved.`);
        const { updateDashboard } = await import('../ui/dashboard.js');
        updateDashboard();
      } catch {
        btn.disabled = false;
      }
    });
  });
}

// ==========================================
// VACATION EDITOR HELPERS
// ==========================================

function _datesInRange(fromStr, toStr) {
  const dates = [];
  const d = new Date(fromStr + 'T00:00:00');
  const end = new Date(toStr + 'T00:00:00');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function _updateVacFillCount() {
  const checked = document.querySelectorAll('.vac-day-check:checked').length;
  const btn = document.getElementById('vac-fill-btn');
  const countEl = document.getElementById('vac-fill-count');
  if (btn) btn.disabled = checked === 0;
  if (countEl) countEl.textContent = checked;
}

function _buildVacationPreview() {
  const fromVal = document.getElementById('vac-from')?.value;
  const toVal   = document.getElementById('vac-to')?.value;
  if (!fromVal || !toVal || fromVal > toVal) {
    showMessage('Select a valid date range first.', true);
    return;
  }

  const defaultType = document.getElementById('vac-default-type')?.value || 'medium';
  const dates = _datesInRange(fromVal, toVal);

  const bmrModel = state.analysisResults?.bmrModel || null;
  const weekdayAvgs = computeWeekdayAverages(state.dailyEntries);

  const tbody = document.getElementById('vac-preview-tbody');
  if (!tbody) return;

  const typeOptions = (type) => Object.entries(VACATION_TYPE_CONFIG).map(([val, cfg]) =>
    `<option value="${val}"${val === type ? ' selected' : ''}>${cfg.label}</option>`
  ).join('');

  state.vacationEditor.dayTypes.clear();
  state.vacationEditor.customCalories.clear();

  tbody.innerHTML = dates.map(dateStr => {
    const existing = state.dailyEntries.get(dateStr) || null;
    const analysisRow = (state.analysisResults?.rows || []).find(r => r.date === dateStr) || {};
    const dayClass = classifyDay(analysisRow, existing);
    const est = estimateVacationCalories(defaultType, bmrModel, dateStr, null, null, weekdayAvgs);
    state.vacationEditor.dayTypes.set(dateStr, defaultType);

    const isLocked = Boolean(existing?.estimateMeta?.locked || existing?.manualLock);
    const lockedNote = isLocked ? ' <span class="text-xs text-warning">(locked)</span>' : '';

    return `
      <tr data-date="${dateStr}">
        <td class="px-3 py-2 text-center">
          <input type="checkbox" class="vac-day-check h-4 w-4" data-date="${dateStr}"
                 ${isLocked ? 'disabled title="Locked estimate — unlock in Estimate Management first"' : 'checked'} />
        </td>
        <td class="px-3 py-2 text-sm">${formatDisplayDate(dateStr)}${lockedNote}</td>
        <td class="px-3 py-2 text-sm text-center">${dayTypeBadge(dayClass)}</td>
        <td class="px-3 py-2 text-sm text-center vac-est-cal" data-date="${dateStr}">${est.calories} kcal</td>
        <td class="px-3 py-2 text-sm text-center">
          <select class="vac-type-select p-1 border rounded text-sm" data-date="${dateStr}">
            ${typeOptions(defaultType)}
          </select>
        </td>
        <td class="px-3 py-2 text-sm text-center">
          <input type="number" class="vac-custom-kcal p-1 border rounded text-sm w-20 hidden"
                 data-date="${dateStr}" min="200" max="6000" placeholder="kcal" />
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('vac-preview-area')?.classList.remove('hidden');
  _updateVacFillCount();
}

function _onVacTypeChange(selectEl) {
  const dateStr = selectEl.dataset.date;
  const type = selectEl.value;
  state.vacationEditor.dayTypes.set(dateStr, type);

  const customInput = document.querySelector(`.vac-custom-kcal[data-date="${dateStr}"]`);
  if (customInput) {
    if (type === 'custom') {
      customInput.classList.remove('hidden');
    } else {
      customInput.classList.add('hidden');
      state.vacationEditor.customCalories.delete(dateStr);
    }
  }
  _refreshVacRowEstimate(dateStr, type);
}

function _refreshVacRowEstimate(dateStr, type) {
  const bmrModel = state.analysisResults?.bmrModel || null;
  const weekdayAvgs = computeWeekdayAverages(state.dailyEntries);
  const customKcal = state.vacationEditor.customCalories.get(dateStr) ?? null;
  const est = estimateVacationCalories(type, bmrModel, dateStr, null, customKcal, weekdayAvgs);
  const cell = document.querySelector(`.vac-est-cal[data-date="${dateStr}"]`);
  if (cell) cell.textContent = `${est.calories} kcal`;
}

function _batchSetVacType(type) {
  document.querySelectorAll('.vac-type-select').forEach(sel => {
    sel.value = type;
    _onVacTypeChange(sel);
  });
  _updateVacFillCount();
}

async function _applyVacationFill() {
  const checked = Array.from(document.querySelectorAll('.vac-day-check:checked'));
  if (checked.length === 0) return;

  const fillBtn = document.getElementById('vac-fill-btn');
  if (fillBtn) fillBtn.disabled = true;
  showMessage(`Filling ${checked.length} vacation day(s)…`, false, 30000);

  let savedCount = 0;
  let failCount = 0;
  for (const cb of checked) {
    const dateStr = cb.dataset.date;
    const type = state.vacationEditor.dayTypes.get(dateStr) || 'medium';
    const customKcal = type === 'custom'
      ? (state.vacationEditor.customCalories.get(dateStr) ?? null)
      : null;

    if (type === 'custom' && customKcal === null) {
      debugLog('vacation-fill', `Skipping ${dateStr}: custom type with no calories entered`);
      failCount++;
      continue;
    }

    const existing = state.dailyEntries.get(dateStr);
    if (existing?.estimateMeta?.locked || existing?.manualLock) {
      debugLog('vacation-fill', `Skipping locked estimate for ${dateStr}`);
      continue;
    }

    try {
      const entry = buildVacationDayEntry(
        dateStr, type, state.analysisResults, state.dailyEntries,
        state.baselineTargets, customKcal
      );
      await saveEstimatedEntry(dateStr, entry);
      savedCount++;
    } catch (e) {
      debugLog('vacation-fill', `Failed to save ${dateStr}: ${e.message}`);
      failCount++;
    }
  }

  showMessage(
    failCount > 0
      ? `Filled ${savedCount} vacation day(s), ${failCount} failed — check console for details.`
      : `Filled ${savedCount} vacation day(s) with estimated values.`,
    failCount > 0
  );
  const { updateDashboard } = await import('../ui/dashboard.js');
  updateDashboard();
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
// EATING PATTERN CHART
// ==========================================

function renderEatingPatternChart(results) {
  const { bmrModel, tdeeByHorizon, waterWeightUncertaintyLb } = results;
  if (!bmrModel || bmrModel.error) return '';

  const tdee        = bmrModel.tdee_current || bmrModel.observedTdee;
  const baseCals    = parseFloat(state.baselineTargets?.calories) || null;
  const restDayTdee = bmrModel.modelPredictedRestDayTdee || tdee;
  const uncertainty = waterWeightUncertaintyLb ?? null;
  const targetMode  = state.goalSettings?.targetMode ?? 'manual';

  const uncertaintyNote = uncertainty != null
    ? `Water weight noise: ±${uncertainty} lb (≈ ±${Math.round(uncertainty * 3500)} kcal apparent daily variation).`
    : '';

  const residual = results.loggingResidual;
  const residualNote = residual
    ? `Model vs log gap: ${residual.medianKcalPerDay > 0 ? '+' : ''}${residual.medianKcalPerDay} kcal/day median (±${residual.sdKcalPerDay}).`
    : '';

  const tdeeSource = bmrModel.source === 'fitted'
    ? 'empirical (fitted to your history)'
    : 'profile formula (not enough data for empirical)';

  const firstNutritionDate = findFirstManualNutritionDate();
  const firstDateNote = firstNutritionDate
    ? `Reported intake starts on <strong>${firstNutritionDate}</strong>, your first manually logged nutrition day.`
    : '';

  const targetModeNote = targetMode === 'autoGoal'
    ? 'Daily targets are set by <strong>Auto Goal</strong> mode (Profile &amp; Goals) — the dashed target line varies per date.'
    : 'Daily targets use your <strong>manual baseline</strong> (Settings or "Apply to Baseline Targets") — the dashed target line is flat.';

  const targetNote = targetMode === 'autoGoal'
    ? '<p>Target line: per-date <strong>Auto Goal</strong> calories (varies with your goal deadline and weight history).</p>'
    : (baseCals ? `<p>Target line: flat <strong>manual baseline of ${baseCals} kcal/day</strong>${tdee && baseCals < tdee ? ` — a deficit of ~${tdee - baseCals} kcal/day` : ''}.</p>` : '');

  const targetLineDesc = targetMode === 'autoGoal' ? 'auto-goal target (dashed, per-date)' : 'manual baseline target (dashed)';

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-1">📊 Eating Pattern vs Weight Change</h3>
      <div class="mb-3 flex flex-wrap gap-4 items-center text-sm">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="eating-chart-include-estimates" class="h-4 w-4">
          <span class="text-muted">Include saved estimates in reported intake</span>
        </label>
      </div>
      <div style="position:relative; height:300px;" class="mb-4">
        <canvas id="eating-pattern-chart"></canvas>
      </div>
      <div class="p-3 surface-2 rounded-lg border text-sm text-muted space-y-2">
        <p class="font-semibold text-primary">How the model thinks about this:</p>
        ${tdee ? `<p>Estimated total daily energy expenditure: <strong>${tdee} kcal/day</strong> (${tdeeSource}). ${restDayTdee !== tdee ? `Rest-day TDEE: <strong>${restDayTdee} kcal/day</strong> (fitted BMR × rest-day PAL).` : ''}</p>` : ''}
        ${targetNote}
        ${uncertaintyNote ? `<p>${uncertaintyNote} This is a physical lower bound on single-day precision — scale fluctuations can mask real trends.</p>` : ''}
        ${residualNote ? `<p>${residualNote} ${Math.abs(residual?.medianKcalPerDay ?? 0) > 100 ? 'This gap likely reflects underlogged meals, not metabolic differences.' : 'Small gap — logging appears consistent.'}</p>` : ''}
        ${firstDateNote ? `<p>${firstDateNote} Weight data before this date affects the trend chart only.</p>` : ''}
        <p>${targetModeNote}</p>
        <p class="text-xs">The chart shows your 7-day rolling calorie average (blue, real logged days only) vs your ${targetLineDesc} and the TDEE estimate (orange). The smoothed weight trend is overlaid on the right axis. Unsaved imputed values are never included in the reported calorie series.</p>
      </div>
    </div>
  `;
}

/**
 * Return the earliest YYYY-MM-DD string in dailyEntries that has real manually-
 * logged food (entryType !== 'estimate', calories > 0, not synthetic-item-only).
 * Returns null when no such day exists.
 */
function findFirstManualNutritionDate() {
  let earliest = null;
  for (const [dateStr, entry] of state.dailyEntries) {
    if (!entry) continue;
    const cals = parseFloat(entry.calories);
    if (!(cals > 0)) continue;
    if (entry.entryType === 'estimate') continue;
    // Skip days where every food item is synthetic
    const items = Array.isArray(entry.foodItems) ? entry.foodItems : [];
    if (items.length > 0 && items.every(it =>
      it.entryType === 'estimate' || /^(est-|vac-|adj-)/.test(it.id ?? '')
    )) continue;
    if (earliest === null || dateStr < earliest) earliest = dateStr;
  }
  return earliest;
}

/**
 * Return real calories for a given date, or null.
 * Saved estimate entries count only when includeEstimates=true.
 * Unsaved / engine-imputed values are never included.
 */
function _realCaloriesForDate(dateStr, includeEstimates) {
  const entry = state.dailyEntries.get(dateStr);
  if (!entry) return null;
  const cals = parseFloat(entry.calories);
  if (!(cals > 0)) return null;
  if (entry.entryType === 'estimate') return includeEstimates ? cals : null;
  return cals;
}

function drawEatingPatternChart(rows) {
  const canvas = document.getElementById('eating-pattern-chart');
  if (!canvas || !rows || rows.length === 0) return;

  const WINDOW = 7;
  const chartColors = CONFIG.CHART_COLORS || [];
  const calsColor   = chartColors[2] || '#3b82f6';
  const tdeeColor   = chartColors[1] || '#f59e0b';
  const targetColor = chartColors[3] || '#22c55e';
  const weightColor = chartColors[0] || '#a78bfa';

  const tdeeVal  = state.analysisResults?.bmrModel?.tdee_current || null;

  // Respect the "include estimates" toggle if it exists in the DOM
  const includeEstimates = document.getElementById('eating-chart-include-estimates')?.checked ?? false;

  // Only draw reported calorie series from the first day the user manually logged food.
  // This prevents weight data before tracking started from appearing as calorie points.
  const firstNutritionDate = findFirstManualNutritionDate();

  // Build 7d rolling average from REAL logged calories only.
  // Engine-imputed values (r.calories_imputed) are never included as reported intake.
  const labels        = [];
  const rollingCals   = [];
  const smoothWeights = [];

  for (let i = 0; i < rows.length; i++) {
    labels.push(rows[i].date);
    smoothWeights.push(rows[i].wt_smooth_lb);

    // Before tracking started: no calorie data point
    if (!firstNutritionDate || rows[i].date < firstNutritionDate) {
      rollingCals.push(null);
      continue;
    }

    const slice = rows.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const calVals = slice
      .filter(r => firstNutritionDate && r.date >= firstNutritionDate)
      .map(r => _realCaloriesForDate(r.date, includeEstimates))
      .filter(v => v != null);

    rollingCals.push(calVals.length >= 3
      ? Math.round(calVals.reduce((a, b) => a + b, 0) / calVals.length)
      : null);
  }

  if (window._eatingPatternChart) { window._eatingPatternChart.destroy(); window._eatingPatternChart = null; }

  const datasets = [
    {
      label: 'Calories (7d avg)',
      data: rollingCals,
      borderColor: calsColor,
      backgroundColor: calsColor + '30',
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      spanGaps: true,
      tension: 0.3,
      yAxisID: 'y',
      order: 2,
    },
  ];

  if (tdeeVal) {
    datasets.push({
      label: `TDEE (${tdeeVal} kcal)`,
      data: labels.map(() => tdeeVal),
      borderColor: tdeeColor,
      borderWidth: 1.5,
      borderDash: [6, 3],
      pointRadius: 0,
      fill: false,
      spanGaps: true,
      yAxisID: 'y',
      order: 3,
    });
  }

  const { targetData, label: targetLabel } =
    buildEatingPatternTargetSeries(labels, firstNutritionDate, state);

  if (targetLabel) {
    datasets.push({
      label: targetLabel,
      data: targetData,
      borderColor: targetColor,
      borderWidth: 1.5,
      borderDash: [3, 3],
      pointRadius: 0,
      fill: false,
      spanGaps: false,   // null = gap, keeps pre-tracking stretch clean
      yAxisID: 'y',
      order: 4,
    });
  }

  datasets.push({
    label: 'Smoothed weight (lb)',
    data: smoothWeights,
    borderColor: weightColor,
    borderWidth: 2,
    pointRadius: 0,
    fill: false,
    spanGaps: true,
    tension: 0.3,
    yAxisID: 'y2',
    order: 1,
  });

  window._eatingPatternChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        y: {
          position: 'left',
          title: { display: true, text: 'Calories (kcal)' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y2: {
          position: 'right',
          title: { display: true, text: 'Weight (lb)' },
          grid: { drawOnChartArea: false },
        },
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 12,
            callback(value) {
              const d = new Date(this.getLabelForValue(value) + 'T00:00:00');
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            },
          },
        },
      },
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 12 } },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.9)',
          titleColor: 'white',
          bodyColor: 'white',
          callbacks: {
            title(items) {
              if (!items.length) return '';
              const d = new Date(items[0].label + 'T00:00:00');
              return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            },
            label(ctx) {
              if (ctx.raw == null) return null;
              return `${ctx.dataset.label}: ${ctx.raw}`;
            },
          },
        },
      },
    },
  });
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
        <p><strong>What this table is:</strong> A retrospective data-fitted model. The PAL multiplier for each activity bucket was chosen by minimising BMR volatility across your history. It reflects what your total expenditure appears to have been on days of each type.</p>
        <p><strong>Activity categories are a temporary compatibility layer.</strong> The four buckets (Rest / Light +100 / Hard +280 / HIIT +400 kcal) map to the legacy training-bump field. Once structured exercise sessions are fully implemented, these will be replaced by continuous per-session calorie estimates.</p>
        <p><strong>Prospective budgets are separate:</strong> Your daily calorie target uses fixed flat bumps, not these PAL multipliers. That is intentional — the PALs are retrospective; the bumps are forward-looking planning values.</p>
        ${palInverted ? `<p class="text-warning"><strong>Why does Light show higher than Hard?</strong> Hard-training days often have higher sodium and carbs, which causes temporary water retention. That inflates the apparent scale weight on hard days, making the implied TDEE look smaller — so the grid search assigns a lower PAL. This is a water/glycogen signal, not a model bug. Use the flat bumps in your daily plan.</p>` : ''}
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
// MISSING CALORIES (blank + partial days)
// ==========================================

function confidenceBadge(conf) {
  const map = {
    high:   'text-positive',
    medium: 'text-accent',
    low:    'text-warning',
  };
  return `<span class="${map[conf] || 'text-muted'} text-xs font-semibold">${conf ?? '—'}</span>`;
}

function dayTypeBadge(type) {
  const map = {
    logged:    { label: 'Logged',    cls: 'text-positive' },
    estimated: { label: 'Estimated', cls: 'text-accent' },
    vacation:  { label: 'Vacation',  cls: 'text-warning' },
    blank:     { label: 'Blank',     cls: 'text-muted' },
    partial:   { label: 'Partial?',  cls: 'text-warning' },
    mixed:     { label: 'Mixed',     cls: 'text-accent' },
  };
  const cfg = map[type] || { label: type, cls: 'text-muted' };
  return `<span class="${cfg.cls} text-xs font-semibold">${cfg.label}</span>`;
}

/**
 * "Fill Missing Calories" section — driven exclusively by getTrueUpCandidates.
 * No legacy blankDays / partialDays fallback; all rows come from the unified
 * candidate engine with per-interval energy-balance evidence.
 */
function renderMissingCaloriesSection(candidates) {
  const rows = candidates && candidates.length > 0 ? candidates : [];
  const pendingRows = candidates?._pending || [];

  if (rows.length === 0) {
    const emptyMsg = pendingRows.length > 0
      ? `No actionable candidates yet. ${pendingRows.length} candidate(s) are waiting for more future weight data.`
      : 'No missing days detected. Either all days are logged, the weight trend matches reported intake, or more data is needed.';

    const pendingSection = pendingRows.length > 0 ? `
      <details class="mt-4">
        <summary class="cursor-pointer text-sm text-accent font-medium select-none">
          Pending candidates (${pendingRows.length}) — awaiting future data ▸
        </summary>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full border rounded-lg text-sm">
            <thead class="surface-2">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Type</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Reason</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${pendingRows.map(p => `
                <tr>
                  <td class="px-3 py-2 text-sm">${formatDisplayDate(p.date)}</td>
                  <td class="px-3 py-2 text-sm text-center">${dayTypeBadge(p.type)}</td>
                  <td class="px-3 py-2 text-xs text-muted">${p.pendingReason ?? 'Awaiting more data.'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>` : '';

    return `
      <div class="mb-6 card p-6 shadow-lg">
        <h3 class="text-responsive-xl font-bold text-secondary mb-2">📅 Fill Missing Calories</h3>
        <div class="p-4 surface-2 rounded-lg border text-sm text-muted">
          <i class="fas fa-circle-check text-positive mr-2"></i>${emptyMsg}
        </div>
        ${pendingSection}
      </div>`;
  }

  const allDates = rows.map(r => r.date);
  const minDate = allDates.reduce((a, b) => a < b ? a : b);
  const maxDate = allDates.reduce((a, b) => a > b ? a : b);

  const tableRows = rows.map(r => {
    const intervalDetails = r.intervalsUsed && r.intervalsUsed.length > 0
      ? `<details class="inline text-xs mt-1"><summary class="cursor-pointer text-accent">Interval math ▸</summary>
          <div class="mt-1 space-y-1 pl-1">
            ${r.intervalsUsed.map(i => {
              const refLabel = i.tdeeRefSource === 'outside_interval' ? 'outside-interval TDEE'
                : i.tdeeRefSource === 'inside_interval' ? '<span class="text-warning">inside-interval TDEE (gaps may distort)</span>'
                : i.tdeeRefSource === 'observed_tdee' ? 'observed TDEE'
                : i.tdeeRefSource === 'formula_tdee' ? 'formula TDEE'
                : i.tdeeRefSource === 'hardcoded_fallback' ? '<span class="text-warning">default 2000 kcal (no TDEE data)</span>'
                : '';
              return `<div class="border-l-2 border-accent/30 pl-2">
              <strong>${escapeHtml(i.name)}</strong> [${i.intervalStart} – ${i.intervalEnd}]:
              gap ${i.perDayResidual > 0 ? '+' : ''}${i.perDayResidual} kcal/day
              ${i.reportedIntake != null ? ` · logged ${i.reportedIntake} kcal` : ''}
              ${i.expectedExpenditure != null ? ` · TDEE-est ${i.expectedExpenditure} kcal` : ''}
              ${i.weightImpliedStorage != null ? ` · wt-implied ${i.weightImpliedStorage > 0 ? '+' : ''}${i.weightImpliedStorage} kcal` : ''}
              ${i.residualBefore != null ? ` · residual before ${i.residualBefore > 0 ? '+' : ''}${i.residualBefore}` : ''}
              ${i.residualAfter != null ? ` → after ${i.residualAfter > 0 ? '+' : ''}${i.residualAfter}` : ''}
              · ${i.coverage}% coverage · ${i.weightPoints} wt pts
              ${refLabel ? ` · ref: ${refLabel}` : ''}
            </div>`;
            }).join('')}
            ${r.confidenceDrivers ? `<div class="text-muted mt-0.5">Confidence factors: ${r.confidenceDrivers}</div>` : ''}
          </div></details>`
      : '';

    return `
      <tr data-date="${r.date}" data-type="${r.type}" data-confidence="${r.confidence}" data-delta="${r.recommendedDelta}" data-review="${r.reviewManually}">
        <td class="px-3 py-2 text-center">
          <input type="checkbox" class="blank-day-check h-4 w-4"
            data-date="${r.date}" data-kind="${r.type}"
            data-residual="${r.recommendedDelta}" data-confidence="${r.confidence}"
            ${r.checkedByDefault && !r.reviewManually ? 'checked' : ''} />
        </td>
        <td class="px-3 py-2 text-sm">${formatDisplayDate(r.date)}</td>
        <td class="px-3 py-2 text-sm text-center">${dayTypeBadge(r.type)}</td>
        <td class="px-3 py-2 text-sm text-center font-semibold">
          ${r.type === 'blank' ? r.recommendedDelta + ' kcal' : '+' + r.recommendedDelta + ' kcal'}
          ${r.reviewManually ? '<span class="ml-1 text-xs text-warning font-normal border border-warning rounded px-1">Review</span>' : ''}
        </td>
        <td class="px-3 py-2 text-sm text-center">${confidenceBadge(r.confidence)}</td>
        <td class="px-3 py-2 text-xs text-muted max-w-xs">
          ${r.reason}
          ${intervalDetails}
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-2">📅 Fill Missing Calories</h3>
      <div class="mb-4 p-3 surface-2 rounded-lg border text-xs text-muted space-y-1">
        <p><strong>Blank days</strong> — no food logged; filling creates a complete synthetic entry from your TDEE model and macro averages.</p>
        <p><strong>Partial days</strong> — real food logged but a large gap between your log and what the weight trend implies. Filling adds a single synthetic item; your real food is never changed.</p>
        <p class="text-warning">A gap is a signal, not a certainty. Use your judgement before applying. Days marked "Review" are large (&gt;1000 kcal) and unchecked by default.</p>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-2 mb-3">
        <button class="trueup-filter btn btn-secondary btn-sm active-filter" data-filter="all">All (${rows.length})</button>
        <button class="trueup-filter btn btn-secondary btn-sm" data-filter="blank">Blank (${rows.filter(r => r.type === 'blank').length})</button>
        <button class="trueup-filter btn btn-secondary btn-sm" data-filter="partial">Partial (${rows.filter(r => r.type === 'partial').length})</button>
        <button class="trueup-filter btn btn-secondary btn-sm" data-filter="high-medium">High/Med confidence (${rows.filter(r => r.confidence !== 'low').length})</button>
        <button class="trueup-filter btn btn-secondary btn-sm" data-filter="review">Needs review (${rows.filter(r => r.reviewManually).length})</button>
      </div>

      <!-- Date range + bulk select -->
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

      <!-- Sortable table -->
      <div class="overflow-x-auto mb-4">
        <table class="w-full border rounded-lg text-sm" id="trueup-table">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-center w-10">
                <input type="checkbox" id="blank-check-all" class="h-4 w-4" title="Select all visible" />
              </th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase cursor-pointer trueup-sort" data-col="date">
                Date <span class="trueup-sort-icon">↓</span>
              </th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase cursor-pointer trueup-sort" data-col="type">
                Type <span class="trueup-sort-icon"></span>
              </th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase cursor-pointer trueup-sort" data-col="delta">
                Delta / Est. <span class="trueup-sort-icon"></span>
              </th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase cursor-pointer trueup-sort" data-col="confidence">
                Confidence <span class="trueup-sort-icon"></span>
              </th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Reason</th>
            </tr>
          </thead>
          <tbody id="blank-days-tbody">${tableRows}</tbody>
        </table>
      </div>

      <button id="blank-fill-btn" class="btn btn-primary" disabled>
        <i class="fas fa-fill-drip mr-2"></i>Fill <span id="blank-fill-count">0</span> Selected Day(s)
      </button>

      ${pendingRows.length > 0 ? `
      <details class="mt-6">
        <summary class="cursor-pointer text-sm text-accent font-medium select-none">
          Pending candidates (${pendingRows.length}) — awaiting future data ▸
        </summary>
        <p class="text-xs text-muted mt-2 mb-2">These days may be flagged once more future weight readings are available.</p>
        <div class="overflow-x-auto">
          <table class="w-full border rounded-lg text-sm">
            <thead class="surface-2">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Type</th>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Reason</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${pendingRows.map(p => `
                <tr>
                  <td class="px-3 py-2 text-sm">${formatDisplayDate(p.date)}</td>
                  <td class="px-3 py-2 text-sm text-center">${dayTypeBadge(p.type)}</td>
                  <td class="px-3 py-2 text-xs text-muted">${p.pendingReason ?? 'Awaiting more data.'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>` : ''}
    </div>
  `;
}

// ==========================================
// VACATION / MISSED DAYS EDITOR
// ==========================================

function renderVacationEditorSection() {
  const typeOptions = Object.entries(VACATION_TYPE_CONFIG).map(([val, cfg]) =>
    `<option value="${val}">${cfg.label} — ${cfg.description}</option>`
  ).join('');

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-2">🏖️ Vacation / Missed Days</h3>

      <div class="mb-4 p-3 surface-2 rounded-lg border text-xs text-muted space-y-1">
        <p>Select a date range and assign an intake type. The model estimates calories from your TDEE history, weekday patterns, and the activity level implied by the day type, then fills in a complete synthetic day log.</p>
        <p><strong>Light</strong> — ~85% of your usual intake. <strong>Medium</strong> — ~100%. <strong>Heavy</strong> — ~110% + 200 kcal. <strong>Custom</strong> — you specify the number directly.</p>
        <p>You can override the type per day before filling. After filling, use the Estimate Management panel below to lock or remove individual estimates.</p>
      </div>

      <!-- Step 1: range + default type -->
      <div class="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label class="block text-xs text-muted mb-1">From</label>
          <input type="date" id="vac-from" class="p-1 border rounded-md text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">To</label>
          <input type="date" id="vac-to" class="p-1 border rounded-md text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Default Type</label>
          <select id="vac-default-type" class="p-1 border rounded-md text-sm">
            ${typeOptions}
          </select>
        </div>
        <button id="vac-preview-btn" class="btn btn-secondary btn-sm self-end">Preview Range</button>
      </div>

      <!-- Preview area (hidden until user clicks Preview) -->
      <div id="vac-preview-area" class="hidden">
        <div class="flex flex-wrap gap-2 mb-3">
          <button id="vac-batch-light"  class="btn btn-secondary btn-sm">Set All Light</button>
          <button id="vac-batch-medium" class="btn btn-secondary btn-sm">Set All Medium</button>
          <button id="vac-batch-heavy"  class="btn btn-secondary btn-sm">Set All Heavy</button>
        </div>

        <div class="overflow-x-auto mb-4">
          <table class="w-full border rounded-lg">
            <thead class="surface-2">
              <tr>
                <th class="px-3 py-2 text-center w-10">
                  <input type="checkbox" id="vac-check-all" class="h-4 w-4" />
                </th>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Current</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. Calories</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Type</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Custom kcal</th>
              </tr>
            </thead>
            <tbody id="vac-preview-tbody"></tbody>
          </table>
        </div>

        <button id="vac-fill-btn" class="btn btn-primary" disabled>
          <i class="fas fa-umbrella-beach mr-2"></i>Fill <span id="vac-fill-count">0</span> Selected Day(s) as Vacation
        </button>
      </div>
    </div>
  `;
}

// ==========================================
// ESTIMATE MANAGEMENT PANEL
// ==========================================

function renderEstimateManagementSection() {
  // Find all days that currently have synthetic estimates in state.dailyEntries
  const estimatedEntries = [];
  for (const [dateStr, entry] of state.dailyEntries) {
    const isSynth = entry.entryType === 'estimate' || entry.vacationDayType ||
      (entry.foodItems || []).some(fi => {
        const syntheticNames = new Set(["Day's estimate", "Estimated vacation day", "Unlogged intake estimate"]);
        return syntheticNames.has(fi?.name);
      });
    if (!isSynth) continue;
    estimatedEntries.push({ dateStr, entry });
  }
  estimatedEntries.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

  if (estimatedEntries.length === 0) return '';

  const rows = estimatedEntries.slice(0, 30).map(({ dateStr, entry }) => {
    const meta = entry.estimateMeta || {};
    const locked = Boolean(meta.locked || entry.manualLock);
    const vacType = entry.vacationDayType
      ? (VACATION_TYPE_CONFIG[entry.vacationDayType]?.label || entry.vacationDayType)
      : null;
    const typeLabel = vacType ? `Vacation (${vacType})` : (entry.entryType === 'estimate' ? 'Blank-day fill' : 'Partial adj.');
    const syntheticItems = (entry.foodItems || []).filter(fi => {
      const syntheticNames = new Set(["Day's estimate", "Estimated vacation day", "Unlogged intake estimate"]);
      return syntheticNames.has(fi?.name) ||
        (typeof fi?.id === 'string' && (fi.id.startsWith('est-') || fi.id.startsWith('vac-') || fi.id.startsWith('adj-')));
    });

    const removeButtons = syntheticItems.map(fi => `
      <button class="estimate-remove-btn btn btn-secondary btn-sm"
              data-date="${dateStr}" data-item-id="${fi.id}"
              title="Remove '${escapeHtml(fi.name)}' from this day">
        <i class="fas fa-trash-alt mr-1"></i>Remove
      </button>
    `).join('');

    return `
      <tr>
        <td class="px-3 py-2 text-sm">${formatDisplayDate(dateStr)}</td>
        <td class="px-3 py-2 text-sm">${typeLabel}</td>
        <td class="px-3 py-2 text-sm text-center">${confidenceBadge(meta.confidence)}</td>
        <td class="px-3 py-2 text-sm text-center">
          <button class="estimate-lock-btn btn btn-secondary btn-sm"
                  data-date="${dateStr}" data-locked="${locked}">
            <i class="fas ${locked ? 'fa-lock' : 'fa-lock-open'} mr-1"></i>${locked ? 'Locked' : 'Unlocked'}
          </button>
        </td>
        <td class="px-3 py-2 text-sm">${removeButtons}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-2">🔒 Estimate Management</h3>
      <p class="text-sm text-muted mb-4">
        Existing synthetic estimates for your logged history.
        <strong>Lock</strong> an estimate to prevent auto-updates if the model improves.
        <strong>Remove</strong> a synthetic item to delete only the estimate — real food items on that day are preserved.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full border rounded-lg">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Date</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Type</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Confidence</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Lock</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y">${rows}</tbody>
        </table>
      </div>
      ${estimatedEntries.length > 30 ? `<p class="text-xs text-muted mt-2">Showing 30 most recent of ${estimatedEntries.length} total estimates.</p>` : ''}
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
    rawData.push(r.weightLb);
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
