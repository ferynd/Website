import { describe, expect, it } from 'vitest';
import { draftToExpenseFields, expenseToDraft, validateDraft } from '../expenseDraft';
import { expenseSaveOriginal, isCurrentExpenseSave } from '../expenseSave';
import type { Expense } from '../../pageTypes';

describe('expense sheet async save identity', () => {
  it('ignores a completion after switching to another expense', () => {
    expect(isCurrentExpenseSave(4, 5, 'expense-a', 'expense-b')).toBe(false);
  });

  it('ignores an older request for the same expense', () => {
    expect(isCurrentExpenseSave(4, 5, 'expense-a', 'expense-a')).toBe(false);
  });

  it('accepts the active request for the visible expense', () => {
    expect(isCurrentExpenseSave(5, 5, 'expense-b', 'expense-b')).toBe(true);
  });
});

describe('acknowledged overwrite validation', () => {
  const travelers = ['a', 'b', 'c'];
  const baseline: Expense = {
    id: 'expense',
    createdBy: 'user',
    category: 'Food',
    description: 'Dinner',
    totalAmount: 100,
    paidBy: { a: 100 },
    splitType: 'manual',
    splitParticipants: travelers,
    manualSplit: {
      a: { type: 'percent', value: 33.33 },
      b: { type: 'percent', value: 33.33 },
      c: { type: 'percent', value: 33.33 },
    },
  };
  const live: Expense = {
    ...baseline,
    description: 'Updated elsewhere',
    splitType: 'even',
    manualSplit: {},
  };
  const draft = { ...expenseToDraft(baseline), description: 'Dinner tonight' };

  it('keeps an untouched legacy 99.99% split exempt against the editor snapshot', () => {
    expect(validateDraft(draft, { travelerIds: travelers, original: baseline }).errors).toEqual([]);

    const rejected = draftToExpenseFields(draft, { travelerIds: travelers, original: live });
    expect(rejected.fields).toBeNull();
    expect(rejected.errors.map((error) => error.code)).toEqual(['split-sum']);

    const accepted = draftToExpenseFields(draft, {
      travelerIds: travelers,
      original: expenseSaveOriginal(live, baseline),
    });
    expect(accepted.errors).toEqual([]);
    expect(accepted.fields).toMatchObject({
      description: 'Dinner tonight',
      splitType: 'manual',
      splitParticipants: baseline.splitParticipants,
      manualSplit: baseline.manualSplit,
      totalAmount: baseline.totalAmount,
      paidBy: baseline.paidBy,
    });
  });

  it('uses the live expense when the overwrite snapshot is missing or for another id', () => {
    expect(expenseSaveOriginal(live)).toBe(live);
    expect(expenseSaveOriginal(live, { ...baseline, id: 'other' })).toBe(live);
    expect(expenseSaveOriginal(live, baseline)).toBe(baseline);
  });
});
