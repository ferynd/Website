import { describe, expect, it } from 'vitest';
import { allocateCents, formatMoney, fromCents, parseScaledInput, toCents } from '../money';

describe('toCents / fromCents', () => {
  it('converts dollars to integer cents without binary noise', () => {
    expect(toCents(0.29)).toBe(29);
    expect(toCents(57.05)).toBe(5705);
    expect(toCents(695.75)).toBe(69575);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0)).toBe(0);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
  });

  it('rounds negatives away from zero and keeps their sign', () => {
    expect(toCents(-5)).toBe(-500);
    expect(toCents(-0.015)).toBe(-2);
  });

  it('returns NaN for non-finite input instead of a silent zero', () => {
    expect(toCents(NaN)).toBeNaN();
    expect(toCents(Infinity)).toBeNaN();
    expect(toCents(undefined as unknown as number)).toBeNaN();
  });

  it('round-trips through fromCents', () => {
    expect(fromCents(242691)).toBe(2426.91);
    expect(fromCents(-1)).toBe(-0.01);
  });
});

describe('formatMoney', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatMoney(242691)).toBe('$2,426.91');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
  });

  it('marks negatives and, when signed, positives', () => {
    expect(formatMoney(-10000)).toBe('-$100.00');
    expect(formatMoney(5000, { signed: true })).toBe('+$50.00');
    expect(formatMoney(0, { signed: true })).toBe('$0.00');
  });

  it('drops .00 only for whole dollars in compact mode', () => {
    expect(formatMoney(20000, { compact: true })).toBe('$200');
    expect(formatMoney(20050, { compact: true })).toBe('$200.50');
  });
});

describe('allocateCents (largest remainder)', () => {
  const order = ['a', 'b', 'c'];
  const even = { a: 1, b: 1, c: 1 };

  it('splits $100 three ways exactly, extra cent to the first in order', () => {
    expect(allocateCents(10000, even, order)).toEqual({ a: 3334, b: 3333, c: 3333 });
    expect(allocateCents(10000, even, ['c', 'b', 'a'])).toEqual({ a: 3333, b: 3333, c: 3334 });
  });

  it('splits $0.01 three ways: one cent to the first, zero to the rest', () => {
    expect(allocateCents(1, even, order)).toEqual({ a: 1, b: 0, c: 0 });
  });

  it('gives leftover cents to the largest remainder before order', () => {
    // 10 cents by 1:2:2 → 2, 4, 4 exactly; 11 cents → 2.2, 4.4, 4.4 → 2, 5, 4.
    expect(allocateCents(10, { a: 1, b: 2, c: 2 }, order)).toEqual({ a: 2, b: 4, c: 4 });
    expect(allocateCents(11, { a: 1, b: 2, c: 2 }, order)).toEqual({ a: 2, b: 5, c: 4 });
  });

  it('handles fractional weights such as percentages', () => {
    expect(allocateCents(10000, { a: 33.33, b: 33.33, c: 33.33 }, order)).toEqual({ a: 3334, b: 3333, c: 3333 });
    expect(allocateCents(38524, { a: 5705, b: 5705, c: 15704 + 11410 }, order)).toEqual({ a: 5705, b: 5705, c: 27114 });
  });

  it('allocates negative totals symmetrically', () => {
    expect(allocateCents(-10000, even, order)).toEqual({ a: -3334, b: -3333, c: -3333 });
  });

  it('gives zero to zero or missing weights, and zeros for a zero total', () => {
    expect(allocateCents(100, { a: 1, c: 1 }, order)).toEqual({ a: 50, b: 0, c: 50 });
    expect(allocateCents(0, {}, order)).toEqual({ a: 0, b: 0, c: 0 });
    expect(allocateCents(0, even, order)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('never hands a leftover cent to a zero weight', () => {
    expect(allocateCents(1, { a: 0, b: 1, c: 1 }, order)).toEqual({ a: 0, b: 1, c: 0 });
  });

  it('rejects impossible input rather than losing cents', () => {
    expect(() => allocateCents(100, {}, order)).toThrow(RangeError);
    expect(() => allocateCents(1.5, even, order)).toThrow(RangeError);
    expect(() => allocateCents(100, { a: -1, b: 2 }, order)).toThrow(RangeError);
  });

  it('always sums to the total', () => {
    for (let total = 0; total < 500; total += 7) {
      const shares = allocateCents(total, { a: 3, b: 7, c: 11 }, order);
      expect(shares.a + shares.b + shares.c).toBe(total);
    }
  });
});

describe('parseScaledInput', () => {
  it('parses typed decimals to integer units without rounding', () => {
    expect(parseScaledInput('12.34', 100)).toEqual({ kind: 'ok', units: 1234 });
    expect(parseScaledInput(' 0.29 ', 100)).toEqual({ kind: 'ok', units: 29 });
    expect(parseScaledInput(33.3333, 10_000)).toEqual({ kind: 'ok', units: 333333 });
    expect(parseScaledInput('-0', 100)).toEqual({ kind: 'ok', units: 0 });
  });

  it('distinguishes blank, invalid, negative and fractional input', () => {
    expect(parseScaledInput('', 100)).toEqual({ kind: 'blank' });
    expect(parseScaledInput(undefined, 100)).toEqual({ kind: 'blank' });
    expect(parseScaledInput('12abc', 100)).toEqual({ kind: 'invalid' });
    expect(parseScaledInput(NaN, 100)).toEqual({ kind: 'invalid' });
    expect(parseScaledInput('-1', 100)).toEqual({ kind: 'negative' });
    expect(parseScaledInput('10.005', 100)).toEqual({ kind: 'fractional' });
  });
});
