import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SplitPreview } from '../../components/TripDetail/ExpenseSplitControls';

vi.mock('@/components/Button', () => ({
  default: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props),
}));
vi.mock('@/components/Input', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
}));
import {
  changeExpenseMethod,
  createExpenseEditor,
  draftToExpenseFields,
  expenseEditorError,
  expensePayerRemainder,
  setExpenseExplicitZero,
  setExpenseShare,
  setExpenseTotal,
  showsExplicitZero,
  toggleExpenseTraveler,
  travelersMissingFromDefault,
  validateDraft,
  type ExpenseEditorMethod,
  type ExpenseEditorState,
} from '../expenseDraft';
import { expenseEditStatus, expenseRevision } from '../expenseSave';
import { allocateExpense } from '../ledger';
import { uniqueLinkedParticipant } from '../payer';
import type { Expense, TripParticipant } from '../../pageTypes';

const ids = ['a', 'b', 'c'];
const defaultSplit = { a: 50, b: 25, c: 25 };

function ready(method: ExpenseEditorMethod = 'equal'): ExpenseEditorState {
  const state = createExpenseEditor(ids, 'Food', undefined, 'a');
  state.draft.description = 'Dinner';
  state.draft.totalAmount = '10.01';
  state.draft.paidBy = { a: '10.01' };
  return changeExpenseMethod(state, method, ids, defaultSplit);
}

function save(state: ExpenseEditorState, original?: Expense): Expense {
  const result = draftToExpenseFields(state.draft, { travelerIds: ids, original });
  expect(result.errors).toEqual([]);
  if (!result.fields) throw new Error('Invalid test draft');
  return { id: 'e', createdBy: 'user', ...result.fields };
}

