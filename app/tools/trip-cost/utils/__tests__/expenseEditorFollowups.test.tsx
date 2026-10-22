import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PayerPicker from '../../components/TripDetail/PayerPicker';
import { SplitPreview } from '../../components/TripDetail/ExpenseSplitControls';
import type { DefaultSplit } from '../../pageTypes';
import {
  changeExpenseMethod, createExpenseEditor, draftToExpenseFields, expenseExplicitZero, expenseMethodOptions, expensePreviewLabel,
  expenseSharesAwaitTotal, hasTripDefault, setExpenseExplicitZero, setExpenseShare, setExpenseTotal, toggleExpenseTraveler, validateDraft,
  type ExpenseEditorState,
} from '../expenseDraft';

vi.mock('@/components/Button', () => ({ default: 'button' }));
vi.mock('@/components/Input', () => ({ default: 'input' }));
vi.mock('@/components/Select', () => ({ default: 'select' }));

const ids = ['a', 'b', 'c'];
const travelers = ids.map((id) => ({ id, name: id.toUpperCase() }));
const validation = (state: ExpenseEditorState) => validateDraft(state.draft, { travelerIds: ids });
function ready(method: 'amount' | 'percent' | 'equal' = 'equal') {
  const state = createExpenseEditor(ids, 'Food', undefined, 'b');
  state.draft.description = 'Dinner';
  state.draft.totalAmount = '100';
  state.draft.paidBy = { b: '100' };
  return changeExpenseMethod(state, method, ids);
}

describe('TC-P4 follow-up (a): payer selection and first-render validation agree', () => {
  it('keeps the selected default in the initial draft without a spurious payer error', () => {
    const state = createExpenseEditor(ids, 'Food', undefined, 'b');
    expect(state.draft.paidBy).toEqual({ b: '' });
    expect(validation(state).errors.some((error) => error.code === 'payer-required')).toBe(false);
    const html = renderToStaticMarkup(<PayerPicker draft={state.draft} travelers={travelers} multiple={false}
      onMultiple={() => {}} onChange={() => {}} errorId="payer-reason" errors={[]} />);
    expect(html).toContain('<option value="b" selected="">B</option>');
  });

  it('shows an empty selected placeholder when no payer is linked', () => {
    const state = createExpenseEditor(ids, 'Food');
    expect(state.draft.paidBy).toEqual({});
    expect(validation(state).errors.some((error) => error.code === 'payer-required')).toBe(true);
    const html = renderToStaticMarkup(<PayerPicker draft={state.draft} travelers={travelers} multiple={false}
      onMultiple={() => {}} onChange={() => {}} errorId="payer-reason" errors={[]} />);
    expect(html).toContain('<option value="" selected="">Choose who paid</option>');
    expect(html).not.toContain('<option value="a" selected');
  });
});

describe('TC-P4 follow-up (b): invalid custom previews show entered units', () => {
  it.each(['amount', 'percent'] as const)('%s never presents a rescaled allocation as final', (method) => {
    let state = ready(method);
    state = setExpenseShare(state, 'a', '120');
    state = setExpenseShare(state, 'b', '0');
    state = setExpenseShare(state, 'c', '0');
    const result = validation(state);
    expect(result.errors.map((error) => error.code)).toEqual(['split-sum']);
    expect(result.preview?.notFinal).toBe(true);
    expect(expensePreviewLabel(state, result.preview, 'a')).toBe(method === 'amount' ? '$120.00 (not final)' : '120% (not final)');
    const html = renderToStaticMarkup(<SplitPreview travelers={travelers} state={state} preview={result.preview}
      showInputs errorId="split-reason" onValue={() => {}} onZero={() => {}} />);
    expect(html).toContain('Entered shares are not final.');
    expect(html).not.toContain('>$100.00<');
  });

  it('also keeps a one-cent / 0.01% mismatch visible despite legacy ledger tolerance', () => {
    let amount = setExpenseShare(ready('amount'), 'a', '100.01');
    amount = setExpenseShare(setExpenseShare(amount, 'b', '0'), 'c', '0');
    expect(expensePreviewLabel(amount, validation(amount).preview, 'a')).toBe('$100.01 (not final)');
    let percent = setExpenseShare(ready('percent'), 'a', '99.99');
    percent = setExpenseShare(setExpenseShare(percent, 'b', '0'), 'c', '0');
    expect(expensePreviewLabel(percent, validation(percent).preview, 'a')).toBe('99.99% (not final)');
  });
});

