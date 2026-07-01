import { describe, expect, it } from 'vitest';
import { suppressArtifacts } from '../lib/suppressArtifacts';
import type { TranscriptSegment } from '../lib/types';

function seg(start: number, speaker: string, text: string, durationSec = 1): TranscriptSegment {
  return { start, end: start + durationSec, speaker, text };
}

describe('suppressArtifacts', () => {
  it('removes a "Hold on." cluster with count >= 5, span >= 90s, and regular gaps (conservative)', () => {
    const fillers = [0, 20, 40, 60, 80, 100].map((t) => seg(t, 'Unknown', 'Hold on.'));
    const real = [seg(5, 'Kait', 'I really think we should talk about this later tonight.')];
    const { segments, report } = suppressArtifacts([...fillers, ...real], 'conservative');

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain('talk about this later');
    expect(report.removed).toHaveLength(1);
    expect(report.removed[0]).toEqual({ phrase: 'hold on', count: 6, timeRange: [0, 100] });
    expect(report.boundaryTimes).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('preserves scattered "yeah" replies that meet count and span but have irregular gaps', () => {
    const yeahs = [5, 50, 300, 310, 900].map((t) => seg(t, 'James', 'Yeah.'));
    const { segments, report } = suppressArtifacts(yeahs, 'conservative');

    expect(segments).toHaveLength(5);
    expect(report.removed).toHaveLength(0);
    expect(report.boundaryTimes).toHaveLength(0);
  });

  it('does not remove a regular, high-count cluster whose span is under 90s (span gate)', () => {
    const fillers = [0, 5, 10, 15, 20].map((t) => seg(t, 'Unknown', 'Hold on.'));
    const { segments, report } = suppressArtifacts(fillers, 'conservative');

    expect(segments).toHaveLength(5);
    expect(report.removed).toHaveLength(0);
  });

  it('does not remove a regular, wide-span cluster under the conservative count gate (4 < 5)', () => {
    const fillers = [0, 30, 60, 90].map((t) => seg(t, 'Unknown', 'Hold on.'));
    const { segments: conservativeSegments, report: conservativeReport } = suppressArtifacts(fillers, 'conservative');
    expect(conservativeSegments).toHaveLength(4);
    expect(conservativeReport.removed).toHaveLength(0);
  });

  it('removes the same 4-count wide-span regular cluster under aggressive sensitivity (min repeats 4)', () => {
    const fillers = [0, 30, 60, 90].map((t) => seg(t, 'Unknown', 'Hold on.'));
    const { segments, report } = suppressArtifacts(fillers, 'aggressive');
    expect(segments).toHaveLength(0);
    expect(report.removed).toEqual([{ phrase: 'hold on', count: 4, timeRange: [0, 90] }]);
  });

  it('never removes segments with 4 or more normalized words, no matter how often repeated', () => {
    const repeatedLong = [0, 20, 40, 60, 80, 100].map((t) =>
      seg(t, 'Unknown', 'I really do not know what to say right now.'),
    );
    const { segments, report } = suppressArtifacts(repeatedLong, 'aggressive');
    expect(segments).toHaveLength(6);
    expect(report.removed).toHaveLength(0);
  });

  it('groups by normalized text, ignoring case, punctuation, and extra whitespace', () => {
    const fillers = [0, 20, 40, 60, 80, 100].map((t, i) =>
      seg(t, 'Unknown', i % 2 === 0 ? 'Hold on...' : '  HOLD   on  '),
    );
    const { segments, report } = suppressArtifacts(fillers, 'conservative');
    expect(segments).toHaveLength(0);
    expect(report.removed[0].phrase).toBe('hold on');
  });

  it('returns an empty result for empty input', () => {
    const { segments, report } = suppressArtifacts([], 'conservative');
    expect(segments).toEqual([]);
    expect(report).toEqual({ removed: [], boundaryTimes: [] });
  });

  it('report shape: removed entries have phrase/count/timeRange, boundaryTimes is sorted ascending', () => {
    const fillers = [100, 0, 60, 20, 80, 40].map((t) => seg(t, 'Unknown', 'Hold on.'));
    const { report } = suppressArtifacts(fillers, 'conservative');
    expect(report.removed[0]).toHaveProperty('phrase');
    expect(report.removed[0]).toHaveProperty('count');
    expect(report.removed[0]).toHaveProperty('timeRange');
    expect(report.boundaryTimes).toEqual([...report.boundaryTimes].sort((a, b) => a - b));
    expect(report.boundaryTimes).toEqual([0, 20, 40, 60, 80, 100]);
  });
});
