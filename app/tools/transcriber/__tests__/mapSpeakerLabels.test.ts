import { describe, expect, it } from 'vitest';
import { mapDiarizedSegments, mapFallbackSegments } from '../lib/mapSpeakerLabels';

describe('mapDiarizedSegments', () => {
  it('maps raw speaker labels to provided names in first-appearance order', () => {
    const raw = [
      { start: 0, end: 2, text: 'hi', speaker: 'A' },
      { start: 2, end: 4, text: 'hey', speaker: 'B' },
      { start: 4, end: 6, text: 'again', speaker: 'A' },
    ];
    const mapped = mapDiarizedSegments(raw, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'James', 'Kait']);
  });

  it('labels extra distinct speakers beyond the provided names as Unknown', () => {
    const raw = [
      { start: 0, end: 2, text: 'hi', speaker: 'A' },
      { start: 2, end: 4, text: 'hey', speaker: 'B' },
      { start: 4, end: 6, text: 'who is this', speaker: 'C' },
    ];
    const mapped = mapDiarizedSegments(raw, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['Kait', 'James', 'Unknown']);
  });

  it('preserves start/end/text unchanged', () => {
    const raw = [{ start: 1.5, end: 3.25, text: 'hello', speaker: 'A' }];
    const [mapped] = mapDiarizedSegments(raw, ['Kait']);
    expect(mapped).toMatchObject({ start: 1.5, end: 3.25, text: 'hello' });
  });

  it('keeps an already-resolved known-speaker label instead of remapping it positionally, even when the second profile speaks first', () => {
    const raw = [
      { start: 0, end: 2, text: 'hi', speaker: 'James' },
      { start: 2, end: 4, text: 'hey', speaker: 'Kait' },
    ];
    const mapped = mapDiarizedSegments(raw, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['James', 'Kait']);
  });

  it('mixes exact known-name matches with positionally-mapped anonymous labels, without the positional mapping reusing a claimed name', () => {
    const raw = [
      { start: 0, end: 2, text: 'hi', speaker: 'James' },
      { start: 2, end: 4, text: 'hey', speaker: 'A' },
    ];
    const mapped = mapDiarizedSegments(raw, ['Kait', 'James']);
    expect(mapped.map((s) => s.speaker)).toEqual(['James', 'Kait']);
  });

  it('matches provided speaker names case-insensitively', () => {
    const raw = [{ start: 0, end: 2, text: 'hi', speaker: 'james' }];
    const [mapped] = mapDiarizedSegments(raw, ['Kait', 'James']);
    expect(mapped.speaker).toBe('James');
  });
});

describe('mapFallbackSegments', () => {
  it('labels every segment Unknown', () => {
    const raw = [
      { start: 0, end: 2, text: 'hi' },
      { start: 2, end: 4, text: 'hey' },
    ];
    const mapped = mapFallbackSegments(raw);
    expect(mapped.every((s) => s.speaker === 'Unknown')).toBe(true);
  });
});
