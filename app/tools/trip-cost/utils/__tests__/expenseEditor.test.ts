import { describe, expect, it } from 'vitest';
import {
  changeExpenseMethod,
  createExpenseEditor,
  draftToExpenseFields,
  expenseEditorError,
  expensePayerRemainder,
  setExpenseExplicitZero,
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
    const state = ready('percent');
    state.draft.manualSplit = {
      a: { type: 'percent', value: '100' },
      b: { type: 'percent', value: '0' },
      c: { type: 'percent', value: '0' },
    };
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