describe('TC-P4 follow-up (c): method choices reflect an actual default', () => {
  it.each<DefaultSplit | undefined>([undefined, {}, { a: 0 }, { a: NaN }, { a: -1 }])('omits Trip default for %j', (weights) => {
    expect(expenseMethodOptions(hasTripDefault(weights)).map((method) => method.value)).toEqual(['equal', 'amount', 'percent']);
  });

  it('includes Trip default only when a positive weight exists', () => {
    expect(expenseMethodOptions(hasTripDefault({ a: 100 })).map((method) => method.value)).toEqual(['equal', 'trip-default', 'amount', 'percent']);
  });
});

describe('TC-P4 follow-up (d): invalid percent to dollar conversion stays editable', () => {
  function incompletePercentages() {
    let state = ready('percent');
    state = setExpenseTotal(state, '', ids);
    state = setExpenseShare(state, 'a', '50');
    state = setExpenseShare(state, 'b', '30');
    return setExpenseShare(state, 'c', '');
  }

  it.each(['', '100'])('keeps invalid percentage text visible and unsavable when switching with total %j', (total) => {
    let state = setExpenseTotal(ready('percent'), total, ids);
    state = setExpenseShare(state, 'a', '100');
    state = setExpenseShare(state, 'b', '1.23456');
    state = setExpenseShare(state, 'c', '0');
    state = changeExpenseMethod(state, 'amount', ids);
    expect(state.draft.manualSplit.b).toEqual({ type: 'amount', value: '1.23456' });
    state = setExpenseTotal(state, '100', ids);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'amount', value: '100.00' },
      b: { type: 'amount', value: '1.23456' },
      c: { type: 'amount', value: '0.00' },
    });
    const result = validation(state);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'share-invalid', travelerId: 'b' })]);
    expect(expenseExplicitZero(state, 'b')).toBe(false);
    expect(expensePreviewLabel(state, result.preview, 'b')).toBe('Invalid share (not final)');
    expect(draftToExpenseFields(state.draft, { travelerIds: ids }).fields).toBeNull();
    const html = renderToStaticMarkup(<SplitPreview travelers={travelers} state={state} preview={result.preview}
      showInputs errorId="split-reason" onValue={() => {}} onZero={() => {}} />);
    expect(html).toContain('value="1.23456"');
    expect(html).toContain('Invalid share (not final)');
    state = setExpenseShare(state, 'b', '0');
    expect(validation(state).errors).toEqual([]);
  });

  it('disables zero toggles until a total exists without dropping retained percentages', () => {
    const state = changeExpenseMethod(incompletePercentages(), 'amount', ids);
    for (const id of ids) {
      expect(setExpenseExplicitZero(state, id, true, ids)).toBe(state);
      expect(setExpenseExplicitZero(state, id, false, ids)).toBe(state);
    }
    const html = renderToStaticMarkup(<SplitPreview travelers={travelers} state={state} preview={null}
      showInputs errorId="split-reason" onValue={() => {}} onZero={() => {}} />);
    const checkboxes = html.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(3);
    for (const input of checkboxes) expect(input).toContain('disabled=""');
    const converted = setExpenseTotal(state, '100', ids);
    expect(converted.draft.manualSplit.a.value).toBe('50.00');
    expect(converted.draft.manualSplit.b.value).toBe('30.00');
    expect(setExpenseExplicitZero(converted, 'a', true, ids).draft.manualSplit.a.value).toBe('0');
  });

  it('retains incomplete and invalid percentages through traveler exclusion and reinclusion', () => {
    const original = setExpenseShare(incompletePercentages(), 'c', '1.23456');
    let state = changeExpenseMethod(original, 'amount', ids);
    for (const id of ['c', 'b', 'b', 'c']) {
      state = toggleExpenseTraveler(state, id, ids);
      expect(state.pendingPercents).toEqual(original.draft.manualSplit);
      for (const included of state.draft.splitParticipants) expect(expenseExplicitZero(state, included)).toBe(false);
    }
    expect(changeExpenseMethod(state, 'percent', ids).draft.manualSplit).toEqual(original.draft.manualSplit);
    state = setExpenseTotal(state, '100', ids);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'amount', value: '50.00' }, b: { type: 'amount', value: '30.00' },
      c: { type: 'amount', value: '1.23456' },
    });
    expect(validation(state).errors).toContainEqual(expect.objectContaining({ code: 'share-invalid', travelerId: 'c' }));
  });

  it.each(['', '0', 'invalid'])('clears stale converted dollars when a pending total becomes %j', (total) => {
    const original = setExpenseShare(incompletePercentages(), 'c', '1.23456');
    let state = changeExpenseMethod(original, 'amount', ids);
    state = setExpenseTotal(state, '100', ids);
    state = setExpenseTotal(state, total, ids);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'amount', value: '' }, b: { type: 'amount', value: '' },
      c: { type: 'amount', value: '1.23456' },
    });
    expect(state.pendingPercents).toEqual(original.draft.manualSplit);
    for (const id of ids) expect(expenseExplicitZero(state, id)).toBe(false);
    state = setExpenseTotal(state, '200', ids);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'amount', value: '100.00' }, b: { type: 'amount', value: '60.00' },
      c: { type: 'amount', value: '1.23456' },
    });
  });

  it('retains 50/30 until a total arrives and converts the entered percentages without rescaling', () => {
    let state = changeExpenseMethod(incompletePercentages(), 'amount', ids);
    expect(expenseSharesAwaitTotal(state)).toBe(false);
    expect(state.pendingPercents).toMatchObject({ a: { value: '50' }, b: { value: '30' }, c: { value: '' } });
    for (const id of ids) expect(expenseExplicitZero(state, id)).toBe(false);
    const html = renderToStaticMarkup(<SplitPreview travelers={travelers} state={state} preview={null}
      showInputs errorId="split-reason" onValue={() => {}} onZero={() => {}} />);
    expect(html).not.toMatch(/checked=""|readOnly/);
    for (const input of html.match(/<input\b[^>]*type="text"[^>]*>/g) ?? []) expect(input).not.toContain('disabled');
    state = setExpenseTotal(state, '1', ids);
    expect(state.draft.manualSplit).toMatchObject({ a: { value: '0.50' }, b: { value: '0.30' }, c: { value: '' } });
    state = setExpenseTotal(state, '100', ids);
    expect(state.draft.manualSplit).toMatchObject({ a: { value: '50.00' }, b: { value: '30.00' }, c: { value: '' } });
    expect(validation(state).errors.map((error) => error.code)).toEqual(['split-sum']);
    expect(expensePreviewLabel(state, validation(state).preview, 'a')).toBe('$50.00 (not final)');
    state = setExpenseShare(state, 'b', '50');
    expect(validation(state).errors).toEqual([]);
    expect(draftToExpenseFields(state.draft, { travelerIds: ids }).fields?.manualSplit).toEqual({
      a: { type: 'amount', value: 50 }, b: { type: 'amount', value: 50 }, c: { type: 'amount', value: 0 },
    });
  });

  it('restores the original percentages when switching back before entering a total', () => {
    const original = incompletePercentages();
    const dollars = changeExpenseMethod(original, 'amount', ids);
    expect(changeExpenseMethod(dollars, 'percent', ids).draft.manualSplit).toEqual(original.draft.manualSplit);
  });

  it('lets a dollar edit replace the retained percentages before entering a total', () => {
    let state = changeExpenseMethod(incompletePercentages(), 'amount', ids);
    state = setExpenseShare(state, 'a', '60');
    state = setExpenseShare(state, 'b', '40');
    state = setExpenseTotal(state, '100', ids);
    expect(state.pendingPercents).toBeUndefined();
    expect(validation(state).preview?.shares).toEqual({ a: 6000, b: 4000, c: 0 });
    expect(validation(state).errors).toEqual([]);
  });

  it.each(['', '100'])('can correct Custom $ in place with total %j', (total) => {
    let state = ready('percent');
    state.draft.totalAmount = total;
    state = setExpenseShare(state, 'a', '120');
    state = setExpenseShare(setExpenseShare(state, 'b', '0'), 'c', '0');
    state = changeExpenseMethod(state, 'amount', ids);
    expect(state.method).toBe('amount');
    expect(state.draft.manualSplitMode).toBe('amount');
    expect(expenseSharesAwaitTotal(state)).toBe(false);
    if (total) {
      expect(state.draft.manualSplit.a.value).toBe('120.00');
      expect(validation(state).errors.map((error) => error.code)).toEqual(['split-sum']);
    }
    const html = renderToStaticMarkup(<SplitPreview travelers={travelers} state={state} preview={validation(state).preview}
      showInputs errorId="split-reason" onValue={() => {}} onZero={() => {}} />);
    expect(html).toContain('Dollar share for A');
    expect(html).not.toContain('readOnly');
    for (const input of html.match(/<input\b[^>]*type="text"[^>]*>/g) ?? []) expect(input).not.toContain('disabled');
    state = setExpenseShare(state, 'a', '60');
    state = setExpenseShare(state, 'b', '40');
    state = setExpenseShare(state, 'c', '0');
    state = setExpenseTotal(state, '100', ids);
    expect(validation(state).errors).toEqual([]);
    expect(validation(state).preview?.shares).toEqual({ a: 6000, b: 4000, c: 0 });
  });
});

