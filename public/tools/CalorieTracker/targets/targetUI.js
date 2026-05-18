/**
 * @file targets/targetUI.js
 * UI module for the Profile & Goals tab.
 *
 * Reads state.userProfile, state.goalSettings, state.analysisResults.
 * Writes via saveUserProfile, saveGoalSettings, saveTargets from firebase.js.
 * Calls generateTargets / applyManualOverrides from targetEngine.js.
 *
 * No direct DOM manipulation before wireProfileTab() is called.
 */

import { state } from '../state/store.js';
import { showMessage, handleError } from '../utils/ui.js';
import { saveUserProfile, saveGoalSettings, saveTargets } from '../services/firebase.js';
import { generateTargets, applyManualOverrides } from './targetEngine.js';
import { runAnalysis } from '../analysis/engine.js';

// Cache the last engine result for reference (Apply Targets always recomputes fresh)
let _lastResult = null;

// ---------------------------------------------------------------------------
// Override key definitions (ordered for display)
// ---------------------------------------------------------------------------

const MACRO_KEYS = [
  { key: 'calories',   label: 'Calories (kcal)' },
  { key: 'protein',    label: 'Protein (g)' },
  { key: 'carbs',      label: 'Carbs (g)' },
  { key: 'fat',        label: 'Fat (g)' },
  { key: 'fatMinimum', label: 'Min Fat (g)' },
];

const MICRO_KEYS = [
  { key: 'fiber',      label: 'Fiber (g)' },
  { key: 'potassium',  label: 'Potassium (mg)' },
  { key: 'magnesium',  label: 'Magnesium (mg)' },
  { key: 'sodium',     label: 'Sodium (mg)' },
  { key: 'calcium',    label: 'Calcium (mg)' },
  { key: 'choline',    label: 'Choline (mg)' },
  { key: 'vitaminB12', label: 'Vitamin B12 (mcg)' },
  { key: 'folate',     label: 'Folate (mcg)' },
  { key: 'vitaminC',   label: 'Vitamin C (mg)' },
  { key: 'vitaminB6',  label: 'Vitamin B6 (mg)' },
  { key: 'vitaminA',   label: 'Vitamin A (mcg)' },
  { key: 'vitaminD',   label: 'Vitamin D (mcg)' },
  { key: 'vitaminE',   label: 'Vitamin E (mg)' },
  { key: 'vitaminK',   label: 'Vitamin K (mcg)' },
  { key: 'selenium',   label: 'Selenium (mcg)' },
  { key: 'iodine',     label: 'Iodine (mcg)' },
  { key: 'phosphorus', label: 'Phosphorus (mg)' },
  { key: 'iron',       label: 'Iron (mg)' },
  { key: 'zinc',       label: 'Zinc (mg)' },
  { key: 'omega3',     label: 'Omega-3 (g)' },
];

const ALL_OVERRIDE_KEYS = [...MACRO_KEYS, ...MICRO_KEYS];

// ---------------------------------------------------------------------------
// Populate form from state
// ---------------------------------------------------------------------------

export function populateProfileForm() {
  const p = state.userProfile  || {};
  const g = state.goalSettings || {};

  updateWeightDisplay();

  // Manual weight override
  setVal('profile-manual-weight', p.manualWeightOverrideLb ?? '');

  // Sex radio
  const sexVal = p.sex ?? '';
  const sexEl  = document.querySelector(`input[name="profile-sex"][value="${sexVal}"]`);
  if (sexEl) sexEl.checked = true;
  else {
    const unset = document.querySelector('input[name="profile-sex"][value=""]');
    if (unset) unset.checked = true;
  }

  // Birth date / age
  setVal('profile-birthdate', p.birthDate ?? '');
  setVal('profile-age', p.birthDate ? '' : (p.age ?? ''));

  // Height
  setVal('profile-height', p.heightValue ?? '');
  setSelectVal('profile-height-unit', p.heightUnit ?? 'in');

  // Body fat %
  setVal('profile-bodyfat', p.bodyFatPercent ?? '');

  // Activity level
  const actEl = document.querySelector(
    `input[name="profile-activity"][value="${p.baselineActivityLevel ?? 'moderate'}"]`
  );
  if (actEl) actEl.checked = true;

  // Goal type
  setSelectVal('profile-goal-type', g.goalType ?? 'maintenance');

  // Target weight / date
  setVal('profile-target-weight', g.targetWeightLb ?? '');
  setVal('profile-target-date',   g.targetDate     ?? '');
}

// ---------------------------------------------------------------------------
// Weight helpers
// ---------------------------------------------------------------------------

