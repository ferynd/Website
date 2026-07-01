import { describe, expect, it } from 'vitest';
import {
  isParseableGeminiTranscriptionResponse,
  normalizeGeminiSpeaker,
  parseGeminiTranscription,
  parseTimestamp,
} from '../lib/gemini/parseGeminiTranscription';

const SPEAKER_NAMES = ['Kait', 'James'];

function windowOptions(overrides: Partial<{ windowStart: number; windowEnd: number; speakerNames: string[] }> = {}) {
  return { windowStart: 0, windowEnd: 600, speakerNames: SPEAKER_NAMES, ...overrides };
}

describe('parseTimestamp', () => {
  it('accepts a raw number as seconds', () => {
    expect(parseTimestamp(125)).toBe(125);
  });

  it('accepts "SS"', () => {
    expect(parseTimestamp('45')).toBe(45);
  });

  it('accepts "SS.mmm"', () => {
    expect(parseTimestamp('45.5')).toBe(45.5);
  });

  it('accepts "MM:SS"', () => {
    expect(parseTimestamp('02:05')).toBe(125);
  });

  it('accepts "H:MM:SS"', () => {
    expect(parseTimestamp('1:02:05')).toBe(3725);
  });

  it('accepts "H:MM:SS.mmm"', () => {
    expect(parseTimestamp('1:02:05.250')).toBe(3725.25);
  });

  it('rejects a negative number', () => {
    expect(parseTimestamp(-5)).toBeNull();
  });

  it('rejects garbage strings', () => {
    expect(parseTimestamp('not-a-time')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });

  it('rejects non-string/number types', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp({})).toBeNull();
  });
});

describe('normalizeGeminiSpeaker', () => {
  it('matches an exact known name case-insensitively', () => {
    expect(normalizeGeminiSpeaker('kait', SPEAKER_NAMES)).toBe('Kait');
    expect(normalizeGeminiSpeaker('JAMES', SPEAKER_NAMES)).toBe('James');
  });

  it('trims whitespace before matching', () => {
    expect(normalizeGeminiSpeaker('  Kait  ', SPEAKER_NAMES)).toBe('Kait');
  });

  it('maps "Speaker 1"/"Speaker 2" positionally (one-indexed)', () => {
    expect(normalizeGeminiSpeaker('Speaker 1', SPEAKER_NAMES)).toBe('Kait');
    expect(normalizeGeminiSpeaker('Speaker 2', SPEAKER_NAMES)).toBe('James');
  });

  it('maps "Speaker A"/"Speaker B" positionally by letter', () => {
    expect(normalizeGeminiSpeaker('Speaker A', SPEAKER_NAMES)).toBe('Kait');
    expect(normalizeGeminiSpeaker('Speaker B', SPEAKER_NAMES)).toBe('James');
  });

  it('maps "S1"/"S2" positionally (one-indexed)', () => {
    expect(normalizeGeminiSpeaker('S1', SPEAKER_NAMES)).toBe('Kait');
    expect(normalizeGeminiSpeaker('S2', SPEAKER_NAMES)).toBe('James');
  });

  it('maps "SPEAKER_00"/"SPEAKER_01" positionally (zero-indexed)', () => {
    expect(normalizeGeminiSpeaker('SPEAKER_00', SPEAKER_NAMES)).toBe('Kait');
    expect(normalizeGeminiSpeaker('SPEAKER_01', SPEAKER_NAMES)).toBe('James');
  });

  it('falls back to Unknown when the positional index overflows speakerNames', () => {
    expect(normalizeGeminiSpeaker('Speaker 3', SPEAKER_NAMES)).toBe('Unknown');
    expect(normalizeGeminiSpeaker('SPEAKER_05', SPEAKER_NAMES)).toBe('Unknown');
  });

  it('falls back to Unknown for an unrecognized label', () => {
    expect(normalizeGeminiSpeaker('Bob', SPEAKER_NAMES)).toBe('Unknown');
  });

  it('falls back to Unknown for empty input', () => {
    expect(normalizeGeminiSpeaker('', SPEAKER_NAMES)).toBe('Unknown');
    expect(normalizeGeminiSpeaker('   ', SPEAKER_NAMES)).toBe('Unknown');
  });
});

