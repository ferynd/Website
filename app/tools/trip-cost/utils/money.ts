import { CURRENCY_SYMBOL } from '../constants';

/* ------------------------------------------------------------------ */
/*  Integer-cent money helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Converts a stored dollar amount to integer cents (half away from zero).
 * Returns NaN for non-finite input so callers can flag it explicitly
 * instead of silently treating it as zero.
 */
export function toCents(dollars: number): number {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) return NaN;
  // toPrecision strips binary noise such as 0.29 * 100 = 28.999999999999996.
  const cents = Math.round(Number((Math.abs(dollars) * 100).toPrecision(15)));
  if (cents === 0) return 0;
  return dollars < 0 ? -cents : cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export interface FormatMoneyOptions {
  /** Prefix positive amounts with "+". */
  signed?: boolean;
  /** Drop ".00" from whole-dollar amounts ("$200" instead of "$200.00"). */
  compact?: boolean;
}

/** Formats integer cents as "$1,234.56" / "-$1.00" (or "+$1.00" when signed). */
export function formatMoney(cents: number, options: FormatMoneyOptions = {}): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rem = abs % 100;
  const body =
    options.compact && rem === 0
      ? `${CURRENCY_SYMBOL}${dollars}`
      : `${CURRENCY_SYMBOL}${dollars}.${rem.toString().padStart(2, '0')}`;
  if (cents < 0 && abs !== 0) return `-${body}`;
  if (options.signed && abs !== 0) return `+${body}`;
  return body;
}

/* ------------------------------------------------------------------ */
/*  Largest-remainder allocation                                       */
/* ------------------------------------------------------------------ */

const WEIGHT_SCALE = 1e6;

/**
 * Splits `totalCents` across the ids in `order` in proportion to `weights`,
 * exactly to the cent (largest remainder). Leftover cents go to the largest
 * fractional remainders; ties go to the id that comes first in `order`.
 *
 * - Ids missing from `weights` (or with weight 0) receive 0.
 * - Weights must be finite and non-negative. A non-zero total with no
 *   positive weight throws, because there is nobody to allocate to.
 * - Negative totals allocate the absolute value and negate each share.
 */
export function allocateCents(
  totalCents: number,
  weights: Record<string, number>,
  order: string[],
): Record<string, number> {
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError(`allocateCents: total must be integer cents, got ${totalCents}`);
  }
  const ids = Array.from(new Set(order));
  const result: Record<string, number> = {};
  // Scale weights to integers so the remainder comparison is exact.
  const scaled = ids.map((id) => {
    const w = weights[id] ?? 0;
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(`allocateCents: invalid weight for ${id}: ${w}`);
    }
    return BigInt(Math.round(w * WEIGHT_SCALE));
  });
  const weightSum = scaled.reduce((s, w) => s + w, BigInt(0));
  if (weightSum === BigInt(0)) {
    if (totalCents !== 0) {
      throw new RangeError('allocateCents: no positive weight to allocate a non-zero total');
    }
    for (const id of ids) result[id] = 0;
    return result;
  }

  const sign = totalCents < 0 ? -1 : 1;
  const total = BigInt(Math.abs(totalCents));
  const parts = ids.map((id, index) => {
    const num = total * scaled[index];
    return { id, index, base: num / weightSum, rem: num % weightSum };
  });
  let leftover = total - parts.reduce((s, p) => s + p.base, BigInt(0));
  const byRemainder = parts
    .slice()
    .sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const part of byRemainder) {
    if (leftover <= BigInt(0)) break;
    // Only ids with a positive weight may receive a leftover cent.
    if (scaled[part.index] === BigInt(0)) continue;
    part.base += BigInt(1);
    leftover -= BigInt(1);
  }
  for (const part of parts) {
    const cents = Number(part.base) * sign;
    result[part.id] = cents === 0 ? 0 : cents;
  }
  return result;
}