describe('shared editor split methods', () => {
  it.each<ExpenseEditorMethod>(['equal', 'trip-default', 'amount', 'percent'])(
    '%s stores the expected representation and round-trips exactly', (method) => {
      const state = ready(method);
      const expense = save(state);
      expect(expense.splitType).toBe(method === 'equal' ? 'even' : 'manual');
      expect(Object.values(expense.manualSplit).map((entry) => entry.type)).toEqual(
        method === 'equal' ? [] : ids.map(() => method === 'amount' ? 'amount' : 'percent'),
      );
      const loaded = createExpenseEditor(ids, 'Food', { a: 100 }, 'b', expense);
      expect(loaded.method).toBe(method === 'trip-default' ? 'percent' : method);
      expect(save(loaded, expense)).toStrictEqual(expense);
      expect(validateDraft(state.draft, { travelerIds: ids }).preview?.shares).toEqual(allocateExpense(expense, ids).shares);
    },
  );

  it('starts new drafts on Trip default with all travelers and the linked payer', () => {
    const participants: TripParticipant[] = ids.map((id) => ({ id, name: id, isRegistered: id === 'a', addedBy: 'user', ...(id === 'a' ? { userId: 'user' } : {}) }));
    const payer = uniqueLinkedParticipant(participants, 'user');
    const state = createExpenseEditor(ids, 'Food', defaultSplit, payer?.id);
    expect(state.method).toBe('trip-default');
    expect(state.draft.splitParticipants).toEqual(ids);
    expect(state.draft.paidBy).toEqual({ a: '' });
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '25' },
      c: { type: 'percent', value: '25' },
    });
  });

  it('requires a payer when the account has no unique link', () => {
    const state = ready();
    state.draft.paidBy = {};
    expect(validateDraft(state.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Pick who paid.']);
  });

  it('rescales D2 snapshots after excluding a traveler; re-inclusion restores their weight', () => {
    const state = toggleExpenseTraveler(ready('trip-default'), 'c', ids, defaultSplit);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '66.6667' },
      b: { type: 'percent', value: '33.3333' },
    });
    expect(save(state).splitParticipants).toEqual(['a', 'b']);
    expect(allocateExpense(save(state), ids).shares).toEqual({ a: 667, b: 334 });
    expect(toggleExpenseTraveler(state, 'c', ids, defaultSplit).draft.manualSplit).toEqual(ready('trip-default').draft.manualSplit);
  });

  it('keeps missing default travelers included at explicit zero and blocks all-zero weights', () => {
    let state = changeExpenseMethod(ready(), 'trip-default', ids, { a: 100 });
    expect(travelersMissingFromDefault({ a: 100 }, ids)).toEqual(['b', 'c']);
    expect(save(state).manualSplit.c).toEqual({ type: 'percent', value: 0 });
    state = toggleExpenseTraveler(state, 'a', ids, { a: 100 });
    expect(validateDraft(state.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Percentages total 0% of 100%.']);
  });

  it('round-trips explicit zeros and exclusions as distinct choices', () => {
    let state = setExpenseExplicitZero(ready(), 'b', true, ids);
    state = toggleExpenseTraveler(state, 'c', ids);
    // Keep the custom snapshot valid after explicitly changing its membership.
    state.draft.manualSplit.a.value = '100';
    const expense = save(state);
    expect(expense.splitType).toBe('manual');
    expect(expense.manualSplit.b).toEqual({ type: 'percent', value: 0 });
    expect(expense.splitParticipants).toEqual(['a', 'b']);
    expect(save(createExpenseEditor(ids, 'Food', defaultSplit, undefined, expense), expense)).toStrictEqual(expense);
    expect(validateDraft(state.draft, { travelerIds: ids }).preview).toMatchObject({ zeroShare: ['b'], excluded: ['c'] });
  });

  it('zero toggles preserve custom entries and let the traveler be edited again', () => {
    const original = ready('amount');
    const zero = setExpenseExplicitZero(original, 'b', true, ids);
    expect(zero.draft.manualSplit.a).toEqual(original.draft.manualSplit.a);
    expect(zero.draft.manualSplit.b.value).toBe('0');
    expect(Number(setExpenseExplicitZero(zero, 'b', false, ids).draft.manualSplit.b.value)).toBeGreaterThan(0);
  });

  it('unchecking an unchanged Equal-derived zero restores Equal and a valid split', () => {
    const original = ready();
    const zero = setExpenseExplicitZero(original, 'b', true, ids);
    expect(zero.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '0' },
      c: { type: 'percent', value: '50' },
    });
    const restored = setExpenseExplicitZero(zero, 'b', false, ids);
    expect(restored.method).toBe('equal');
    expect(restored.draft.splitType).toBe('even');
    expect(save(restored)).toStrictEqual(save(original));
  });

  it('restores equal weights while preserving remaining explicit zeros and exclusions', () => {
    const fourIds = [...ids, 'd'];
    const state = setExpenseExplicitZero(setExpenseExplicitZero(ready(), 'b', true, ids), 'c', true, ids);
    const restored = setExpenseExplicitZero(state, 'b', false, fourIds);
    expect(restored.method).toBe('percent');
    expect(restored.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '50' },
      c: { type: 'percent', value: '0' },
    });
    expect(validateDraft(restored.draft, { travelerIds: fourIds })).toMatchObject({
      errors: [], preview: { excluded: ['d'], zeroShare: ['c'] },
    });
  });

  it.each<ExpenseEditorMethod>(['percent', 'amount'])(
    '%s: unchecking zero preserves edited custom shares and requires rebalancing', (method) => {
      let zero = changeExpenseMethod(setExpenseExplicitZero(ready(), 'b', true, ids), method, ids);
      if (method === 'percent') {
        zero = { ...zero, draft: { ...zero.draft, manualSplit: {
          a: { type: 'percent', value: '60' },
          b: { type: 'percent', value: '0' },
          c: { type: 'percent', value: '40' },
        } } };
      }
      expect(allocateExpense(save(zero), ids).shares.b).toBe(0);
      const restored = setExpenseExplicitZero(zero, 'b', false, ids);
      expect(Number(restored.draft.manualSplit.b.value)).toBeGreaterThan(0);
      expect(restored.draft.manualSplit.a).toEqual(zero.draft.manualSplit.a);
      expect(restored.draft.manualSplit.c).toEqual(zero.draft.manualSplit.c);
      const result = draftToExpenseFields(restored.draft, { travelerIds: ids });
      // Custom entries are kept; totals must be corrected before this can save.
      expect(result.fields).toBeNull();
      expect(result.errors.map((error) => error.code)).toEqual(['split-sum']);
      const balanced = changeExpenseMethod(restored, 'equal', ids);
      expect(Object.values(allocateExpense(save(balanced), ids).shares).every((share) => share > 0)).toBe(true);
    },
  );

  it.each([defaultSplit, undefined])('rebalances Trip default zero shares with default weights %j', (weights) => {
    const zero = setExpenseExplicitZero(ready('trip-default'), 'b', true, ids, weights);
    expect(zero.method).toBe('percent');
    expect(zero.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '66.6667' },
      b: { type: 'percent', value: '0' },
      c: { type: 'percent', value: '33.3333' },
    });
    expect(allocateExpense(save(zero), ids).shares).toEqual({ a: 667, b: 0, c: 334 });
  });

  it.each([
    { traveler: 'a', weights: defaultSplit },
    { traveler: 'b', weights: defaultSplit },
    { traveler: 'a', weights: undefined },
    { traveler: 'b', weights: undefined },
  ])('restores Trip default after zeroing $traveler with weights $weights', ({ traveler, weights }) => {
    const original = ready('trip-default');
    const zero = setExpenseExplicitZero(original, traveler, true, ids, weights);
    const restored = setExpenseExplicitZero(zero, traveler, false, ids, weights);
    expect(restored.method).toBe('trip-default');
    expect(restored.draft.manualSplit).toEqual(original.draft.manualSplit);
    expect(save(restored)).toStrictEqual(save(original));
  });

  it('restores default weights while leaving another explicit zero in place', () => {
    let state = setExpenseExplicitZero(ready('trip-default'), 'b', true, ids, defaultSplit);
    state = setExpenseExplicitZero(state, 'a', true, ids, defaultSplit);
    expect(state.draft.manualSplit.c.value).toBe('100');
    state = setExpenseExplicitZero(state, 'b', false, ids, defaultSplit);
    expect(state.method).toBe('percent');
    expect(save(state).manualSplit).toEqual({
      a: { type: 'percent', value: 0 },
      b: { type: 'percent', value: 50 },
      c: { type: 'percent', value: 50 },
    });
    state = setExpenseExplicitZero(state, 'a', false, ids, defaultSplit);
    expect(state.method).toBe('trip-default');
    expect(save(state)).toStrictEqual(save(ready('trip-default')));
  });

  it.each<ExpenseEditorMethod>(['equal', 'trip-default'])(
    '%s: unchecking zero keeps hand-edited shares even when they happen to be equal', (method) => {
      const zero = setExpenseExplicitZero(ready(method), 'b', true, ids, defaultSplit);
      zero.draft.manualSplit = {
        a: { type: 'percent', value: '40' },
        b: { type: 'percent', value: '0' },
        c: { type: 'percent', value: '40' },
      };
      const restored = setExpenseExplicitZero(zero, 'b', false, ids, defaultSplit);
      expect(restored.method).toBe('percent');
      expect(restored.draft.manualSplit.a.value).toBe('40');
      expect(restored.draft.manualSplit.c.value).toBe('40');
      expect(Number(restored.draft.manualSplit.b.value)).toBeGreaterThan(0);
      expect(validateDraft(restored.draft, { travelerIds: ids }).errors.map((error) => error.code)).toEqual(['split-sum']);
    },
  );

  it('does not infer Equal from equal-looking custom percentages with no zero provenance', () => {
    const state = ready('percent');
    state.draft.manualSplit = {
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '0' },
      c: { type: 'percent', value: '50' },
    };
    const restored = setExpenseExplicitZero(state, 'b', false, ids);
    expect(restored.method).toBe('percent');
    expect(restored.draft.manualSplit.a.value).toBe('50');
    expect(restored.draft.manualSplit.c.value).toBe('50');
    expect(Number(restored.draft.manualSplit.b.value)).toBeGreaterThan(0);
    expect(validateDraft(restored.draft, { travelerIds: ids }).errors.map((error) => error.code)).toEqual(['split-sum']);
  });

  it('keeps valid hand-edited default shares when they happen to be equal', () => {
    const zero = setExpenseExplicitZero(ready('trip-default'), 'b', true, ids, defaultSplit);
    zero.draft.manualSplit.a.value = '50';
    zero.draft.manualSplit.c.value = '50';
    const restored = setExpenseExplicitZero(zero, 'b', false, ids, defaultSplit);
    expect(restored.method).toBe('percent');
    expect(restored.draft.manualSplit.a.value).toBe('50');
    expect(restored.draft.manualSplit.c.value).toBe('50');
    expect(Number(restored.draft.manualSplit.b.value)).toBeGreaterThan(0);
    expect(validateDraft(restored.draft, { travelerIds: ids }).errors.map((error) => error.code)).toEqual(['split-sum']);
  });

  it.each([true, false])('unchecking a missing default traveler restores a positive share (zero toggled: %s)', (toggleZero) => {
    const weights = { a: 75, c: 25 };
    const state = changeExpenseMethod(ready(), 'trip-default', ids, weights);
    const zero = toggleZero ? setExpenseExplicitZero(state, 'b', true, ids, weights) : state;
    const restored = setExpenseExplicitZero(zero, 'b', false, ids, weights);
    expect(restored.method).toBe('percent');
    expect(Number(restored.draft.manualSplit.b.value)).toBeGreaterThan(0);
    expect(restored.draft.manualSplit.a.value).toBe('75');
    expect(restored.draft.manualSplit.c.value).toBe('25');
    expect(validateDraft(restored.draft, { travelerIds: ids }).errors.map((error) => error.code)).toEqual(['split-sum']);
  });

  it.each(['10.00', '10.03', '10.01'])(
    'keeps stored even-split order and tie cents after changing only the total to %s', (amount) => {
      const expense: Expense = { ...save(ready()), totalAmount: 10, paidBy: { a: 10 }, splitParticipants: ['c', 'a', 'b'] };
      const state = createExpenseEditor(ids, 'Food', undefined, undefined, expense);
      state.draft.totalAmount = amount;
      state.draft.paidBy = { a: amount };
      const updated = save(state, expense);
      expect(updated.splitParticipants).toEqual(expense.splitParticipants);
      const expected = allocateExpense({ ...expense, totalAmount: Number(amount), paidBy: { a: Number(amount) } }, ids).shares;
      expect(allocateExpense(updated, ids).shares).toEqual(expected);
      expect(validateDraft(state.draft, { travelerIds: ids, original: expense }).preview?.shares).toEqual(expected);
      expect(expected.c).toBe(Math.ceil(Number(amount) * 100 / 3));
    },
  );

  it.each([0.01, 0.02])(
    'keeps [c, b, a] even-split cents when switching a $%s expense to Custom $ or Custom %',
    (amount) => {
      const expense: Expense = {
        id: 'e', createdBy: 'user', category: 'Food', description: 'Penny',
        totalAmount: amount, paidBy: { a: amount }, splitType: 'even',
        splitParticipants: ['c', 'b', 'a'], manualSplit: {},
      };
      const loaded = createExpenseEditor(ids, 'Food', undefined, undefined, expense);
      const expected = allocateExpense(expense, ids).shares;
      const customAmount = changeExpenseMethod(loaded, 'amount', ids);
      if (amount === 0.01) {
        expect(customAmount.draft.manualSplit).toEqual({
          c: { type: 'amount', value: '0.01' },
          b: { type: 'amount', value: '0.00' },
          a: { type: 'amount', value: '0.00' },
        });
      }
      expect(allocateExpense(save(customAmount, expense), ids).shares).toEqual(expected);
      const customPercent = changeExpenseMethod(loaded, 'percent', ids);
      expect(allocateExpense(save(customPercent, expense), ids).shares).toEqual(expected);
      const tripDefault = changeExpenseMethod(loaded, 'trip-default', ids, { a: 1, b: 1, c: 1 });
      expect(allocateExpense(save(tripDefault, expense), ids).shares).toEqual(expected);
    },
  );

  it.each([0.01, 0.02])(
    'keeps [c, b, a] even-split cents for $%s when an explicit zero is applied before Custom $',
    (amount) => {
      const expense: Expense = {
        id: 'e', createdBy: 'user', category: 'Food', description: 'Penny',
        totalAmount: amount, paidBy: { a: amount }, splitType: 'even',
        splitParticipants: ['c', 'b', 'a'], manualSplit: {},
      };
      const loaded = createExpenseEditor(ids, 'Food', undefined, undefined, expense);
      const expected = allocateExpense(expense, ids).shares;
      const zeroed = setExpenseExplicitZero(loaded, 'a', true, ids);
      expect(allocateExpense(save(zeroed, expense), ids).shares).toEqual(expected);
      const customAmount = changeExpenseMethod(zeroed, 'amount', ids);
      expect(allocateExpense(save(customAmount, expense), ids).shares).toEqual(expected);
    },
  );

  it.each<ExpenseEditorMethod>(['equal', 'percent'])(
    '%s keeps stored order after excluding a traveler', (method) => {
      const expense: Expense = { ...save(ready(method)), splitParticipants: ['c', 'b', 'a'] };
      const state = toggleExpenseTraveler(createExpenseEditor(ids, 'Food', undefined, undefined, expense), 'b', ids);
      if (method === 'percent') {
        state.draft.manualSplit.a.value = '50';
        state.draft.manualSplit.c.value = '50';
      }
      const updated = save(state, expense);
      expect(updated.splitParticipants).toEqual(['c', 'a']);
      expect(allocateExpense(updated, ids).shares).toEqual({ c: 501, a: 500 });
    },
  );

  it('keeps stored travelers ahead of newly included travelers when saving', () => {
    const expense: Expense = { ...save(ready()), splitParticipants: ['c', 'a'] };
    const state = toggleExpenseTraveler(createExpenseEditor(ids, 'Food', undefined, undefined, expense), 'b', ids);
    expect(save(state, expense).splitParticipants).toEqual(['c', 'a', 'b']);
  });

  it.each([{ order: ids }, { order: ['c', 'b', 'a'] }])(
    'restores legacy percentage split order $order after toggling a traveler off and on', ({ order }) => {
      const expense: Expense = {
        ...save(ready()), splitType: 'manual', splitParticipants: order,
        manualSplit: Object.fromEntries(ids.map((id) => [id, { type: 'percent', value: 33.33 }])),
      };
      const loaded = createExpenseEditor(ids, 'Food', undefined, undefined, expense);
      const excluded = toggleExpenseTraveler(loaded, 'b', ids);
      const restored = toggleExpenseTraveler(excluded, 'b', ids);
      expect(restored.draft).toStrictEqual(loaded.draft);
      expect(save(restored, expense)).toStrictEqual(expense);
    },
  );

  it.each(['0.01', '10.01', '100.00', '349.99', '9999.99'])(
    '$ ↔ %% conversions keep totals cents-exact for $%s', (amount) => {
      let state = ready('amount');
      state.draft.totalAmount = amount;
      state.draft.paidBy = { a: amount };
      state = changeExpenseMethod(state, 'equal', ids);
      state = changeExpenseMethod(state, 'amount', ids);
      const before = allocateExpense(save(state), ids).shares;
      state = changeExpenseMethod(state, 'percent', ids);
      expect(Object.values(save(state).manualSplit).reduce((sum, entry) => sum + Math.round(entry.value * 10000), 0)).toBe(1000000);
      state = changeExpenseMethod(state, 'amount', ids);
      expect(allocateExpense(save(state), ids).shares).toEqual(before);
    },
  );

  it('loads legacy mixed splits as Custom $ while a no-change save retains mixed storage', () => {
    const expense: Expense = {
      ...save(ready()), totalAmount: 100, paidBy: { a: 100 }, splitType: 'manual',
      splitParticipants: ['b', 'a'],
      manualSplit: { a: { type: 'amount', value: 50 }, b: { type: 'percent', value: 50 } },
    };
    const state = createExpenseEditor(ids, 'Food', defaultSplit, undefined, expense);
    expect(state.method).toBe('amount');
    expect(state.draft.manualSplit).toEqual({ b: { type: 'amount', value: '50.00' }, a: { type: 'amount', value: '50.00' } });
    expect(save(state, expense)).toStrictEqual(expense);
    expect(validateDraft(state.draft, { travelerIds: ids, original: expense }).preview?.shares).toEqual(allocateExpense(expense, ids).shares);
  });

  it('can change historical payers, total, split method, and traveler membership together', () => {
    const expense = save(ready());
    let state = createExpenseEditor(ids, 'Food', defaultSplit, undefined, expense);
    state.draft.totalAmount = '20';
    state.draft.paidBy = { b: '12', c: '8' };
    state = toggleExpenseTraveler(state, 'a', ids);
    state = changeExpenseMethod(state, 'percent', ids);
    const updated = save(state, expense);
    expect(updated.paidBy).toEqual({ b: 12, c: 8 });
    expect(updated.splitParticipants).toEqual(['b', 'c']);
    expect(allocateExpense(updated, ids).shares).toEqual({ b: 1000, c: 1000 });
  });
});

