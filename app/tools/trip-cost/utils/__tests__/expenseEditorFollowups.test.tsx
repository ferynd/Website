import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PayerPicker from '../../components/TripDetail/PayerPicker';
import { SplitPreview } from '../../components/TripDetail/ExpenseSplitControls';
import type { DefaultSplit } from '../../pageTypes';
import {
  changeExpenseMethod, createExpenseEditor, expenseMethodOptions, expensePreviewLabel,
  expenseSharesAwaitTotal, hasTripDefault, setExpenseExplicitZero, setExpenseShare, setExpenseTotal, validateDraft,
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
    expect(html).not.toMatch(/readOnly|disabled/);
    state = setExpenseShare(state, 'a', '60');
    state = setExpenseShare(state, 'b', '40');
    state = setExpenseShare(state, 'c', '0');
    state = setExpenseTotal(state, '100', ids);
    expect(validation(state).errors).toEqual([]);
    expect(validation(state).preview?.shares).toEqual({ a: 6000, b: 4000, c: 0 });
  });
});

describe('TC-P4 follow-up (e): rounding zeros are distinct from explicit zeros', () => {
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
