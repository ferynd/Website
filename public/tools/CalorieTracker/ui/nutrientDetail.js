/**
 * Collapsed nutrient-detail panels. Text is assigned with textContent only.
 */
import { getNutrient, keysForGroup } from '../../shared/nutrition/nutrientRegistry.js';
import { deriveDayDetailTotals, sumLegacyDayTotals } from '../nutrition/nutrientRecord.js';
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
    note.textContent = `Partial day totals (≥): ${legacy.partialKeys.join(', ')}.`;
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
