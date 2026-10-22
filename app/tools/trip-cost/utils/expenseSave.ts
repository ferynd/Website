import type { Expense } from '../pageTypes';

/** Whether an async expense save still belongs to the visible editor and request. */
export function isCurrentExpenseSave(
  requestId: number,
  currentRequestId: number,
  requestExpenseId: string,
  currentExpenseId: string | null | undefined,
): boolean {
  return requestId === currentRequestId && requestExpenseId === currentExpenseId;
}

/** Stable across snapshot object/map ordering, but sensitive to every stored expense field. */
export function expenseRevision(expense: Expense): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(expense));
}

export function expenseEditStatus(
  original: Expense,
  current: Expense | undefined,
): 'unchanged' | 'changed' | 'deleted' {
  if (!current || original.id !== current.id) return 'deleted';
  return expenseRevision(original) === expenseRevision(current) ? 'unchanged' : 'changed';
}

