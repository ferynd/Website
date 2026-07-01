import { describe, expect, it } from 'vitest';
import { buildCorrectionWarning } from '../lib/correctionSummary';

describe('buildCorrectionWarning', () => {
  it('returns null when no chunks failed', () => {
    expect(buildCorrectionWarning({ failedChunks: 0, totalChunks: 12 })).toBeNull();
  });

  it('reports the failed/total chunk counts', () => {
    expect(buildCorrectionWarning({ failedChunks: 2, totalChunks: 12 })).toBe(
      'Completed with warnings: 2 of 12 correction chunks failed and were left uncorrected.',
    );
  });

  it('uses singular "chunk"/"was" when there is only one chunk total', () => {
    expect(buildCorrectionWarning({ failedChunks: 1, totalChunks: 1 })).toBe(
      'Completed with warnings: 1 of 1 correction chunk failed and was left uncorrected.',
    );
  });

  it('uses singular "was" with plural "chunks" when only one of several failed', () => {
    expect(buildCorrectionWarning({ failedChunks: 1, totalChunks: 12 })).toBe(
      'Completed with warnings: 1 of 12 correction chunks failed and was left uncorrected.',
    );
  });
});
