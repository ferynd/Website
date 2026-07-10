import { describe, expect, it } from 'vitest';
import {
  GUARD_MAX_LENGTH_RATIO,
  GUARD_MIN_LENGTH_RATIO,
  GUARD_MIN_ORIGINAL_CHARS,
  shouldRevertCorrection,
} from '../lib/correctionGuards';

const LONG_ORIGINAL = 'I just think we should have talked about this before you booked anything at all.'; // 81 chars

describe('shouldRevertCorrection', () => {
  it('keeps unchanged text', () => {
    expect(shouldRevertCorrection(LONG_ORIGINAL, LONG_ORIGINAL)).toBe(false);
  });

  it('keeps small ASR/punctuation fixes', () => {
    const fixed = 'I just think we should have talked about this before you booked anything at all!';
    expect(shouldRevertCorrection(LONG_ORIGINAL, fixed)).toBe(false);
  });

  it('always reverts empty or whitespace-only corrections', () => {
    expect(shouldRevertCorrection(LONG_ORIGINAL, '')).toBe(true);
    expect(shouldRevertCorrection(LONG_ORIGINAL, '   ')).toBe(true);
    expect(shouldRevertCorrection('uh', '')).toBe(true);
  });

  it('reverts a drastic shortening of a long segment (summary/truncation)', () => {
    expect(shouldRevertCorrection(LONG_ORIGINAL, 'We should have talked.')).toBe(true);
  });

  it('reverts a drastic expansion of a long segment (invented content)', () => {
    expect(shouldRevertCorrection(LONG_ORIGINAL, `${LONG_ORIGINAL} ${LONG_ORIGINAL} and honestly...`)).toBe(true);
  });

  it('exempts short originals from the ratio check entirely', () => {
    const short = 'mm hmm'; // under GUARD_MIN_ORIGINAL_CHARS
    expect(short.length).toBeLessThan(GUARD_MIN_ORIGINAL_CHARS);
    expect(shouldRevertCorrection(short, 'Mm-hmm, yeah, I really do think so.')).toBe(false);
    expect(shouldRevertCorrection(short, 'Mm.')).toBe(false);
  });

  it('accepts corrections right at the ratio boundaries', () => {
    const original = 'x'.repeat(100);
    expect(shouldRevertCorrection(original, 'y'.repeat(100 * GUARD_MIN_LENGTH_RATIO))).toBe(false);
    expect(shouldRevertCorrection(original, 'y'.repeat(100 * GUARD_MAX_LENGTH_RATIO))).toBe(false);
    expect(shouldRevertCorrection(original, 'y'.repeat(100 * GUARD_MIN_LENGTH_RATIO - 1))).toBe(true);
    expect(shouldRevertCorrection(original, 'y'.repeat(100 * GUARD_MAX_LENGTH_RATIO + 1))).toBe(true);
  });

  it('trims before measuring, so padding never causes a revert', () => {
    expect(shouldRevertCorrection(`  ${LONG_ORIGINAL}  `, `\n${LONG_ORIGINAL}\n`)).toBe(false);
  });
});
