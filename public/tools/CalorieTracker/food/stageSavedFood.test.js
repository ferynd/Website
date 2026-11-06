import { afterEach, describe, expect, it } from 'vitest';
import { state } from '../state/store.js';
import { legacyPartialNote, sumLegacyDayTotals } from '../nutrition/nutrientRecord.js';
import { renderDayNutrientDetail } from '../ui/nutrientDetail.js';
import { applySavedFoodToStaging } from './stageSavedFood.js';

function makeEl() {
  return {
    value: '',
    disabled: false,
    textContent: '',
    children: [],
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      contains(name) { return this.names.has(name); },
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren() {
      this.children = [];
    },
  };
}

function installDocument() {
  const elements = new Map();
  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl());
      return elements.get(id);
    },
    createElement() {
      return makeEl();
    },
  };
  globalThis.document = documentStub;
  return documentStub;
}

function textOf(node) {
  const own = node.textContent || '';
  return own + (node.children || []).map((child) => textOf(child)).join('');
}

describe('saved food staging', () => {
  afterEach(() => {
    state.stagedRecord = null;
    state.stagedDetailFoodName = null;
    delete globalThis.document;
  });

  it('clears a parse conflict when a saved food replaces the staged record', () => {
    const documentStub = installDocument();
    const buttons = ['add-day-btn', 'save-food-item-btn', 'replace-day-btn', 'subtract-day-btn'];
    for (const id of buttons) documentStub.getElementById(id).disabled = true;
    const warning = documentStub.getElementById('parse-missing-warning');
    const stale = makeEl();
    stale.textContent = 'Restore previous parse';
    stale.onclick = () => {
      state.stagedRecord = { values: { protein: 99 } };
    };
    warning.appendChild(stale);
    state.stagedRecord = { values: { protein: 99 } };

    const record = applySavedFoodToStaging({
      name: 'Yogurt',
      quantity: 2,
      nutrientSchemaVersion: 2,
      protein: 6,
      sodium: null,
    }, 1);

    expect(record.values.protein).toBe(6);
    expect(record.values.sodium).toBeNull();
    expect(state.stagedRecord.values.protein).toBe(6);
    expect(state.stagedDetailFoodName).toBe('Yogurt');
    expect(documentStub.getElementById('actual-protein').value).toBe('6');
    expect(documentStub.getElementById('actual-sodium').value).toBe('');
    expect(documentStub.getElementById('actual-quantity').value).toBe(2);
    expect(documentStub.getElementById('food-inline-qty').value).toBe(2);
    for (const id of buttons) expect(documentStub.getElementById(id).disabled).toBe(false);
    expect(warning.children).toEqual([]);
    expect(warning.classList.contains('hidden')).toBe(true);
    expect(stale.onclick).toEqual(expect.any(Function));
    expect(warning.children).not.toContain(stale);
  });

  it('shows the same partial-day note the day total helper reports', () => {
    installDocument();
    const items = [
      { nutrientSchemaVersion: 2, quantity: 1, sodium: null, calories: 10 },
      { quantity: 1, sodium: 20, calories: 5 },
    ];
    const container = makeEl();
    renderDayNutrientDetail(container, items);
    const summed = sumLegacyDayTotals(items, { missingQuantity: 0 });
    expect(summed.totals.sodium).toBe(20);
    expect(summed.totals.calories).toBe(15);
    expect(textOf(container)).toContain(legacyPartialNote(summed.partialKeys));
    const entry = {};
    expect(Object.prototype.hasOwnProperty.call(entry, 'partialKeys')).toBe(false);
  });
});