describe('editor remainder and validation copy', () => {
  it('shows multi-payer remainders, overpayment, exact coverage, and invalid input', () => {
    const state = ready();
    state.draft.totalAmount = '100';
    state.draft.paidBy = { a: '60', b: '30', c: '' };
    expect(expensePayerRemainder(state.draft)).toBe(1000);
    expect(validateDraft(state.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Payers total $90.00 of $100.00.']);
    state.draft.paidBy.c = '15';
    expect(expensePayerRemainder(state.draft)).toBe(-500);
    state.draft.paidBy.c = '10';
    expect(expensePayerRemainder(state.draft)).toBe(0);
    expect(validateDraft(state.draft, { travelerIds: ids }).errors).toEqual([]);
    state.draft.paidBy.c = '10.001';
    expect(expensePayerRemainder(state.draft)).toBeNull();
    state.draft.totalAmount = '';
    expect(expensePayerRemainder(state.draft)).toBeNull();
  });

  it('explains empty membership and custom amount / percent mismatches', () => {
    const empty = ready();
    empty.draft.splitParticipants = [];
    expect(validateDraft(empty.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Include at least one traveler.']);
    const amount = ready('amount');
    amount.draft.totalAmount = '100';
    amount.draft.paidBy = { a: '100' };
    amount.draft.manualSplit = { a: { type: 'amount', value: '95' } };
    expect(validateDraft(amount.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Custom split totals $95.00 of $100.00.']);
    const percent = ready('percent');
    percent.draft.manualSplit = { a: { type: 'percent', value: '98' } };
    expect(validateDraft(percent.draft, { travelerIds: ids }).errors.map(expenseEditorError)).toEqual(['Percentages total 98% of 100%.']);
  });
});

describe('stale edit detection', () => {
  const original = save(ready('percent'));

  it('ignores Firestore snapshot identity and map key order', () => {
    const current = { ...original, manualSplit: Object.fromEntries(Object.entries(original.manualSplit).reverse()) };
    expect(expenseRevision(current)).toBe(expenseRevision(original));
    expect(expenseEditStatus(original, current)).toBe('unchanged');
  });

  it.each<Partial<Expense>>([
    { description: 'Changed' }, { category: 'Other' }, { totalAmount: 11 },
    { paidBy: { b: 10.01 } }, { splitType: 'even' }, { splitParticipants: ['b', 'a', 'c'] },
    { manualSplit: { a: { type: 'percent', value: 100 } } }, { createdBy: 'someone-else' },
  ])('detects a stored field changing: %j', (patch) => {
    expect(expenseEditStatus(original, { ...original, ...patch })).toBe('changed');
  });

  it('distinguishes deletion / switching from a changed expense', () => {
    expect(expenseEditStatus(original, undefined)).toBe('deleted');
    expect(expenseEditStatus(original, { ...original, id: 'another' })).toBe('deleted');
  });
});

describe('explicit zero stays reversible when travelers change', () => {
  const four = ['a', 'b', 'c', 'd'];

  function equalThree(): ExpenseEditorState {
    const state = toggleExpenseTraveler(createExpenseEditor(four, 'Food', undefined, 'a'), 'd', four);
    state.draft.description = 'Dinner';
    state.draft.totalAmount = '90';
    state.draft.paidBy = { a: '90' };
    return state;
  }

  it('gives a newly added traveler an equal share after an Equal explicit zero', () => {
    const state = toggleExpenseTraveler(setExpenseExplicitZero(equalThree(), 'b', true, four), 'd', four);
    expect(state.method).toBe('percent');
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '33.3334' },
      b: { type: 'percent', value: '0' },
      c: { type: 'percent', value: '33.3333' },
      d: { type: 'percent', value: '33.3333' },
    });
    const checked = validateDraft(state.draft, { travelerIds: four });
    expect(checked.errors).toEqual([]);
    expect(checked.preview?.shares).toEqual({ a: 3000, b: 0, c: 3000, d: 3000 });
    const restored = setExpenseExplicitZero(state, 'b', false, four);
    expect(restored.method).toBe('equal');
    expect(restored.zeroOrigin).toBeUndefined();
    expect(validateDraft(restored.draft, { travelerIds: four }).preview?.shares).toEqual({ a: 2250, b: 2250, c: 2250, d: 2250 });
  });

  it('returns to Equal when the zeroed traveler is removed', () => {
    const state = toggleExpenseTraveler(setExpenseExplicitZero(equalThree(), 'b', true, four), 'b', four);
    expect(state.method).toBe('equal');
    expect(state.zeroOrigin).toBeUndefined();
    expect(state.draft.splitParticipants).toEqual(['a', 'c']);
    expect(validateDraft(state.draft, { travelerIds: four }).preview?.shares).toEqual({ a: 4500, c: 4500 });
  });

  it('rescales a Trip default after a zero when another traveler is removed, then restores it', () => {
    const weights = { a: 40, b: 30, c: 20, d: 10 };
    let state = createExpenseEditor(four, 'Food', weights, 'a');
    state.draft.description = 'Dinner';
    state.draft.totalAmount = '90';
    state.draft.paidBy = { a: '90' };
    state = toggleExpenseTraveler(setExpenseExplicitZero(state, 'd', true, four, weights), 'c', four, weights);
    expect(state.method).toBe('percent');
    expect(state.draft.splitParticipants).toEqual(['a', 'b', 'd']);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '57.1429' },
      b: { type: 'percent', value: '42.8571' },
      d: { type: 'percent', value: '0' },
    });
    expect(validateDraft(state.draft, { travelerIds: four }).errors).toEqual([]);
    state = setExpenseExplicitZero(state, 'd', false, four, weights);
    expect(state.method).toBe('trip-default');
    expect(state.zeroOrigin).toBeUndefined();
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '37.5' },
      d: { type: 'percent', value: '12.5' },
    });
    expect(validateDraft(state.draft, { travelerIds: four }).errors).toEqual([]);
  });

  it('gives a hand-edited zero snapshot a positive share for a new traveler', () => {
    const zero = setExpenseExplicitZero(equalThree(), 'b', true, four);
    zero.draft.manualSplit.a.value = '40';
    const state = toggleExpenseTraveler(zero, 'd', four);
    expect(state.draft.manualSplit.a.value).toBe('40');
    expect(state.draft.manualSplit.b.value).toBe('0');
    expect(state.draft.manualSplit.c.value).toBe('50');
    expect(state.draft.manualSplit.d).toEqual({ type: 'percent', value: '25' });
    expect(validateDraft(state.draft, { travelerIds: four }).errors.map((error) => error.code)).toEqual(['split-sum']);
    const removed = toggleExpenseTraveler(state, 'c', four);
    expect(removed.draft.manualSplit.a.value).toBe('40');
    expect(removed.draft.manualSplit.d.value).toBe('25');
    expect(validateDraft(removed.draft, { travelerIds: four }).errors.map((error) => error.code)).toEqual(['split-sum']);
  });
});

