import { describe, expect, it } from 'vitest';
import { createChunkWindows } from '../lib/chunkTranscript';
import { stitchChunkResults, type ChunkResult } from '../lib/stitchTranscript';
import type { TranscriptSegment } from '../lib/types';

describe('stitchChunkResults', () => {
  it('keeps only each window\'s core-range segments, dropping overlap duplicates', () => {
    const windows = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });

    // Window 0 covers [0, 990) and includes a segment from the overlap region
    // that "belongs" to window 1's core. Window 1 covers [810, 1890) and
    // includes the same segment plus its own core segment.
    const shared: TranscriptSegment = { start: 895, end: 905, speaker: 'James', text: 'shared line' };
    const chunk0Only: TranscriptSegment = { start: 10, end: 12, speaker: 'Kait', text: 'chunk 0 only' };
    const chunk1Only: TranscriptSegment = { start: 1200, end: 1202, speaker: 'James', text: 'chunk 1 only' };

    const results: ChunkResult[] = [
      { window: windows[0], segments: [chunk0Only, shared] },
      { window: windows[1], segments: [shared, chunk1Only] },
      { window: windows[2], segments: [] },
    ];

    const stitched = stitchChunkResults(results);

    // The shared segment (start=895) is >= window[1].coreStart (900)? No —
    // 895 < 900, so it belongs to window 0's core, not window 1's.
    expect(stitched).toEqual([chunk0Only, shared, chunk1Only]);
  });

  it('de-dupes exact repeats as a safety net even within the same core range', () => {
    const windows = createChunkWindows(300, { chunkSeconds: 900, overlapSeconds: 90 });
    const seg: TranscriptSegment = { start: 5, end: 6, speaker: 'Kait', text: 'hi' };

    const stitched = stitchChunkResults([{ window: windows[0], segments: [seg, seg] }]);
    expect(stitched).toHaveLength(1);
  });

  it('sorts the final output by start time', () => {
    const windows = createChunkWindows(300, { chunkSeconds: 900, overlapSeconds: 90 });
    const a: TranscriptSegment = { start: 10, end: 11, speaker: 'Kait', text: 'a' };
    const b: TranscriptSegment = { start: 2, end: 3, speaker: 'James', text: 'b' };

    const stitched = stitchChunkResults([{ window: windows[0], segments: [a, b] }]);
    expect(stitched.map((s) => s.text)).toEqual(['b', 'a']);
  });

  it('includes trailing segments in the last window without an upper bound', () => {
    const windows = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });
    const lastWindow = windows[windows.length - 1];
    const trailing: TranscriptSegment = { start: 1999, end: 2000, speaker: 'Kait', text: 'last word' };

    const stitched = stitchChunkResults([{ window: lastWindow, segments: [trailing] }]);
    expect(stitched).toEqual([trailing]);
  });
});
