import { describe, expect, it } from 'vitest';
import { buildTranscriptText, formatSegmentLine, formatTimestamp, normalizeSegments } from '../lib/formatTranscript';
import type { TranscriptSegment } from '../lib/types';

describe('formatTimestamp', () => {
  it('zero-pads hours, minutes, and seconds', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(65)).toBe('00:01:05');
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('rounds to the nearest second', () => {
    expect(formatTimestamp(12.6)).toBe('00:00:13');
  });

  it('clamps negative values to zero', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00');
  });

  it('supports durations beyond 24 hours without wrapping', () => {
    expect(formatTimestamp(3 * 3600 + 90)).toBe('03:01:30');
  });
});

describe('formatSegmentLine', () => {
  it('formats a segment as [HH:MM:SS] Speaker: text', () => {
    const segment: TranscriptSegment = { start: 28, end: 30, speaker: 'Unknown', text: 'huh?' };
    expect(formatSegmentLine(segment)).toBe('[00:00:28] Unknown: huh?');
  });
});

describe('buildTranscriptText', () => {
  it('sorts segments by start time and joins with newlines', () => {
    const segments: TranscriptSegment[] = [
      { start: 12, end: 15, speaker: 'James', text: 'second line' },
      { start: 0, end: 5, speaker: 'Kait', text: 'first line' },
    ];
    expect(buildTranscriptText(segments)).toBe(
      '[00:00:00] Kait: first line\n[00:00:12] James: second line',
    );
  });
});

describe('normalizeSegments', () => {
  it('defaults a missing/blank speaker to Unknown', () => {
    const [seg] = normalizeSegments([{ start: 0, end: 1, speaker: '', text: 'hi' }]);
    expect(seg.speaker).toBe('Unknown');
  });

  it('clamps negative start and ensures end >= start', () => {
    const [seg] = normalizeSegments([{ start: -5, end: -10, speaker: 'Kait', text: 'hi' }]);
    expect(seg.start).toBe(0);
    expect(seg.end).toBeGreaterThanOrEqual(seg.start);
  });

  it('trims whitespace and drops empty-text segments', () => {
    const result = normalizeSegments([
      { start: 0, end: 1, speaker: ' Kait ', text: '  hello  ' },
      { start: 2, end: 3, speaker: 'James', text: '   ' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].speaker).toBe('Kait');
    expect(result[0].text).toBe('hello');
  });
});
