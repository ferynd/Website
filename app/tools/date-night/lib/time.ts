import type { Timestamp } from 'firebase/firestore';

export const toDateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    const parsed = (value as Timestamp).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};
