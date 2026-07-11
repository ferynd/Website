import { describe, expect, it } from 'vitest';
import { attachChunkProvenance } from '../lib/segmentProvenance';
import { mapDiarizedSegments } from '../lib/mapSpeakerLabels';
import { matchOverlapLinks, reconcileSpeakers } from '../lib/reconcileSpeakers';
import type { TranscriptSegment } from '../lib/types';

const NAMES = ['Kait', 'James'];

/** Builds one chunk's mapped + provenance-attached segments from (label, start, end, text) tuples. */
function chunk(chunkIndex: number, rows: [string, number, number, string][]): TranscriptSegment[] {
  const mapped = mapDiarizedSegments(
    rows.map(([speaker, start, end, text]) => ({ speaker, start, end, text })),
    NAMES,
  );
  return attachChunkProvenance(mapped, chunkIndex);
}

describe('reconcileSpeakers', () => {
  it('keeps exact-name assignments and gives anonymous extras stable global labels', () => {
    const segments = chunk(0, [
      ['Kait', 0, 2, 'Hello.'],
      ['A', 2, 4, 'Mystery line one.'],
      ['James', 4, 6, 'Hi there.'],
      ['A', 6, 8, 'Mystery line two.'],
      ['B', 8, 10, 'Different mystery.'],
    ]);
    const { segments: out, report } = reconcileSpeakers(segments, { knownNames: NAMES });

    expect(out.map((s) => s.speaker)).toEqual(['Kait', 'Speaker A', 'James', 'Speaker A', 'Speaker B']);
    expect(out[0].resolvedSpeaker).toBe('Kait');
    expect(out[2].resolvedSpeaker).toBe('James');
    expect(out[1].resolvedSpeaker).toBeUndefined();
    expect(out[4].resolvedSpeaker).toBeUndefined();
    expect(report.resolvedClusters).toBe(2);
    expect(report.unresolvedClusters).toBe(2);
    expect(report.conflictClusters).toBe(0);
  });

  it('never forces unresolved identities onto the two supplied names', () => {
    const segments = chunk(0, [
      ['Kait', 0, 2, 'Hello.'],
      ['James', 2, 4, 'Hi.'],
      ['C', 4, 6, 'Third voice.'],
      ['D', 6, 8, 'Fourth voice.'],
    ]);
    const { segments: out } = reconcileSpeakers(segments, { knownNames: NAMES });
    expect(out[2].speaker).not.toBe('Kait');
    expect(out[2].speaker).not.toBe('James');
    expect(out[3].speaker).not.toBe('Kait');
    expect(out[3].speaker).not.toBe('James');
    // ...and the two stay distinct from each other.
    expect(out[2].speaker).not.toBe(out[3].speaker);
  });

  it('keeps chunk-0 positional assignments assigned', () => {
    const segments = chunk(0, [
      ['A', 0, 2, 'First voice.'],
      ['B', 2, 4, 'Second voice.'],
    ]);
    const { segments: out } = reconcileSpeakers(segments, { knownNames: NAMES });
    expect(out.map((s) => s.speaker)).toEqual(['Kait', 'James']);
    expect(out[0].resolvedSpeaker).toBe('Kait');
  });

  it('demotes positional assignments in later chunks to unresolved-with-candidate', () => {
    const segments = [
      ...chunk(0, [
        ['Kait', 0, 2, 'Anchored line.'],
        ['James', 2, 4, 'Also anchored.'],
      ]),
      // Chunk 1 has only anonymous labels — its first-appearance order is a
      // guess that historically swapped speakers at the boundary.
      ...chunk(1, [
        ['A', 100, 102, 'Who is speaking now?'],
        ['B', 102, 104, 'And now?'],
      ]),
    ];
    const { segments: out, report } = reconcileSpeakers(segments, { knownNames: NAMES });
    expect(out[2].resolvedSpeaker).toBeUndefined();
    expect(out[2].candidateSpeaker).toBe('Kait');
    expect(out[2].speaker).toMatch(/^Speaker /);
    expect(report.demotedPositionalIdentities).toBe(2);
    expect(report.candidateClusters).toBe(2);
  });

  it('resolves a later chunk via an overlap link to an anchored identity', () => {
    const chunk0 = chunk(0, [
      ['Kait', 0, 2, 'Anchored line.'],
      ['A', 598, 600, 'This sentence spans the chunk boundary overlap.'],
    ]);
    const chunk1 = chunk(1, [
      ['B', 598.4, 600.2, 'This sentence spans the chunk boundary overlap.'],
      ['B', 601, 603, 'Continuing after the boundary.'],
    ]);
    // Chunk 0's 'A' resolved positionally to James (Kait claimed exactly).
    const overlapLinks = matchOverlapLinks([chunk0[1]], [chunk1[0]]);
    expect(overlapLinks).toHaveLength(1);

    const { segments: out, report } = reconcileSpeakers([...chunk0, ...chunk1], {
      knownNames: NAMES,
      overlapLinks,
    });
    // The union makes chunk 1's 'B' the same cluster as chunk 0's 'A' —
    // which carries a full-strength chunk-0 positional assignment to James.
    expect(out[2].speaker).toBe('James');
    expect(out[3].speaker).toBe('James');
    expect(report.overlapLinksUsed).toBe(1);
  });

  it('records directly conflicting evidence and leaves the cluster unresolved', () => {
    const chunk0 = chunk(0, [
      ['Kait', 0, 2, 'I am definitely Kait in this overlapping sentence.'],
    ]);
    const chunk1 = chunk(1, [
      ['James', 0.5, 2.2, 'I am definitely Kait in this overlapping sentence.'],
    ]);
    // The same speech carries an exact 'Kait' label in one chunk and an
    // exact 'James' label in the other — irreconcilable.
    const overlapLinks = matchOverlapLinks(chunk0, chunk1);
    expect(overlapLinks).toHaveLength(1);
    const { segments: out, report } = reconcileSpeakers([...chunk0, ...chunk1], {
      knownNames: NAMES,
      overlapLinks,
    });
    expect(report.conflictClusters).toBe(1);
    expect(out[0].mappingConflict).toBe(true);
    expect(out[0].resolvedSpeaker).toBeUndefined();
    expect(out[0].speaker).toMatch(/^Speaker /);
    // The strongest candidate is still retained for the repair stage.
    expect(out[0].candidateSpeaker).toBeDefined();
  });

  it('adjacent-chunk continuity contributes candidate evidence but never auto-assigns', () => {
    const segments = [
      ...chunk(0, [['Kait', 0, 600, 'Speaking right up to the boundary.']]),
      ...chunk(1, [['A', 600.5, 610, 'Continuing immediately after the boundary.']]),
    ];
    const { segments: out, report } = reconcileSpeakers(segments, { knownNames: NAMES });
    const boundarySeg = out[1];
    // Kait via continuity is candidate-band evidence, but chunk 1's 'A' also
    // got a (demoted) positional claim to Kait — either way, this must stay
    // a candidate, not an automatic assignment.
    expect(boundarySeg.resolvedSpeaker).toBeUndefined();
    expect(boundarySeg.candidateSpeaker).toBe('Kait');
    expect(report.resolvedClusters).toBe(1); // only the exact-name chunk-0 cluster
  });

  it('never modifies user-confirmed segments', () => {
    const base = chunk(0, [
      ['A', 0, 2, 'Confirmed by hand.'],
      ['A', 2, 4, 'Same identity, not confirmed.'],
    ]);
    const confirmed: TranscriptSegment = { ...base[0], speaker: 'James', userConfirmed: true };
    const { segments: out } = reconcileSpeakers([confirmed, base[1]], { knownNames: NAMES });
    expect(out[0].speaker).toBe('James');
    expect(out[0].userConfirmed).toBe(true);
    // The confirmation is full-strength evidence for the whole identity.
    expect(out[1].speaker).toBe('James');
  });

  it('passes Whisper segments (no local identity) through unchanged', () => {
    const whisper: TranscriptSegment[] = [
      { start: 0, end: 2, speaker: 'Unknown', text: 'No diarization at all.', mappingSource: 'unresolved' },
    ];
    const { segments: out, report } = reconcileSpeakers(whisper, { knownNames: NAMES });
    expect(out[0]).toBe(whisper[0]);
    expect(report.identityCount).toBe(0);
  });

  it('is deterministic: identical input yields identical output', () => {
    const segments = [
      ...chunk(0, [
        ['Kait', 0, 2, 'Hello.'],
        ['A', 2, 4, 'Mystery.'],
      ]),
      ...chunk(1, [
        ['B', 100, 102, 'Later mystery.'],
        ['James', 102, 104, 'Hi.'],
      ]),
    ];
    const a = reconcileSpeakers(segments, { knownNames: NAMES });
    const b = reconcileSpeakers(segments, { knownNames: NAMES });
    expect(a.segments).toEqual(b.segments);
    expect(a.report).toEqual(b.report);
  });
});