/** Returns the weight_lb of the most recent entry in state.weightEntries, or null. */
function getLatestWeightFromEntries() {
  if (!state.weightEntries || state.weightEntries.size === 0) return null;
  let latestDate = '';
  let latestWeight = null;
  for (const entry of state.weightEntries.values()) {
    if (entry.date > latestDate && entry.weight_lb > 0) {
      latestDate = entry.date;
      latestWeight = entry.weight_lb;
    }
  }
  return latestWeight;
}

/**
 * Build the analysis context needed by generateTargets().
 * Uses state.analysisResults if already populated (Energy tab visited).
 * Otherwise attempts runAnalysis() from available data.
 * Falls back gracefully to rawLatestWeightLb only.
 */
async function buildTargetContext(mergedProfile = null) {
  if (state.analysisResults) {
    return { analysisResults: state.analysisResults, rawLatestWeightLb: getLatestWeightFromEntries() };
  }

  if (state.weightEntries?.size > 0 && state.dailyEntries?.size > 0) {
    try {
      const profile = mergedProfile ?? state.userProfile ?? null;
      const results = runAnalysis(state.weightEntries, state.dailyEntries, profile, state.weightEntriesMulti ?? null);
      return { analysisResults: results, rawLatestWeightLb: getLatestWeightFromEntries() };
    } catch (_) {
      // Fall through — raw weight only
    }
  }

  return { analysisResults: null, rawLatestWeightLb: getLatestWeightFromEntries() };
}

// ---------------------------------------------------------------------------
// Weight display
// ---------------------------------------------------------------------------

export function updateWeightDisplay() {
  const p        = state.userProfile  || {};
  const analysis = state.analysisResults;

  const valueEl  = document.getElementById('profile-weight-value');
  const sourceEl = document.getElementById('profile-weight-source');
  if (!valueEl || !sourceEl) return;

  const ovr = parseFloat(p.manualWeightOverrideLb);
  if (!isNaN(ovr) && ovr > 0) {
    valueEl.textContent  = `${ovr.toFixed(1)} lb`;
    sourceEl.textContent = 'Manual entry (override)';
    return;
  }

  const smoothed = analysis?.summary?.currentWeight;
  if (smoothed && smoothed > 0) {
    valueEl.textContent  = `${smoothed.toFixed(1)} lb`;
    sourceEl.textContent = 'Smoothed from uploaded CSV (water-corrected EWMA)';
    return;
  }

  const raw = getLatestWeightFromEntries();
  if (raw && raw > 0) {
    valueEl.textContent  = `${raw.toFixed(1)} lb`;
    sourceEl.textContent = 'Latest uploaded weight (visit Energy tab for EWMA smoothing)';
    return;
  }

  valueEl.textContent  = '—';
  sourceEl.textContent = 'Upload weight data or enter a manual override below';
}

// ---------------------------------------------------------------------------
// Read form → plain objects
// ---------------------------------------------------------------------------

function readProfileFromForm() {
  const sex = document.querySelector('input[name="profile-sex"]:checked')?.value || null;
  return {
    sex:                      sex || null,
    birthDate:                getVal('profile-birthdate')  || null,
    age:                      getNum('profile-age')        || null,
    heightValue:              getNum('profile-height')     || null,
    heightUnit:               getSelectVal('profile-height-unit') || 'in',
    bodyFatPercent:           getNum('profile-bodyfat')    || null,
    baselineActivityLevel:    document.querySelector('input[name="profile-activity"]:checked')?.value || null,
    manualWeightOverrideLb:   getNum('profile-manual-weight') || null,
  };
}

function readGoalsFromForm() {
  return {
    goalType:      getSelectVal('profile-goal-type') || 'maintenance',
    targetWeightLb: getNum('profile-target-weight') || null,
    targetDate:    getVal('profile-target-date')    || null,
  };
}

