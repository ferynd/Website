import { afterEach, describe, expect, it } from 'vitest';
import { emptyStagedRecord } from '../../../shared/nutrition/nutrientRegistry.js';
import { foodNameLeavesStagedDetail, withoutStagedDetail } from '../nutrition/nutrientRecord.js';
import { state } from '../state/store.js';
import { applyKeepBothRename, settleEmptyPaste } from '../ui/nutrientDetail.js';

const BUTTONS = ['add-day-btn', 'save-food-item-btn', 'replace-day-btn', 'subtract-day-btn'];

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

describe('round 5 staging holes', () => {
  afterEach(() => {
    state.stagedRecord = null;
    state.stagedDetailFoodName = null;
    delete globalThis.document;
  });

  it('an empty paste keeps a conflict explanation and the disabled actions', () => {
    const documentStub = installDocument();
    for (const id of BUTTONS) documentStub.getElementById(id).disabled = true;
    const warning = documentStub.getElementById('parse-missing-warning');
    warning.classList.remove('hidden');
    const note = makeEl();
    note.textContent = 'Conflicting values need a choice before Add, Save, or Replace.';
    warning.appendChild(note);

    const result = settleEmptyPaste({ conflicts: [{ key: 'protein', values: [10, 11] }] });

    expect(result).toBe('kept');
    expect(warning.children).toContain(note);
    expect(warning.classList.contains('hidden')).toBe(false);
    expect(note.textContent).toContain('Conflicting values');
    for (const id of BUTTONS) expect(documentStub.getElementById(id).disabled).toBe(true);
  });

  it('an empty paste with no conflict clears the warning and enables the actions', () => {
    const documentStub = installDocument();
    for (const id of BUTTONS) documentStub.getElementById(id).disabled = true;
    const warning = documentStub.getElementById('parse-missing-warning');
    warning.classList.remove('hidden');
    warning.appendChild(makeEl());

    expect(settleEmptyPaste({ conflicts: [] })).toBe('cleared');
    expect(settleEmptyPaste(null)).toBe('cleared');
    expect(warning.children).toEqual([]);
    expect(warning.classList.contains('hidden')).toBe(true);
    for (const id of BUTTONS) expect(documentStub.getElementById(id).disabled).toBe(false);
  });

  it('Keep Both (Rename) moves the remembered food name so loaded detail stays', () => {
    const documentStub = installDocument();
    const input = documentStub.getElementById('food-item-input');
    input.value = 'Yogurt';
    state.stagedDetailFoodName = 'Yogurt';
    const record = emptyStagedRecord();
    record.values.protein = 6;
    record.values.fatSaturated = 3;
    record.quality.protein = { status: 'label_reported' };
    record.quality.fatSaturated = { status: 'label_reported' };

    const dropped = foodNameLeavesStagedDetail('Yogurt', 'Yogurt (v2)')
      ? withoutStagedDetail(record)
      : record;
    expect(dropped.values.protein).toBe(6);
    expect(dropped.values.fatSaturated).toBeNull();

    expect(applyKeepBothRename('Yogurt (v2)')).toBe('Yogurt (v2)');
    expect(input.value).toBe('Yogurt (v2)');
    expect(state.stagedDetailFoodName).toBe('Yogurt (v2)');
    const kept = foodNameLeavesStagedDetail(state.stagedDetailFoodName, input.value)
      ? withoutStagedDetail(record)
      : record;
    expect(kept.values.protein).toBe(6);
    expect(kept.values.fatSaturated).toBe(3);
    expect(foodNameLeavesStagedDetail(state.stagedDetailFoodName, input.value)).toBe(false);
  });

  it('a rename with no remembered food does not invent an anchor', () => {
    const documentStub = installDocument();
    const input = documentStub.getElementById('food-item-input');
    input.value = 'Yogurt';
    state.stagedDetailFoodName = null;
    applyKeepBothRename('Yogurt (v2)');
    expect(input.value).toBe('Yogurt (v2)');
    expect(state.stagedDetailFoodName).toBeNull();
    expect(foodNameLeavesStagedDetail(state.stagedDetailFoodName, input.value)).toBe(false);
  });
});
