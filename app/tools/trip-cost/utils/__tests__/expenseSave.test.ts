import { describe, expect, it } from 'vitest';
import { isCurrentExpenseSave } from '../expenseSave';

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
