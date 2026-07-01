import { describe, expect, it } from 'vitest';
import { findMissingIndices, parseCorrectionResponse } from '../lib/parseCorrectionResponse';

describe('parseCorrectionResponse', () => {
  it('parses a valid JSON array of corrections', () => {
    const raw = JSON.stringify([
      { index: 0, speaker: 'Kait', text: 'hello there' },
      { index: 1, speaker: 'James', text: 'hi!' },
    ]);
    const result = parseCorrectionResponse(raw, [0, 1]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ index: 0, speaker: 'Kait', text: 'hello there' });
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n[{"index": 0, "speaker": "Kait", "text": "hi"}]\n```';
    const result = parseCorrectionResponse(raw, [0]);
    expect(result).toEqual([{ index: 0, speaker: 'Kait', text: 'hi' }]);
  });

  it('drops entries with an index outside the expected set', () => {
    const raw = JSON.stringify([
      { index: 0, speaker: 'Kait', text: 'hi' },
      { index: 99, speaker: 'James', text: 'unexpected' },
    ]);
    const result = parseCorrectionResponse(raw, [0]);
    expect(result).toEqual([{ index: 0, speaker: 'Kait', text: 'hi' }]);
  });

  it('drops malformed entries missing required fields', () => {
    const raw = JSON.stringify([{ index: 0, speaker: 'Kait' }, { index: 1, text: 'no speaker' }]);
    const result = parseCorrectionResponse(raw, [0, 1]);
    expect(result).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCorrectionResponse('not json', [0])).toThrow();
  });

  it('throws when the response is not an array', () => {
    expect(() => parseCorrectionResponse('{"index": 0}', [0])).toThrow();
  });
});

describe('findMissingIndices', () => {
  it('returns an empty array when every expected index is covered', () => {
    const corrections = [
      { index: 0, speaker: 'Kait', text: 'hi' },
      { index: 1, speaker: 'James', text: 'hey' },
    ];
    expect(findMissingIndices([0, 1], corrections)).toEqual([]);
  });

  it('reports indices with no corresponding correction', () => {
    const corrections = [{ index: 0, speaker: 'Kait', text: 'hi' }];
    expect(findMissingIndices([0, 1, 2], corrections)).toEqual([1, 2]);
  });

  it('reports every expected index when corrections is empty', () => {
    expect(findMissingIndices([0, 1], [])).toEqual([0, 1]);
  });
});
