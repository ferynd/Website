import { describe, expect, it } from 'vitest';
import {
  ARGUMENT_RELEVANT_GAP_SECONDS,
  buildTagSummary,
  filterArgumentRelevant,
  formatArgumentRelevantTranscript,
} from '../lib/argumentTags';
import type { ArgumentTag, TaggedTranscriptSegment, TurnBlock } from '../lib/types';

function seg(start: number, end: number, tag?: ArgumentTag): TaggedTranscriptSegment {
  return { start, end, speaker: 'Kait', text: 'text', tag };
}

function block(start: number, end: number, speaker: string, tag?: ArgumentTag): TurnBlock {
  return { start, end, speaker, text: `${speaker} at ${start}`, segmentCount: 1, tag };
}

describe('buildTagSummary', () => {
  it('zero-fills every ArgumentTag value for empty input', () => {
    expect(buildTagSummary([])).toEqual({
      argument_conflict: 0,
      repair_attempt: 0,
      emotional_support: 0,
      logistics_or_normal: 0,
      unrelated: 0,
      unclear: 0,
    });
  });

  it('counts each tag value across segments', () => {
    const segments = [
      seg(0, 1, 'argument_conflict'),
      seg(1, 2, 'argument_conflict'),
      seg(2, 3, 'repair_attempt'),
      seg(3, 4, 'unclear'),
    ];
    expect(buildTagSummary(segments)).toEqual({
      argument_conflict: 2,
      repair_attempt: 1,
      emotional_support: 0,
      logistics_or_normal: 0,
      unrelated: 0,
      unclear: 1,
    });
  });

  it('does not count untagged segments toward any bucket', () => {
    const segments = [seg(0, 1, undefined), seg(1, 2, 'unrelated')];
    const summary = buildTagSummary(segments);
    expect(summary.unrelated).toBe(1);
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('filterArgumentRelevant', () => {
  it('returns an empty array for empty input', () => {
    expect(filterArgumentRelevant([])).toEqual([]);
  });

  it('keeps blocks tagged argument_conflict, repair_attempt, and emotional_support', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(10, 20, 'James', 'repair_attempt'),
      block(20, 30, 'Kait', 'emotional_support'),
    ];
    expect(filterArgumentRelevant(blocks)).toEqual(blocks);
  });

  it('drops unrelated and logistics_or_normal blocks outright', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(10, 20, 'James', 'unrelated'),
      block(20, 30, 'Kait', 'logistics_or_normal'),
      block(30, 40, 'James', 'repair_attempt'),
    ];
    const result = filterArgumentRelevant(blocks);
    expect(result).toEqual([blocks[0], blocks[3]]);
  });

  it('keeps an unclear block sandwiched within the gap between two core-tagged blocks', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(11, 20, 'James', 'unclear'),
      block(21, 30, 'Kait', 'repair_attempt'),
    ];
    expect(filterArgumentRelevant(blocks)).toEqual(blocks);
  });

  it('keeps an untagged (no tag at all) block sandwiched within the gap', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(11, 20, 'James', undefined),
      block(21, 30, 'Kait', 'repair_attempt'),
    ];
    expect(filterArgumentRelevant(blocks)).toEqual(blocks);
  });

  it('drops an unclear block whose gap to a neighbor exceeds ARGUMENT_RELEVANT_GAP_SECONDS', () => {
    const farGap = ARGUMENT_RELEVANT_GAP_SECONDS + 1;
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(10 + farGap, 10 + farGap + 5, 'James', 'unclear'),
      block(10 + farGap + 5 + 10, 10 + farGap + 5 + 20, 'Kait', 'repair_attempt'),
    ];
    expect(filterArgumentRelevant(blocks)).toEqual([blocks[0], blocks[2]]);
  });

  it('drops a leading/trailing unclear block with no core-tagged block on one side', () => {
    const blocks = [
      block(0, 10, 'Kait', 'unclear'),
      block(11, 20, 'James', 'argument_conflict'),
      block(21, 30, 'Kait', 'unclear'),
    ];
    // The first block has no preceding core block; the last has no following one.
    expect(filterArgumentRelevant(blocks)).toEqual([blocks[1]]);
  });

  it('never keeps an unrelated block even when sandwiched between two core-tagged blocks', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(11, 20, 'James', 'unrelated'),
      block(21, 30, 'Kait', 'repair_attempt'),
    ];
    expect(filterArgumentRelevant(blocks)).toEqual([blocks[0], blocks[2]]);
  });
});

describe('formatArgumentRelevantTranscript', () => {
  it('returns an empty string for empty input', () => {
    expect(formatArgumentRelevantTranscript([])).toBe('');
  });

  it('formats only the filtered blocks, one per line with a timestamp', () => {
    const blocks = [
      block(0, 10, 'Kait', 'argument_conflict'),
      block(10, 20, 'James', 'logistics_or_normal'),
    ];
    const text = formatArgumentRelevantTranscript(blocks);
    expect(text).toContain('Kait at 0');
    expect(text).not.toContain('James at 10');
  });
});