describe('parseGeminiTranscription', () => {
  it('parses a well-formed {segments: [...]} response', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '0:00:00', end: '0:00:05', speaker: 'Kait', text: 'Hello there.' },
        { start: '0:00:05', end: '0:00:08', speaker: 'James', text: 'Hi.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result).toEqual([
      { start: 0, end: 5, speaker: 'Kait', text: 'Hello there.' },
      { start: 5, end: 8, speaker: 'James', text: 'Hi.' },
    ]);
  });

  it('accepts a bare array (no {segments} wrapper) defensively', () => {
    const raw = JSON.stringify([{ start: '0:00:00', end: '0:00:02', speaker: 'Kait', text: 'Hi.' }]);
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result).toEqual([{ start: 0, end: 2, speaker: 'Kait', text: 'Hi.' }]);
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify({ segments: [{ start: '0', end: '2', speaker: 'Kait', text: 'Hi.' }] }) + '\n```';
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result).toEqual([{ start: 0, end: 2, speaker: 'Kait', text: 'Hi.' }]);
  });

  it('drops items with unparseable timestamps', () => {
    const raw = JSON.stringify({
      segments: [
        { start: 'garbage', end: '0:00:05', speaker: 'Kait', text: 'Bad start.' },
        { start: '0:00:00', end: '0:00:05', speaker: 'Kait', text: 'Good.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result).toEqual([{ start: 0, end: 5, speaker: 'Kait', text: 'Good.' }]);
  });

  it('drops items with empty text', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '0:00:00', end: '0:00:05', speaker: 'Kait', text: '   ' },
        { start: '0:00:05', end: '0:00:08', speaker: 'James', text: 'Real line.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result).toEqual([{ start: 5, end: 8, speaker: 'James', text: 'Real line.' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseGeminiTranscription('', windowOptions())).toEqual([]);
  });

  it('returns [] for garbage (non-JSON) input', () => {
    expect(parseGeminiTranscription('not json at all', windowOptions())).toEqual([]);
  });

  it('returns [] for valid JSON that is neither an array nor {segments}', () => {
    expect(parseGeminiTranscription(JSON.stringify({ foo: 'bar' }), windowOptions())).toEqual([]);
  });

  it('sorts output by start time', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '0:00:10', end: '0:00:12', speaker: 'James', text: 'Second.' },
        { start: '0:00:00', end: '0:00:02', speaker: 'Kait', text: 'First.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result.map((s) => s.text)).toEqual(['First.', 'Second.']);
  });

  it('does NOT apply the offset heuristic when timestamps are already absolute (windowStart > 0)', () => {
    // Window covers [600, 1200); segments already carry absolute timestamps
    // well past the window span, so the heuristic must not fire.
    const raw = JSON.stringify({
      segments: [
        { start: '0:10:05', end: '0:10:10', speaker: 'Kait', text: 'Absolute already.' },
        { start: '0:10:15', end: '0:10:20', speaker: 'James', text: 'Still absolute.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions({ windowStart: 600, windowEnd: 1200 }));
    expect(result[0].start).toBeCloseTo(605);
    expect(result[1].start).toBeCloseTo(615);
  });

  it('applies the offset heuristic when timestamps look window-relative (small starts, span-bounded ends)', () => {
    // Window covers [600, 1200) (span 600s); segments start near 0 and stay
    // within the window's own span — this is the window-relative shape.
    const raw = JSON.stringify({
      segments: [
        { start: '0:00:05', end: '0:00:10', speaker: 'Kait', text: 'Relative.' },
        { start: '0:00:15', end: '0:00:20', speaker: 'James', text: 'Still relative.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions({ windowStart: 600, windowEnd: 1200 }));
    expect(result[0].start).toBeCloseTo(605);
    expect(result[1].start).toBeCloseTo(615);
  });

  it('never applies the offset heuristic when windowStart is 0 (nothing to offset by)', () => {
    const raw = JSON.stringify({
      segments: [{ start: '0:00:05', end: '0:00:10', speaker: 'Kait', text: 'Already absolute.' }],
    });
    const result = parseGeminiTranscription(raw, windowOptions({ windowStart: 0, windowEnd: 600 }));
    expect(result[0].start).toBe(5);
  });

  it('clamps out segments entirely outside [windowStart - 30, windowEnd + 60]', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '0:00:00', end: '0:00:01', speaker: 'Kait', text: 'Way before window.' }, // ends at 1s, window starts at 600
        { start: '0:10:05', end: '0:10:10', speaker: 'Kait', text: 'Inside window.' },
        { start: '0:25:00', end: '0:25:05', speaker: 'James', text: 'Way after window.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions({ windowStart: 600, windowEnd: 1200 }));
    expect(result.map((s) => s.text)).toEqual(['Inside window.']);
  });

  it('keeps a segment that only partially overlaps the clamp bounds', () => {
    // windowStart=600 => clampMin=570; a segment ending at 575 (start 565) still intersects [570, ...].
    const raw = JSON.stringify({
      segments: [{ start: '0:09:25', end: '0:09:35', speaker: 'Kait', text: 'Straddles clamp boundary.' }],
    });
    const result = parseGeminiTranscription(raw, windowOptions({ windowStart: 600, windowEnd: 1200 }));
    expect(result).toHaveLength(1);
  });

  it('normalizes speaker labels through normalizeGeminiSpeaker (positional + unknown fallback)', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '0', end: '2', speaker: 'Speaker 1', text: 'First speaker.' },
        { start: '3', end: '4', speaker: 'Speaker 2', text: 'Second speaker.' },
        { start: '5', end: '6', speaker: 'Someone else', text: 'Unrecognized label.' },
      ],
    });
    const result = parseGeminiTranscription(raw, windowOptions());
    expect(result.map((s) => s.speaker)).toEqual(['Kait', 'James', 'Unknown']);
  });
});

describe('isParseableGeminiTranscriptionResponse', () => {
  it('is true for a valid {segments: [...]} response, even an empty one', () => {
    expect(isParseableGeminiTranscriptionResponse(JSON.stringify({ segments: [] }))).toBe(true);
    expect(isParseableGeminiTranscriptionResponse(JSON.stringify({ segments: [{ start: 0, end: 1, speaker: 'Kait', text: 'Hi.' }] }))).toBe(true);
  });

  it('is true for a bare array response', () => {
    expect(isParseableGeminiTranscriptionResponse('[]')).toBe(true);
  });

  it('is false for invalid JSON', () => {
    expect(isParseableGeminiTranscriptionResponse('not json')).toBe(false);
    expect(isParseableGeminiTranscriptionResponse('')).toBe(false);
  });

  it('is false for valid JSON that does not match the documented shape', () => {
    expect(isParseableGeminiTranscriptionResponse(JSON.stringify({ foo: 'bar' }))).toBe(false);
  });

  it('tolerates markdown code fences around otherwise-valid JSON', () => {
    expect(isParseableGeminiTranscriptionResponse('```json\n{"segments": []}\n```')).toBe(true);
  });
});
