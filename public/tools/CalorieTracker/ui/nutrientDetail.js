/**
 * Collapsed nutrient-detail panels. Text is assigned with textContent only.
 */
import { getNutrient, keysForGroup } from '../../../shared/nutrition/nutrientRegistry.js';
import { deriveDayDetailTotals, legacyPartialNote, sumLegacyDayTotals } from '../nutrition/nutrientRecord.js';
import { state } from '../state/store.js';
import { formatNutrientWithStatus } from './nutrientHelpers.js';

const PANELS = [
  { title: 'Fat breakdown', groups: ['fatClasses', 'fattyAcids'] },
  { title: 'Carbs/fiber', groups: ['sugars', 'polyols', 'fiberDetail'] },
  { title: 'Additional vitamins and minerals', groups: ['extraVitamins', 'extraMinerals'] },
  { title: 'Other', groups: ['otherComponents', 'fodmap'] },
];

const BLOCKED_IDS = ['add-day-btn', 'save-food-item-btn', 'replace-day-btn', 'subtract-day-btn'];

export function setNutrientConflictsBlocked(blocked) {
  for (const id of BLOCKED_IDS) {
    const element = document.getElementById(id);
    if (element) element.disabled = Boolean(blocked);
  }
}

/**
 * An empty paste must not hide the conflict chooser while Add, Save, Replace,
 * and Subtract stay disabled. A live conflict is left in place. With no
 * conflict, the warning is cleared and the buttons are enabled.
 * @returns {'kept' | 'cleared'}
 */
export function settleEmptyPaste(record) {
  const blocked = (record?.conflicts?.length || 0) > 0;
  if (blocked) return 'kept';
  setNutrientConflictsBlocked(false);
  const warningEl = document.getElementById('parse-missing-warning');
  if (warningEl) {
    if (typeof warningEl.replaceChildren === 'function') warningEl.replaceChildren();
    else warningEl.textContent = '';
    warningEl.classList?.add('hidden');
  }
  return 'cleared';
}

/**
 * "Keep Both (Rename)" types the new name in code. Move the detail anchor
 * with it so the loaded food's detail is not dropped on the next read.
 */
export function applyKeepBothRename(newName) {
  const trimmed = String(newName ?? '').trim();
  const input = document.getElementById('food-item-input');
  if (input) input.value = trimmed;
  if (state.stagedDetailFoodName) state.stagedDetailFoodName = trimmed || null;
  return trimmed;
}

/**
 * Rename, then save. The duplicate dialog stays open until the save commits.
 * A save that opens another duplicate dialog returns 'duplicate' and leaves
 * the typed name in place. Any other failure puts the previous name back.
 * @returns {Promise<{ status: 'name' | 'saved' | 'failed' | 'duplicate' }>}
 */
export async function commitKeepBothRename(newName, currentName, save) {
  const next = String(newName ?? '').trim();
  const current = String(currentName ?? '').trim();
  if (!next || next.toLowerCase() === current.toLowerCase()) return { status: 'name' };
  applyKeepBothRename(next);
  try {
    const saved = await save();
    if (saved === true) return { status: 'saved' };
    if (saved === 'duplicate') return { status: 'duplicate' };
  } catch (error) {
    applyKeepBothRename(current);
    throw error;
  }
  applyKeepBothRename(current);
  return { status: 'failed' };
}

/** Drop a stale parse-conflict warning and re-enable the staging actions. */
export function releaseStagingConflictBlock() {
  setNutrientConflictsBlocked(false);
  const warningEl = document.getElementById('parse-missing-warning');
  if (!warningEl) return;
  if (typeof warningEl.replaceChildren === 'function') warningEl.replaceChildren();
  else warningEl.textContent = '';
  warningEl.classList?.add('hidden');
}

function panelKeys(groups) {
  const keys = [];
  for (const group of groups) keys.push(...keysForGroup(group));
  return keys;
}

function addLine(parent, text) {
  const line = document.createElement('div');
  line.textContent = text;
  parent.appendChild(line);
}

function observed(record, key) {
  const value = record?.values?.[key];
  const quality = record?.quality?.[key];
  if (typeof value === 'number') return true;
  if (quality?.upperBound != null) return true;
  return Boolean(quality && quality.status && quality.status !== 'unknown');
}

export function renderNutrientDetail(container, record) {
  if (!container) return;
  container.replaceChildren();
  const root = document.createElement('div');
  for (const panel of PANELS) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = panel.title;
    details.appendChild(summary);
    const body = document.createElement('div');
    let shown = 0;
    for (const key of panelKeys(panel.groups)) {
      if (!observed(record, key)) continue;
      const def = getNutrient(key);
      addLine(body, `${def?.label || key}: ${formatNutrientWithStatus(record.values[key], def, record.quality?.[key])}`);
      shown += 1;
    }
    if (shown === 0) addLine(body, 'No detail nutrients staged.');
    details.appendChild(body);
    root.appendChild(details);
  }
  container.appendChild(root);
}

export function renderDayNutrientDetail(container, foodItems) {
  if (!container) return;
  container.replaceChildren();
  const totals = deriveDayDetailTotals(foodItems);
  const legacy = sumLegacyDayTotals(foodItems || [], { missingQuantity: 0 });
  const root = document.createElement('div');
  if (legacy.partialKeys.length) {
    const note = document.createElement('p');
    note.textContent = legacyPartialNote(legacy.partialKeys);
    root.appendChild(note);
  }
  for (const panel of PANELS) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = panel.title;
    details.appendChild(summary);
    const body = document.createElement('div');
    let shown = 0;
    for (const key of panelKeys(panel.groups)) {
      const row = totals[key];
      if (!row || row.coverage === 'none') continue;
      const def = getNutrient(key);
      const prefix = row.coverage === 'partial' ? '≥ ' : '';
      addLine(body, `${def?.label || key}: ${prefix}${row.value} ${def?.unit || ''}`.trim());
      shown += 1;
    }
    if (shown === 0) addLine(body, 'No detail nutrients logged.');
    details.appendChild(body);
    root.appendChild(details);
  }
  container.appendChild(root);
}

export function clearNutrientDetailMounts() {
  for (const id of ['nutrient-detail-staging', 'nutrient-detail-food']) {
    const element = document.getElementById(id);
    if (element) element.replaceChildren();
  }
  setNutrientConflictsBlocked(false);
}
