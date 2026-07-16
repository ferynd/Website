import { describe, expect, it } from 'vitest';
import { parseCorrectionPatches } from '../lib/parseCorrectionResponse';

const ALLOWED = ['s0-0', 's0-1', 's0-2'];

describe('parseCorrectionPatches', () => {
  it('parses a valid {patches: [...]} response', () => {
    const raw = JSON.stringify({ patches: [{ id: 's0-0', text: 'hello there' }] });
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-0', text: 'hello there' }],
      invalidCount: 0,
    });
  });

  it('treats an empty patches array as a valid nothing-to-fix response', () => {
    expect(parseCorrectionPatches(JSON.stringify({ patches: [] }), ALLOWED)).toEqual({
      patches: [],
      invalidCount: 0,
    });
  });

  it('accepts a bare array defensively', () => {
    const raw = JSON.stringify([{ id: 's0-1', text: 'fixed' }]);
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-1', text: 'fixed' }],
      invalidCount: 0,
    });
  });

  it('accepts segmentId as an alternative key', () => {
    const raw = JSON.stringify({ patches: [{ segmentId: 's0-1', text: 'fixed' }] });
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-1', text: 'fixed' }],
      invalidCount: 0,
    });
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n{"patches": [{"id": "s0-0", "text": "hi"}]}\n```';
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-0', text: 'hi' }],
      invalidCount: 0,
    });
  });

  it('drops patches whose id does not belong to the request, counting it invalid', () => {
    const raw = JSON.stringify({
      patches: [
        { id: 's0-0', text: 'kept' },
        { id: 's9-99', text: 'unknown id' },
      ],
    });
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-0', text: 'kept' }],
      invalidCount: 1,
    });
  });

  it('keeps only the first occurrence of a duplicated id, counting the repeat invalid', () => {
    const raw = JSON.stringify({
      patches: [
        { id: 's0-0', text: 'first' },
        { id: 's0-0', text: 'second' },
      ],
    });
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({
      patches: [{ segmentId: 's0-0', text: 'first' }],
      invalidCount: 1,
    });
  });

  it('drops malformed entries missing required fields, counting each invalid', () => {
    const raw = JSON.stringify({ patches: [{ id: 's0-0' }, { text: 'no id' }, null, 42] });
    expect(parseCorrectionPatches(raw, ALLOWED)).toEqual({ patches: [], invalidCount: 4 });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCorrectionPatches('not json', ALLOWED)).toThrow('invalid JSON');
  });

  it('throws when the response is neither an array nor {patches}', () => {
    expect(() => parseCorrectionPatches(JSON.stringify({ foo: 'bar' }), ALLOWED)).toThrow('{patches: [...]}');
  });
});
