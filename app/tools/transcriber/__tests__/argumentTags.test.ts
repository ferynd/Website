import { describe, expect, it } from 'vitest';
import {
  buildArgumentRanges,
  buildTagSummary,
  filterArgumentRelevant,
  formatArgumentRelevantTranscript,
} from '../lib/argumentTags';
import type { ArgumentTag, TaggedTranscriptSegment, TurnBlock } from '../lib/types';

let blockCounter = 0;
function block(start: number, end: number, tag: ArgumentTag | undefined, text?: string): TurnBlock {
  blockCounter += 1;
  const id = `t${blockCounter}`;
  return {
    id,
    start,
    end,
    speaker: 'Kait',
    text: text ?? `block ${id}`,
    segmentCount: 1,
    segmentIds: [`s0-${blockCounter}`],
    ...(tag ? { tag } : {}),
  };
}

describe('buildTagSummary', () => {
  it('zero-fills every tag and counts occurrences on any tagged items', () => {
    const segments: TaggedTranscriptSegment[] = [
      { start: 0, end: 1, speaker: 'Kait', text: 'a', tag: 'argument_conflict' },
      { start: 1, end: 2, speaker: 'James', text: 'b', tag: 'argument_conflict' },
      { start: 2, end: 3, speaker: 'Kait', text: 'c', tag: 'unclear' },
      { start: 3, end: 4, speaker: 'Kait', text: 'd' },
    ];
    const summary = buildTagSummary(segments);
    expect(summary).toEqual({
      argument_conflict: 2,
      repair_attempt: 0,
      emotional_support: 0,
      logistics_or_normal: 0,
      unrelated: 0,
      unclear: 1,
    });
  });

  it('works on turn blocks too (the classification unit)', () => {
    const summary = buildTagSummary([block(0, 10, 'repair_attempt'), block(10, 20, undefined)]);
    expect(summary.repair_attempt).toBe(1);
    expect(summary.unclear).toBe(0);
  });
});

describe('buildArgumentRanges / filterArgumentRelevant', () => {
  const EXPAND = { expandSeconds: 90 };

  it('conflict near the beginning: the range clamps at 0 and captures the lead-out', () => {
    blockCounter = 0;
    const blocks = [
      block(10, 40, 'argument_conflict'),
      block(50, 80, 'logistics_or_normal'),
      block(500, 560, 'unrelated'),
    ];
    const ranges = buildArgumentRanges(blocks, EXPAND);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].end).toBe(130);
    const kept = filterArgumentRelevant(blocks, EXPAND);
    expect(kept.map((b) => b.id)).toEqual(['t1', 't2']);
  });

  it('conflict near the end: the lead-in is captured, the earlier chatter is not', () => {
    blockCounter = 0;
    const blocks = [
      block(0, 60, 'unrelated'),
      block(900, 950, 'logistics_or_normal'), // within 90s before the conflict
      block(1000, 1060, 'argument_conflict'),
    ];
    const kept = filterArgumentRelevant(blocks, EXPAND);
    expect(kept.map((b) => b.id)).toEqual(['t2', 't3']);
  });

  it('earlier argument followed by a neutral ending: the neutral tail is excluded', () => {
    blockCounter = 0;
    const blocks = [
      block(100, 200, 'argument_conflict'),
      block(210, 260, 'repair_attempt'),
      block(600, 700, 'logistics_or_normal'),
      block(710, 800, 'unrelated'),
    ];
    const kept = filterArgumentRelevant(blocks, EXPAND);
    // Repair extends the range to 260+90=350 — the 600s+ neutral ending stays out.
    expect(kept.map((b) => b.id)).toEqual(['t1', 't2']);
  });

  it('multiple separate argument ranges stay separate and chronological', () => {
    blockCounter = 0;
    const blocks = [
      block(0, 50, 'argument_conflict'),
      block(60, 100, 'unclear'),
      block(1000, 1050, 'unrelated'),
      block(2000, 2060, 'argument_conflict'),
      block(2070, 2100, 'emotional_support'),
    ];
    const ranges = buildArgumentRanges(blocks, EXPAND);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].blockIds).toEqual(['t1', 't2']);
    expect(ranges[1].blockIds).toEqual(['t4', 't5']);
    const kept = filterArgumentRelevant(blocks, EXPAND);
    expect(kept.map((b) => b.id)).toEqual(['t1', 't2', 't4', 't5']);
  });

  it('logistics INSIDE a conflict range is included (every intervening block, regardless of tag)', () => {
    blockCounter = 0;
    const blocks = [
      block(100, 150, 'argument_conflict'),
      block(160, 200, 'logistics_or_normal'),
      block(200, 240, 'unrelated'),
      block(250, 300, 'argument_conflict'),
    ];
    const kept = filterArgumentRelevant(blocks, EXPAND);
    expect(kept.map((b) => b.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('repair after conflict merges into one continuous range', () => {
    blockCounter = 0;
    const blocks = [
      block(100, 200, 'argument_conflict'),
      block(320, 380, 'repair_attempt'), // 120s later — ranges overlap via expansion and merge
    ];
    const ranges = buildArgumentRanges(blocks, EXPAND);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(10);
    expect(ranges[0].end).toBe(470);
  });

  it('no relevant tags: no ranges, empty export', () => {
    blockCounter = 0;
    const blocks = [block(0, 50, 'logistics_or_normal'), block(60, 100, 'unrelated'), block(110, 150, 'unclear')];
    expect(buildArgumentRanges(blocks, EXPAND)).toEqual([]);
    expect(filterArgumentRelevant(blocks, EXPAND)).toEqual([]);
    expect(formatArgumentRelevantTranscript(blocks, EXPAND)).toBe('');
  });

  it('preserves block and segment ids on every range', () => {
    blockCounter = 0;
    const blocks = [block(100, 150, 'argument_conflict'), block(160, 200, 'unclear')];
    const ranges = buildArgumentRanges(blocks, EXPAND);
    expect(ranges[0].blockIds).toEqual(['t1', 't2']);
    expect(ranges[0].segmentIds).toEqual(['s0-1', 's0-2']);
  });

  it('respects a custom expansion width', () => {
    blockCounter = 0;
    const blocks = [
      block(100, 150, 'argument_conflict'),
      block(200, 240, 'logistics_or_normal'), // 50s after the conflict ends
    ];
    expect(filterArgumentRelevant(blocks, { expandSeconds: 30 }).map((b) => b.id)).toEqual(['t1']);
    expect(filterArgumentRelevant(blocks, { expandSeconds: 90 }).map((b) => b.id)).toEqual(['t1', 't2']);
  });
});

describe('formatArgumentRelevantTranscript', () => {
  it('formats kept blocks exactly like the cleaned transcript', () => {
    blockCounter = 0;
    const blocks = [block(0, 50, 'argument_conflict', 'You never listen.')];
    expect(formatArgumentRelevantTranscript(blocks)).toBe('[00:00:00] Kait: You never listen.');
  });
});