describe('TC-P4 follow-up (e): rounding zeros are distinct from explicit zeros', () => {
  it('keeps blank custom zeros explicit after an Equal zero toggle', () => {
    let state = setExpenseTotal(ready(), '90', ids);
    state.draft.paidBy = { b: '90' };
    state = setExpenseExplicitZero(state, 'c', true, ids);
    state = changeExpenseMethod(state, 'percent', ids);
    state = setExpenseShare(state, 'a', '100');
    state = setExpenseShare(state, 'b', '');
    expect(state.zeroOrigin).toBeDefined();
    expect(expenseExplicitZero(state, 'b')).toBe(true);
    expect(expensePreviewLabel(state, validation(state).preview, 'b')).toBe('$0.00 (explicit)');
    expect(draftToExpenseFields(state.draft, { travelerIds: ids }).fields?.manualSplit.b).toEqual({ type: 'percent', value: 0 });
  });

  it('keeps missing default entries explicit after another traveler is zeroed and restored', () => {
    const weights = { a: 1, b: 1 };
    let state = changeExpenseMethod(ready(), 'trip-default', ids, weights);
    expect(expenseExplicitZero(state, 'c')).toBe(true);
    state = setExpenseExplicitZero(state, 'b', true, ids, weights);
    expect(expenseExplicitZero(state, 'b')).toBe(true);
    expect(expenseExplicitZero(state, 'c')).toBe(true);
    expect(expensePreviewLabel(state, validation(state).preview, 'c')).toBe('$0.00 (explicit)');
    expect(draftToExpenseFields(state.draft, { travelerIds: ids }).fields?.manualSplit.c).toEqual({ type: 'percent', value: 0 });
    state = setExpenseExplicitZero(state, 'b', false, ids, weights);
    expect(state.method).toBe('trip-default');
    expect(expenseExplicitZero(state, 'c')).toBe(true);
  });

  it('labels tiny Equal remainder zeros as money, including after converting to dollars', () => {
    let state = ready();
    state.draft.totalAmount = '0.01';
    state.draft.paidBy = { b: '0.01' };
    expect(validation(state).preview?.shares).toEqual({ a: 1, b: 0, c: 0 });
    expect(expensePreviewLabel(state, validation(state).preview, 'b')).toBe('$0.00');
    expect(expensePreviewLabel(state, validation(state).preview, 'c')).toBe('$0.00');
    state = changeExpenseMethod(state, 'amount', ids);
    expect(expensePreviewLabel(state, validation(state).preview, 'b')).toBe('$0.00');
    state = setExpenseShare(state, 'b', '0');
    expect(expensePreviewLabel(state, validation(state).preview, 'b')).toBe('$0.00 (explicit)');
  });

  it('labels a zero explicitly chosen by the user', () => {
    const state = setExpenseExplicitZero(ready(), 'c', true, ids);
    expect(expensePreviewLabel(state, validation(state).preview, 'c')).toBe('$0.00 (explicit)');
  });

  it('keeps pending Equal-to-dollar rounding zeros implicit once the total is entered', () => {
    let state = changeExpenseMethod(createExpenseEditor(ids, 'Food', undefined, 'b'), 'amount', ids);
    state = setExpenseTotal(state, '0.01', ids);
    state.draft.description = 'Penny';
    state.draft.paidBy = { b: '0.01' };
    expect(expensePreviewLabel(state, validation(state).preview, 'c')).toBe('$0.00');
  });
});
