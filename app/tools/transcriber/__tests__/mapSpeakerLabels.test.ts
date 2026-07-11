import { describe, expect, it } from 'vitest';
import {
  EXACT_NAME_CONFIDENCE,
  EXACT_NAME_CONFIDENCE_WITH_CLIPS,
  POSITIONAL_CONFIDENCE,
} from '../lib/constants';
import { mapDiarizedSegments, mapFallbackSegments } from '../lib/mapSpeakerLabels';

function raw(speaker: string, start = 0, end = 1, text = 'hi') {
  return { start, end, text, speaker };
}

describe('mapDiarizedSegments', () => {
  it('maps raw speaker labels to provided names in first-appearance order', () => {
    const rawSegs = [
      { start: 0, end: 2, text: 'hi', speaker: 'A' },
      { start: 2, end: 4, text: 'hey', speaker: 'B' },
      { start: 4, end: 6, text: 'again', speaker: 'A' },
    ];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'James', 'Kait']);
    expect(mapped.map((s) => s.mappingSource)).toEqual(['positional', 'positional', 'positional']);
    expect(mapped.every((s) => s.speakerConfidence === POSITIONAL_CONFIDENCE)).toBe(true);
  });

  it('keeps extra distinct speakers beyond the provided names as stable unresolved identities, not Unknown', () => {
    const rawSegs = [
      { start: 0, end: 2, text: 'hi', speaker: 'A' },
      { start: 2, end: 4, text: 'hey', speaker: 'B' },
      { start: 4, end: 6, text: 'who is this', speaker: 'C' },
    ];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'James', 'Speaker C']);
    expect(mapped[2].resolvedSpeaker).toBeUndefined();
    expect(mapped[2].mappingSource).toBe('unresolved');
    expect(mapped[2].localSpeakerId).toBe('label:c');
  });

  it('preserves start/end/text unchanged', () => {
    const rawSegs = [{ start: 1.5, end: 3.25, text: 'hello', speaker: 'A' }];
    const [mapped] = mapDiarizedSegments(rawSegs, ['Kait']);
    expect(mapped).toMatchObject({ start: 1.5, end: 3.25, text: 'hello' });
  });

  it('keeps an already-resolved known-speaker label instead of remapping it positionally, even when the second profile speaks first', () => {
    const rawSegs = [
      { start: 0, end: 2, text: 'hi', speaker: 'James' },
      { start: 2, end: 4, text: 'hey', speaker: 'Kait' },
    ];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['James', 'Kait']);
    expect(mapped.map((s) => s.mappingSource)).toEqual(['provider-exact', 'provider-exact']);
  });

  it('mixes exact known-name matches with positionally-mapped anonymous labels, without the positional mapping reusing a claimed name', () => {
    const rawSegs = [
      { start: 0, end: 2, text: 'hi', speaker: 'James' },
      { start: 2, end: 4, text: 'hey', speaker: 'A' },
    ];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['James', 'Kait']);
  });

  it('matches provided speaker names case-insensitively', () => {
    const rawSegs = [{ start: 0, end: 2, text: 'hi', speaker: 'james' }];
    const [mapped] = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.speaker).toBe('James');
    expect(mapped.providerLabel).toBe('james');
  });

  it('REGRESSION: exact names plus anonymous labels never collapse the anonymous labels to Unknown', () => {
    // Kait, A, A, James, A, B — the confirmed defect: both names are claimed
    // by exact matches, so the old mapper handed 'A' and 'B' one generic
    // 'Unknown', destroying the stable local identity the provider supplied.
    const rawSegs = [raw('Kait', 0, 1), raw('A', 1, 2), raw('A', 2, 3), raw('James', 3, 4), raw('A', 4, 5), raw('B', 5, 6)];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);

    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'Speaker A', 'Speaker A', 'James', 'Speaker A', 'Speaker B']);
    // Every 'A' shares one stable local identity, distinct from 'B'.
    expect(mapped[1].localSpeakerId).toBe('label:a');
    expect(mapped[2].localSpeakerId).toBe('label:a');
    expect(mapped[4].localSpeakerId).toBe('label:a');
    expect(mapped[5].localSpeakerId).toBe('label:b');
    // The anonymous labels are unresolved — never forced onto Kait or James.
    expect(mapped[1].resolvedSpeaker).toBeUndefined();
    expect(mapped[5].resolvedSpeaker).toBeUndefined();
    // The exact names are preserved untouched.
    expect(mapped[0]).toMatchObject({ resolvedSpeaker: 'Kait', mappingSource: 'provider-exact' });
    expect(mapped[3]).toMatchObject({ resolvedSpeaker: 'James', mappingSource: 'provider-exact' });
  });

  it('permits several provider labels to resolve to the same known speaker via exact matches', () => {
    const rawSegs = [raw('Kait', 0, 1), raw('kait', 1, 2), raw('KAIT', 2, 3)];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.every((s) => s.speaker === 'Kait')).toBe(true);
    expect(mapped.every((s) => s.localSpeakerId === 'name:kait')).toBe(true);
  });

  it('permits more local identities than supplied names', () => {
    const rawSegs = [raw('A', 0, 1), raw('B', 1, 2), raw('C', 2, 3), raw('D', 3, 4)];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait']);
    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'Speaker B', 'Speaker C', 'Speaker D']);
    expect(new Set(mapped.map((s) => s.localSpeakerId)).size).toBe(4);
  });

  it('gives malformed/missing labels a stable unresolved local identity', () => {
    const rawSegs = [raw('', 0, 1), raw('', 1, 2), raw('???--weird', 2, 3)];
    const mapped = mapDiarizedSegments(rawSegs, []);
    expect(mapped[0].localSpeakerId).toBe('label:blank');
    expect(mapped[1].localSpeakerId).toBe('label:blank');
    expect(mapped[0].speaker).toBe(mapped[1].speaker);
    expect(mapped[2].localSpeakerId).toBe('label:???--weird');
    expect(mapped[2].speaker).not.toBe(mapped[0].speaker);
    expect(mapped.every((s) => s.mappingSource === 'unresolved')).toBe(true);
  });

  it('records higher exact-name confidence when reference clips were attached', () => {
    const rawSegs = [raw('Kait', 0, 1)];
    const withoutClips = mapDiarizedSegments(rawSegs, ['Kait'])[0];
    const withClips = mapDiarizedSegments(rawSegs, ['Kait'], { clipsAttached: true })[0];
    expect(withoutClips.speakerConfidence).toBe(EXACT_NAME_CONFIDENCE);
    expect(withClips.speakerConfidence).toBe(EXACT_NAME_CONFIDENCE_WITH_CLIPS);
  });

  it('preserves the original provider label on every segment', () => {
    const rawSegs = [raw('Kait', 0, 1), raw('A', 1, 2)];
    const mapped = mapDiarizedSegments(rawSegs, ['Kait', 'James']);
    expect(mapped.map((s) => s.providerLabel)).toEqual(['Kait', 'A']);
  });
});

describe('mapFallbackSegments', () => {
  it('labels every segment Unknown with no local identity (whisper has no speaker concept)', () => {
    const rawSegs = [
      { start: 0, end: 2, text: 'hi' },
      { start: 2, end: 4, text: 'hey' },
    ];
    const mapped = mapFallbackSegments(rawSegs);
    expect(mapped.every((s) => s.speaker === 'Unknown')).toBe(true);
    expect(mapped.every((s) => s.localSpeakerId === undefined)).toBe(true);
    expect(mapped.every((s) => s.mappingSource === 'unresolved')).toBe(true);
  });
});