describe('matchOverlapLinks', () => {
  it('links identities that transcribed the same overlap speech', () => {
    const owned = chunk(0, [['A', 100, 103, 'This exact sentence appears in both chunks.']]);
    const dupes = chunk(1, [['B', 100.8, 103.5, 'This exact sentence appears in both chunks.']]);
    const links = matchOverlapLinks(owned, dupes);
    expect(links).toEqual([{ localSpeakerIdA: dupes[0].localSpeakerId, localSpeakerIdB: owned[0].localSpeakerId }]);
  });

  it('does not link when start times are too far apart', () => {
    const owned = chunk(0, [['A', 100, 103, 'This exact sentence appears in both chunks.']]);
    const dupes = chunk(1, [['B', 106, 109, 'This exact sentence appears in both chunks.']]);
    expect(matchOverlapLinks(owned, dupes)).toEqual([]);
  });

  it('does not link very short generic lines', () => {
    const owned = chunk(0, [['A', 100, 101, 'Yeah.']]);
    const dupes = chunk(1, [['B', 100.2, 101.1, 'Yeah.']]);
    expect(matchOverlapLinks(owned, dupes)).toEqual([]);
  });

  it('matches on a long shared prefix despite trailing transcription differences', () => {
    const owned = chunk(0, [['A', 100, 104, 'We really need to talk about what happened yesterday evening']]);
    const dupes = chunk(1, [['B', 100.5, 104.2, 'We really need to talk about what happened yesterday, I think']]);
    expect(matchOverlapLinks(owned, dupes)).toHaveLength(1);
  });
});
