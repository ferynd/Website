/** Whether an async expense save still belongs to the visible sheet and request. */
export function isCurrentExpenseSave(
  requestId: number,
  currentRequestId: number,
  requestExpenseId: string,
  currentExpenseId: string | null | undefined,
): boolean {
  return requestId === currentRequestId && requestExpenseId === currentExpenseId;
}