describe('Custom $ chosen before a total keeps shares', () => {
  it('converts an Equal split once the total is entered', () => {
    let state = createExpenseEditor(ids, 'Food', undefined, 'a');
    state.draft.description = 'Dinner';
    state = changeExpenseMethod(state, 'amount', ids);
    expect(state.method).toBe('amount');
    expect(state.pendingPercents).toBeDefined();
    expect(state.draft.manualSplitMode).toBe('percent');
    expect(Object.values(state.draft.manualSplit).every((entry) => entry.value.trim() !== '')).toBe(true);
    state = setExpenseTotal(state, '3', ids);
    expect(validateDraft({ ...state.draft, paidBy: { a: '3' } }, { travelerIds: ids }).preview?.shares).toEqual({ a: 100, b: 100, c: 100 });
    state = setExpenseTotal(state, '30', ids);
    state.draft.paidBy = { a: '30' };
    expect(state.draft.manualSplitMode).toBe('amount');
    const checked = validateDraft(state.draft, { travelerIds: ids });
    expect(checked.errors).toEqual([]);
    expect(checked.preview?.shares).toEqual({ a: 1000, b: 1000, c: 1000 });
    const edited = setExpenseShare(state, 'a', '5.00');
    const resized = setExpenseTotal(edited, '60', ids);
    expect(resized.draft.manualSplit.a.value).toBe('5.00');
    expect(resized.pendingPercents).toBeUndefined();
  });

  it('converts a Trip default once the total is entered', () => {
    let state = createExpenseEditor(ids, 'Food', defaultSplit, 'a');
    state.draft.description = 'Dinner';
    state = changeExpenseMethod(state, 'amount', ids, defaultSplit);
    expect(state.pendingPercents).toBeDefined();
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'percent', value: '50' },
      b: { type: 'percent', value: '25' },
      c: { type: 'percent', value: '25' },
    });
    state = setExpenseTotal(state, '30', ids);
    state.draft.paidBy = { a: '30' };
    const checked = validateDraft(state.draft, { travelerIds: ids });
    expect(checked.errors).toEqual([]);
    expect(checked.preview?.shares).toEqual({ a: 1500, b: 750, c: 750 });
  });

  it('still converts immediately when the total is already valid', () => {
    const state = changeExpenseMethod(ready(), 'amount', ids);
    expect(state.pendingPercents).toBeUndefined();
    expect(state.draft.manualSplitMode).toBe('amount');
    expect(Object.values(state.draft.manualSplit).every((entry) => entry.type === 'amount' && entry.value !== '')).toBe(true);
  });
});