function collectManualOverrides() {
  const overrides = {};
  for (const { key } of ALL_OVERRIDE_KEYS) {
    const chk = document.getElementById(`ovr-chk-${key}`);
    const inp = document.getElementById(`ovr-val-${key}`);
    if (chk?.checked && inp) {
      const n = parseFloat(inp.value);
      if (!isNaN(n)) overrides[key] = n;
    }
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Auto-calculate handler
// ---------------------------------------------------------------------------

async function handleAutoCalculate() {
  const btn = document.getElementById('auto-calculate-targets-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating…'; }

  try {
    const profileUpdates = readProfileFromForm();
    const goalsUpdates   = readGoalsFromForm();

    const mergedProfile = { ...state.userProfile, ...profileUpdates };
    const mergedGoals   = {
      ...state.goalSettings,
      ...goalsUpdates,
      manualTargetOverrides: state.goalSettings?.manualTargetOverrides ?? {},
    };

    const { analysisResults, rawLatestWeightLb } = await buildTargetContext(mergedProfile);
    const result = generateTargets(mergedProfile, mergedGoals, analysisResults, rawLatestWeightLb);
    _lastResult  = result;

    if (!result.targets) {
      showMessage(result.warnings[0] ?? 'Cannot calculate targets.', true);
      return;
    }

    renderExplanation(result);
    renderTargetPreview(result, mergedGoals.manualTargetOverrides ?? {});

    document.getElementById('target-explanation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    handleError('auto-calculate', err, 'Failed to calculate targets.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-calculator mr-2"></i>Auto-Calculate Targets';
    }
  }
}

// ---------------------------------------------------------------------------
// Explanation rendering
// ---------------------------------------------------------------------------

function renderExplanation(result) {
  const section = document.getElementById('target-explanation');
  const content = document.getElementById('target-explanation-content');
  if (!section || !content || !result.explanation) { section?.classList.add('hidden'); return; }

  const exp = result.explanation;
  const rows = [
    ['Current weight',  exp.currentWeight],
    ['BMR / RMR',       exp.bmr],
    ['TDEE estimate',   exp.tdee],
    ...(exp.activityIgnored ? [['Activity level', exp.activityIgnored]] : []),
    ['Calorie target',  exp.calories],
    ...(exp.deficitClamped ? [['Deficit clamped', exp.deficitClamped]] : []),
    ['Protein target',  exp.protein],
    ['Fat target',      exp.fat],
    ['Carbs target',    exp.carbs],
    ['Micronutrients',  exp.micronutrients],
  ];

  content.innerHTML = rows.map(([label, value]) => `
    <div class="flex gap-3 py-1.5 border-b border-border/30 last:border-0 flex-wrap">
      <span class="text-muted shrink-0" style="min-width:9rem">${label}</span>
      <span class="text-primary">${value ?? '—'}</span>
    </div>`).join('');

  section.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Target preview + override grid
// ---------------------------------------------------------------------------

function renderTargetPreview(result, currentOverrides) {
  const section      = document.getElementById('target-preview');
  const previewEl    = document.getElementById('target-preview-content');
  const warningsSec  = document.getElementById('target-warnings');
  const warningsList = document.getElementById('target-warnings-list');
  const overrideGrid = document.getElementById('target-override-grid');

  if (!section || !previewEl) return;

  const { targets, warnings } = result;
  if (!targets) { section.classList.add('hidden'); return; }

  // ── Macro summary ───────────────────────────────────────────────────────
  const macros = [
    ['Calories', `${targets.calories} kcal`],
    ['Protein',  `${targets.protein} g`],
    ['Carbs',    `${targets.carbs} g`],
    ['Fat',      `${targets.fat} g`],
  ];

  previewEl.innerHTML = `
    <div class="grid grid-cols-2 gap-2 mb-4">
      ${macros.map(([k, v]) => `
        <div class="kpi card text-center">
          <div class="text-lg font-bold text-accent">${v}</div>
          <div class="text-xs text-muted">${k}</div>
        </div>`).join('')}
    </div>
    <details class="text-sm">
      <summary class="cursor-pointer text-secondary font-medium mb-2">All micronutrient targets ▸</summary>
      <div class="grid grid-cols-2 gap-x-4 gap-1 mt-2">
        ${MICRO_KEYS.map(({ key, label }) => `
          <div class="flex justify-between text-xs py-0.5 border-b border-border/20">
            <span class="text-muted">${label}</span>
            <span class="text-primary font-medium">${targets[key] ?? '—'}</span>
          </div>`).join('')}
      </div>
    </details>`;

  // ── Warnings ─────────────────────────────────────────────────────────────
  if (warnings?.length && warningsSec && warningsList) {
    warningsList.innerHTML = warnings.map(w => `<li>${w}</li>`).join('');
    warningsSec.classList.remove('hidden');
  } else {
    warningsSec?.classList.add('hidden');
  }

  // ── Override grid ─────────────────────────────────────────────────────────
  if (overrideGrid) {
    overrideGrid.innerHTML = ALL_OVERRIDE_KEYS.map(({ key, label }) => {
      const generated  = targets[key] ?? 0;
      const hasOvr     = key in currentOverrides;
      const ovrVal     = hasOvr ? currentOverrides[key] : generated;
      return `
        <div class="flex items-center gap-2 p-2 rounded surface-2 border border-border/30">
          <input type="checkbox" id="ovr-chk-${key}" class="override-checkbox shrink-0"
            data-key="${key}" ${hasOvr ? 'checked' : ''}>
          <label for="ovr-chk-${key}" class="text-xs text-muted cursor-pointer" style="min-width:8rem">${label}</label>
          <span class="text-xs text-secondary flex-1 text-right">auto: ${generated}</span>
          <input type="number" step="any" id="ovr-val-${key}"
            class="input w-24 text-xs"
            data-key="${key}"
            value="${ovrVal}"
            ${hasOvr ? '' : 'disabled'}
            placeholder="${generated}">
        </div>`;
    }).join('');

    overrideGrid.querySelectorAll('.override-checkbox').forEach(chk => {
      chk.addEventListener('change', () => {
        const inp = document.getElementById(`ovr-val-${chk.dataset.key}`);
        if (inp) inp.disabled = !chk.checked;
      });
    });
  }

  section.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Save handlers
// ---------------------------------------------------------------------------

async function handleSaveProfile() {
  try {
    await saveUserProfile(readProfileFromForm());
    await saveGoalSettings(readGoalsFromForm());
    updateWeightDisplay();
    showMessage('Profile and goals saved!');
  } catch (err) {
    handleError('save-profile', err, 'Failed to save profile.');
  }
}

async function handleApplyTargets() {
  const btn = document.getElementById('apply-targets-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    // Re-read form and recompute fresh — never use stale _lastResult
    const profileUpdates  = readProfileFromForm();
    const goalsUpdates    = readGoalsFromForm();
    const manualOverrides = collectManualOverrides();

    const mergedProfile = { ...state.userProfile, ...profileUpdates };
    const mergedGoals   = { ...state.goalSettings, ...goalsUpdates, manualTargetOverrides: manualOverrides };

    const { analysisResults, rawLatestWeightLb } = await buildTargetContext(mergedProfile);
    const result = generateTargets(mergedProfile, mergedGoals, analysisResults, rawLatestWeightLb);

    if (!result.targets) {
      showMessage(result.warnings[0] ?? 'Cannot calculate targets. Check profile data.', true);
      return;
    }

    // Save profile
    await saveUserProfile(profileUpdates);

    // Save goals — REPLACE overrides entirely so unchecked boxes clear saved keys
    await saveGoalSettings(
      { ...goalsUpdates, manualTargetOverrides: manualOverrides },
      { replaceOverrides: true }
    );

    // Merge generated targets with overrides and save as baseline
    const finalTargets = applyManualOverrides(result.targets, manualOverrides);
    await saveTargets(finalTargets);

    // Refresh all visible tracker UI
    const { populateSettingsForm, updateDashboard } = await import('../ui/dashboard.js');
    const { updateChart } = await import('../ui/chart.js');
    populateSettingsForm();
    updateDashboard();
    updateChart();

    showMessage('Targets applied and saved to baseline!');
  } catch (err) {
    handleError('apply-targets', err, 'Failed to apply targets.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check mr-2"></i>Apply to Baseline Targets';
    }
  }
}

// ---------------------------------------------------------------------------
// Public init — wire event listeners (call once after DOM ready)
// ---------------------------------------------------------------------------

export function wireProfileTab() {
  on('auto-calculate-targets-btn', 'click', handleAutoCalculate);
  on('apply-targets-btn',          'click', handleApplyTargets);
  on('save-profile-btn',           'click', handleSaveProfile);

  on('profile-clear-manual-weight', 'click', () => {
    setVal('profile-manual-weight', '');
    updateWeightDisplay();
  });

  // Auto-recalculate with debounce when profile fields change
  let _debounceTimer = null;
  function scheduleAutoCalculate() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      handleAutoCalculate();
    }, 800);
  }

  const autoFields = [
    'profile-manual-weight', 'profile-birthdate', 'profile-age',
    'profile-height', 'profile-bodyfat', 'profile-goal-type',
    'profile-target-weight', 'profile-target-date',
  ];
  for (const id of autoFields) {
    on(id, 'input', scheduleAutoCalculate);
    on(id, 'change', scheduleAutoCalculate);
  }
  document.querySelectorAll('input[name="profile-sex"], input[name="profile-activity"]').forEach(el => {
    el.addEventListener('change', scheduleAutoCalculate);
  });
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function on(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getVal(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function getNum(id) {
  const v = parseFloat(document.getElementById(id)?.value);
  return isNaN(v) ? null : v;
}

function setSelectVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getSelectVal(id) {
  return document.getElementById(id)?.value || '';
}
