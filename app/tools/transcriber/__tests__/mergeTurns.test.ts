import { describe, expect, it } from 'vitest';
import { mergeTurns } from '../lib/mergeTurns';
import type { ArgumentTag, TaggedTranscriptSegment } from '../lib/types';

function seg(start: number, end: number, speaker: string, text: string, tag?: ArgumentTag): TaggedTranscriptSegment {
  return { start, end, speaker, text, tag };
}

describe('mergeTurns', () => {
  it('returns an empty array for empty input', () => {
    expect(mergeTurns([], { maxGapSeconds: 2.5 })).toEqual([]);
  });

  it('returns a single block for a single segment', () => {
    const result = mergeTurns([seg(0, 2, 'Kait', 'Hello there.')], { maxGapSeconds: 2.5 });
    expect(result).toEqual([{ start: 0, end: 2, speaker: 'Kait', text: 'Hello there.', segmentCount: 1 }]);
  });

  it('merges consecutive same-speaker segments under the gap threshold', () => {
    const segments = [seg(0, 2, 'Kait', 'Hello there.'), seg(3, 5, 'Kait', 'How are you?')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toEqual([{ start: 0, end: 5, speaker: 'Kait', text: 'Hello there. How are you?', segmentCount: 2 }]);
  });

  it('gap threshold boundary: does not merge when the gap equals maxGapSeconds (strict <)', () => {
    const segments = [seg(0, 2, 'Kait', 'Hello there.'), seg(4.5, 6, 'Kait', 'How are you?')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toHaveLength(2);
  });

  it('gap threshold boundary: merges when the gap is just under maxGapSeconds', () => {
    const segments = [seg(0, 2, 'Kait', 'Hello there.'), seg(4.49, 6, 'Kait', 'How are you?')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toHaveLength(1);
  });

  it('splits on a speaker change even when the gap is tiny', () => {
    const segments = [seg(0, 2, 'Kait', 'Hello there.'), seg(2.1, 4, 'James', 'Hi.')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Kait');
    expect(result[1].speaker).toBe('James');
  });

  it('splits when a suppression boundary time falls strictly between two same-speaker segments', () => {
    const segments = [seg(0, 2, 'Kait', 'Hold on.'), seg(3, 5, 'Kait', 'Okay, continuing.')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5, boundaryTimes: [2.5] });
    expect(result).toHaveLength(2);
  });

  it('does not split when the boundary time is outside (prevEnd, nextStart), even if present elsewhere', () => {
    const segments = [seg(0, 2, 'Kait', 'Hello there.'), seg(3, 5, 'Kait', 'How are you?')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5, boundaryTimes: [0, 5] });
    expect(result).toHaveLength(1);
  });

  it('tracks segmentCount across a longer merged run', () => {
    const segments = [
      seg(0, 1, 'Kait', 'One.'),
      seg(1.2, 2, 'Kait', 'Two.'),
      seg(2.3, 3, 'Kait', 'Three.'),
    ];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toEqual([{ start: 0, end: 3, speaker: 'Kait', text: 'One. Two. Three.', segmentCount: 3 }]);
  });

  it('sorts out-of-order input by start time before merging', () => {
    const segments = [seg(3, 5, 'Kait', 'Second.'), seg(0, 2, 'Kait', 'First.')];
    const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
    expect(result).toEqual([{ start: 0, end: 5, speaker: 'Kait', text: 'First. Second.', segmentCount: 2 }]);
  });

  describe('argument tagging (majority tag)', () => {
    it('carries a single segment tag through to the merged block', () => {
      const segments = [seg(0, 2, 'Kait', 'Hello.', 'argument_conflict')];
      const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
      expect(result[0].tag).toBe('argument_conflict');
    });

    it('carries the majority tag among merged segments', () => {
      const segments = [
        seg(0, 1, 'Kait', 'One.', 'argument_conflict'),
        seg(1.2, 2, 'Kait', 'Two.', 'argument_conflict'),
        seg(2.3, 3, 'Kait', 'Three.', 'repair_attempt'),
      ];
      const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe('argument_conflict');
    });

    it('breaks a tie by the first tag encountered', () => {
      const segments = [
        seg(0, 1, 'Kait', 'One.', 'repair_attempt'),
        seg(1.2, 2, 'Kait', 'Two.', 'argument_conflict'),
      ];
      const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe('repair_attempt');
    });

    it('omits tag entirely when no constituent segment carried one', () => {
      const segments = [seg(0, 2, 'Kait', 'Hello there.')];
      const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
      expect(result[0]).not.toHaveProperty('tag');
    });

    it('tag differences never block merging — same speaker/gap still merges', () => {
      const segments = [
        seg(0, 2, 'Kait', 'Hello there.', 'argument_conflict'),
        seg(3, 5, 'Kait', 'How are you?', 'logistics_or_normal'),
      ];
      const result = mergeTurns(segments, { maxGapSeconds: 2.5 });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello there. How are you?');
    });
  });
});