describe('legacy manual values survive an unedited mode round trip', () => {
  const legacy: Expense = {
    id: 'e', createdBy: 'user', category: 'Food', description: 'Legacy',
    totalAmount: 30, paidBy: { a: 30 }, splitType: 'manual',
    splitParticipants: ['a', 'b', 'c'],
    manualSplit: {
      a: { type: 'amount', value: 10 },
      b: { type: 'amount', value: 10 },
      c: { type: 'amount', value: 10.01 },
    },
  };

  it('restores the loaded Custom $ strings when switching to Custom % and back', () => {
    let state = createExpenseEditor(ids, 'Food', undefined, undefined, legacy);
    expect(state.draft.manualSplit.a.value).toBe('10');
    state = changeExpenseMethod(state, 'percent', ids);
    state = changeExpenseMethod(state, 'amount', ids);
    expect(state.draft.manualSplit).toEqual({
      a: { type: 'amount', value: '10' },
      b: { type: 'amount', value: '10' },
      c: { type: 'amount', value: '10.01' },
    });
    const result = draftToExpenseFields(state.draft, { travelerIds: ids, original: legacy });
    expect(result.errors).toEqual([]);
    expect(result.fields?.manualSplit).toEqual(legacy.manualSplit);
  });

  it('keeps an edited percent conversion instead of restoring the legacy strings', () => {
    let state = createExpenseEditor(ids, 'Food', undefined, undefined, legacy);
    state = changeExpenseMethod(state, 'percent', ids);
    state.draft.manualSplit.a.value = '10';
    state = changeExpenseMethod(state, 'amount', ids);
    expect(state.draft.manualSplit.a.value).not.toBe('10');
    expect(state.draft.manualSplit).not.toEqual({
      a: { type: 'amount', value: '10' },
      b: { type: 'amount', value: '10' },
      c: { type: 'amount', value: '10.01' },
    });
  });
});

