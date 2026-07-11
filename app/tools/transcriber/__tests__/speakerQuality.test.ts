import { describe, expect, it } from 'vitest';
import { analyzeSpeakerQuality, buildQualityWarning } from '../lib/speakerQuality';
import type { TranscriptSegment } from '../lib/types';

const NAMES = ['Kait', 'James'];

function resolved(start: number, end: number, name: string, words: number, chunkIndex = 0): TranscriptSegment {
  return {
    start,
    end,
    speaker: name,
    text: Array(words).fill('word').join(' '),
    id: `s${chunkIndex}-${Math.round(start)}`,
    chunkIndex,
    providerLabel: name,
    localSpeakerId: `name:${name.toLowerCase()}`,
    resolvedSpeaker: name,
    speakerConfidence: 0.95,
    mappingSource: 'provider-exact',
  };
}

function unresolved(start: number, end: number, words: number, chunkIndex = 0, label = 'A'): TranscriptSegment {
  return {
    start,
    end,
    speaker: `Speaker ${label}`,
    text: Array(words).fill('word').join(' '),
    id: `s${chunkIndex}-${Math.round(start)}`,
    chunkIndex,
    providerLabel: label,
    localSpeakerId: `c${chunkIndex}:label:${label.toLowerCase()}`,
    speakerConfidence: 0,
    mappingSource: 'unresolved',
  };
}

describe('analyzeSpeakerQuality', () => {
  it('reports zero unresolved for a fully resolved transcript and does not trigger repair', () => {
    const report = analyzeSpeakerQuality(
      [resolved(0, 10, 'Kait', 50), resolved(10, 20, 'James', 50)],
      { knownNames: NAMES },
    );
    expect(report.totalWords).toBe(100);
    expect(report.namedWords).toBe(100);
    expect(report.unresolvedWords).toBe(0);
    expect(report.unresolvedPercent).toBe(0);
    expect(report.needsRepair).toBe(false);
    expect(report.resolvedSpeakers).toEqual(['James', 'Kait']);
    expect(buildQualityWarning(report)).toBeNull();
  });

  it('triggers on overall unresolved percentage above 2%', () => {
    // 97 resolved words + 3 unresolved words = 3% unresolved.
    const report = analyzeSpeakerQuality(
      [resolved(0, 10, 'Kait', 97), unresolved(10, 12, 3)],
      { knownNames: NAMES },
    );
    expect(report.unresolvedPercent).toBeCloseTo(3, 5);
    expect(report.triggers.overallUnresolved).toBe(true);
    expect(report.needsRepair).toBe(true);
  });

  it('does not trigger at exactly the 2% boundary (strictly greater)', () => {
    const report = analyzeSpeakerQuality(
      [resolved(0, 10, 'Kait', 98), unresolved(10, 12, 2)],
      { knownNames: NAMES },
    );
    expect(report.unresolvedPercent).toBeCloseTo(2, 5);
    expect(report.triggers.overallUnresolved).toBe(false);
  });

  it('triggers on a single bad five-minute window even when the overall rate is low', () => {
    // 1900 resolved words spread over ~40 min, plus one window with 15% unresolved.
    const segments: TranscriptSegment[] = [];
    for (let w = 0; w < 8; w++) {
      segments.push(resolved(w * 300, w * 300 + 200, 'Kait', 240));
    }
    // Window 8: 85 resolved + 15 unresolved words -> 15% window, ~0.7% overall.
    segments.push(resolved(2400, 2500, 'James', 85));
    segments.push(unresolved(2510, 2515, 15));
    const report = analyzeSpeakerQuality(segments, { knownNames: NAMES });
    expect(report.triggers.overallUnresolved).toBe(false);
    expect(report.maxWindowUnresolvedPercent).toBeCloseTo(15, 5);
    expect(report.triggers.windowUnresolved).toBe(true);
    expect(report.needsRepair).toBe(true);
  });

  it('triggers on an unresolved run longer than 30 seconds', () => {
    const report = analyzeSpeakerQuality(
      [
        resolved(0, 1000, 'Kait', 5000),
        unresolved(1000, 1020, 3),
        unresolved(1020, 1040, 3),
      ],
      { knownNames: NAMES },
    );
    expect(report.longestUnresolvedRunSeconds).toBeCloseTo(40, 5);
    expect(report.longestUnresolvedRunWords).toBe(6);
    expect(report.triggers.longUnresolvedRun).toBe(true);
    expect(report.needsRepair).toBe(true);
  });

  it('triggers on any direct mapping conflict', () => {
    const conflicted = { ...unresolved(0, 5, 10), mappingConflict: true };
    const report = analyzeSpeakerQuality([resolved(5, 500, 'Kait', 5000), conflicted], { knownNames: NAMES });
    expect(report.mappingConflicts).toBe(1);
    expect(report.triggers.mappingConflict).toBe(true);
    expect(report.needsRepair).toBe(true);
  });

  it('reports mixed named/anonymous chunks and chunks without known names', () => {
    const segments = [
      resolved(0, 10, 'Kait', 20, 0),
      unresolved(10, 20, 20, 0),
      unresolved(600, 610, 20, 1),
    ];
    const report = analyzeSpeakerQuality(segments, { knownNames: NAMES });
    expect(report.mixedLabelChunks).toEqual([0]);
    expect(report.chunksWithoutKnownNames).toEqual([1]);
  });

  it('counts chunk-boundary identity changes', () => {
    const segments = [
      resolved(0, 10, 'Kait', 20, 0),
      unresolved(10.5, 20, 20, 1), // boundary 0->1, identity changes
      unresolved(20.5, 30, 20, 1),
    ];
    const report = analyzeSpeakerQuality(segments, { knownNames: NAMES });
    expect(report.chunkBoundaryIdentityChanges).toBe(1);
  });

  it('counts Whisper segments (no local identity) and confidence bands', () => {
    const whisper: TranscriptSegment = { start: 0, end: 5, speaker: 'Unknown', text: 'no identity here', speakerConfidence: 0 };
    const report = analyzeSpeakerQuality([whisper, resolved(5, 10, 'Kait', 10)], { knownNames: NAMES });
    expect(report.whisperFallbackSegments).toBe(1);
    expect(report.confidenceDistribution.high).toBe(1);
    expect(report.confidenceDistribution.low).toBe(1);
  });

  it('handles an empty transcript', () => {
    const report = analyzeSpeakerQuality([], { knownNames: NAMES });
    expect(report.totalWords).toBe(0);
    expect(report.unresolvedPercent).toBe(0);
    expect(report.needsRepair).toBe(false);
  });

  it('carries repairsApplied through and the warning never contains transcript text', () => {
    const report = analyzeSpeakerQuality(
      [resolved(0, 10, 'Kait', 10), unresolved(10, 60, 40)],
      { knownNames: NAMES, repairsApplied: 7 },
    );
    expect(report.repairsApplied).toBe(7);
    const warning = buildQualityWarning(report);
    expect(warning).toBeTruthy();
    expect(warning).not.toContain('word word');
  });
});
