import { describe, expect, it } from 'vitest';
import { validatePayment } from '../payment';

const TRAVELERS = ['kait', 'james', 'bob'];
const check = (amount: number | string, payerId = 'kait', payeeId = 'james') =>
  validatePayment({ payerId, payeeId, amount }, TRAVELERS);
const codes = (...args: Parameters<typeof check>) => check(...args).errors.map((e) => e.code);

describe('validatePayment (C10)', () => {
  it('accepts a positive whole-cent amount between two travelers', () => {
    expect(check(200)).toEqual({ errors: [], cents: 20000 });
    expect(check('12.34')).toEqual({ errors: [], cents: 1234 });
    expect(check(0.29).cents).toBe(29);
  });

  it('rejects negative amounts', () => {
    expect(codes(-5)).toEqual(['amount-not-positive']);
    expect(codes('-5')).toEqual(['amount-not-positive']);
  });

  it('rejects zero', () => {
    expect(codes(0)).toEqual(['amount-not-positive']);
    expect(codes('0.00')).toEqual(['amount-not-positive']);
  });

  it('rejects fractions of a cent', () => {
    expect(codes(10.005)).toEqual(['amount-fractional-cent']);
    expect(codes('0.001')).toEqual(['amount-fractional-cent']);
  });

  it('rejects missing or non-numeric amounts', () => {
    expect(codes(NaN)).toEqual(['amount-invalid']);
    expect(codes('')).toEqual(['amount-invalid']);
    expect(codes('abc')).toEqual(['amount-invalid']);
    expect(codes(Infinity)).toEqual(['amount-invalid']);
  });

  it('rejects paying yourself', () => {
    expect(codes(10, 'kait', 'kait')).toEqual(['same-person']);
  });

  it('rejects unknown or missing travelers', () => {
    expect(codes(10, 'ghost', 'james')).toEqual(['payer-unknown']);
    expect(codes(10, 'kait', 'ghost')).toEqual(['payee-unknown']);
    expect(codes(10, '', 'james')).toEqual(['payer-required']);
    expect(codes(10, 'kait', '')).toEqual(['payee-required']);
  });

  it('reports every problem and no cents when invalid', () => {
    const result = check(-1, 'ghost', 'ghost');
    expect(result.cents).toBeNull();
    expect(result.errors.map((e) => e.code)).toEqual(['amount-not-positive', 'payer-unknown', 'payee-unknown', 'same-person']);
  });
});