describe('explicit-zero checkbox matches blank save semantics', () => {
  it('counts a blank Custom $ or Custom % share as checked and leaves Equal unchecked', () => {
    expect(showsExplicitZero('amount', 'manual', '')).toBe(true);
    expect(showsExplicitZero('percent', 'manual', '   ')).toBe(true);
    expect(showsExplicitZero('amount', 'manual', '0')).toBe(true);
    expect(showsExplicitZero('amount', 'manual', '0.00')).toBe(true);
    expect(showsExplicitZero('percent', 'manual', '10')).toBe(false);
    expect(showsExplicitZero('equal', 'even', '')).toBe(false);
    expect(showsExplicitZero('trip-default', 'manual', '0')).toBe(true);
    expect(showsExplicitZero('trip-default', 'manual', '')).toBe(false);
  });

  it('checks the preview box for a blank included Custom $ share', () => {
    const state = ready('amount');
    state.draft.totalAmount = '30';
    state.draft.paidBy = { a: '30' };
    state.draft.manualSplit = {
      a: { type: 'amount', value: '15' },
      b: { type: 'amount', value: '' },
      c: { type: 'amount', value: '15' },
    };
    const preview = validateDraft(state.draft, { travelerIds: ids }).preview;
    expect(preview?.shares.b).toBe(0);
    const html = renderToStaticMarkup(React.createElement(SplitPreview, {
      travelers: ids.map((id) => ({ id, name: id.toUpperCase() })),
      state,
      preview,
      showInputs: true,
      errorId: 'split-error',
      onValue: () => {},
      onZero: () => {},
    }));
    expect(html).toContain('$0.00 (explicit)');
    const rows = html.split('<li');
    const blankRow = rows.find((row) => row.includes('>B<'));
    const filledRow = rows.find((row) => row.includes('>A<'));
    expect(blankRow).toContain('checked=""');
    expect(filledRow).not.toContain('checked=""');
  });
});
