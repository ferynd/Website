import { describe, expect, it } from 'vitest';
import {
  applySpeakerRepairPatches,
  buildRepairBatches,
  buildSpeakerRepairPrompt,
  buildSpeakerRepairResponseSchema,
  parseSpeakerRepairPatches,
} from '../lib/speakerRepair';
import type { TranscriptSegment } from '../lib/types';

const NAMES = ['Kait', 'James'];

function resolved(id: string, start: number, name: string): TranscriptSegment {
  return {
    id,
    start,
    end: start + 2,
    speaker: name,
    text: `resolved line at ${start}`,
    resolvedSpeaker: name,
    speakerConfidence: 0.95,
    mappingSource: 'provider-exact',
    localSpeakerId: `name:${name.toLowerCase()}`,
  };
}

function unresolved(id: string, start: number, candidate?: string): TranscriptSegment {
  return {
    id,
    start,
    end: start + 2,
    speaker: 'Speaker A',
    text: `unresolved line at ${start}`,
    localSpeakerId: 'c1:label:a',
    speakerConfidence: candidate ? 0.75 : 0,
    mappingSource: 'unresolved',
    ...(candidate ? { candidateSpeaker: candidate } : {}),
  };
}

describe('buildRepairBatches', () => {
  it('sends only unresolved targets plus limited resolved context', () => {
    const segments = [
      resolved('s0-0', 0, 'Kait'),
      resolved('s0-1', 2, 'James'),
      resolved('s0-2', 4, 'Kait'),
      resolved('s0-3', 6, 'James'),
      unresolved('s1-0', 8, 'Kait'),
      unresolved('s1-1', 10),
      resolved('s1-2', 12, 'James'),
      resolved('s1-3', 14, 'Kait'),
      resolved('s1-4', 16, 'James'),
      resolved('s1-5', 18, 'Kait'),
    ];
    const batches = buildRepairBatches(segments, { contextSegments: 3 });
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.targetIds).toEqual(['s1-0', 's1-1']);
    // 3 context segments each side of the target run, not the whole transcript.
    expect(batch.segments.map((s) => s.id)).toEqual(['s0-1', 's0-2', 's0-3', 's1-0', 's1-1', 's1-2', 's1-3', 's1-4']);
    expect(batch.segments.filter((s) => s.target).map((s) => s.id)).toEqual(['s1-0', 's1-1']);
    // Candidate hint travels with the target.
    expect(batch.segments.find((s) => s.id === 's1-0')?.candidateSpeaker).toBe('Kait');
  });

  it('splits large target sets into multiple batches', () => {
    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < 10; i++) segments.push(unresolved(`s0-${i}`, i * 2));
    const batches = buildRepairBatches(segments, { maxTargetsPerBatch: 4, contextSegments: 0 });
    expect(batches.map((b) => b.targetIds.length)).toEqual([4, 4, 2]);
  });

  it('returns no batches when everything is resolved', () => {
    expect(buildRepairBatches([resolved('s0-0', 0, 'Kait')])).toEqual([]);
  });

  it('never targets user-confirmed segments', () => {
    const confirmed = { ...unresolved('s0-0', 0), userConfirmed: true, speaker: 'Kait' };
    expect(buildRepairBatches([confirmed])).toEqual([]);
  });
});

describe('buildSpeakerRepairPrompt / schema', () => {
  it('marks targets, forbids guessing, and asks for sparse id-only patches', () => {
    const batches = buildRepairBatches([resolved('s0-0', 0, 'Kait'), unresolved('s0-1', 2)]);
    const prompt = buildSpeakerRepairPrompt({
      segments: batches[0].segments,
      knownNames: NAMES,
      speakerNotes: ['speaks slowly', ''],
      contextNotes: 'Kait speaks first.',
    });
    expect(prompt).toContain('"patches": [{"segmentId": string, "speaker": string, "confidence": number}]');
    expect(prompt).toContain('OMIT that segment');
    expect(prompt).toContain('Never change or return transcript text');
    expect(prompt).toContain('- Kait: speaks slowly');
    expect(prompt).toContain('Kait speaks first.');
    expect(prompt).toContain('"target":true');
  });

  it('restricts the schema speaker enum to the known names', () => {
    const schema = buildSpeakerRepairResponseSchema(NAMES) as {
      properties: { patches: { items: { properties: { speaker: { enum: string[] } } } } };
    };
    expect(schema.properties.patches.items.properties.speaker.enum).toEqual(NAMES);
  });
});

describe('parseSpeakerRepairPatches', () => {
  const TARGETS = ['s1-0', 's1-1'];

  it('parses valid patches and canonicalizes speaker casing', () => {
    const raw = JSON.stringify({ patches: [{ segmentId: 's1-0', speaker: 'kait', confidence: 0.94 }] });
    expect(parseSpeakerRepairPatches(raw, TARGETS, NAMES)).toEqual([
      { segmentId: 's1-0', speaker: 'Kait', confidence: 0.94 },
    ]);
  });

  it('rejects unknown ids and non-target (context) ids', () => {
    const raw = JSON.stringify({
      patches: [
        { segmentId: 's0-0', speaker: 'Kait', confidence: 0.99 }, // context id
        { segmentId: 'nope', speaker: 'Kait', confidence: 0.99 }, // unknown id
        { segmentId: 's1-1', speaker: 'James', confidence: 0.92 },
      ],
    });
    expect(parseSpeakerRepairPatches(raw, TARGETS, NAMES)).toEqual([
      { segmentId: 's1-1', speaker: 'James', confidence: 0.92 },
    ]);
  });

  it('rejects unapproved speaker names', () => {
    const raw = JSON.stringify({ patches: [{ segmentId: 's1-0', speaker: 'Bob', confidence: 0.99 }] });
    expect(parseSpeakerRepairPatches(raw, TARGETS, NAMES)).toEqual([]);
  });

  it('clamps confidence into [0, 1] and drops non-numeric confidence', () => {
    const raw = JSON.stringify({
      patches: [
        { segmentId: 's1-0', speaker: 'Kait', confidence: 1.7 },
        { segmentId: 's1-1', speaker: 'James', confidence: 'high' },
      ],
    });
    expect(parseSpeakerRepairPatches(raw, TARGETS, NAMES)).toEqual([
      { segmentId: 's1-0', speaker: 'Kait', confidence: 1 },
    ]);
  });

  it('treats an empty patches array as valid', () => {
    expect(parseSpeakerRepairPatches(JSON.stringify({ patches: [] }), TARGETS, NAMES)).toEqual([]);
  });

  it('throws on invalid JSON or wrong shape', () => {
    expect(() => parseSpeakerRepairPatches('nope', TARGETS, NAMES)).toThrow('invalid JSON');
    expect(() => parseSpeakerRepairPatches(JSON.stringify({ foo: 1 }), TARGETS, NAMES)).toThrow('{patches: [...]}');
  });
});

describe('applySpeakerRepairPatches', () => {
  it('applies a confident patch with full provenance and preserves the previous assignment', () => {
    const segments = [unresolved('s1-0', 8, 'Kait')];
    const { segments: out, applied } = applySpeakerRepairPatches(
      segments,
      [{ segmentId: 's1-0', speaker: 'Kait', confidence: 0.94 }],
      { knownNames: NAMES, minConfidence: 0.9 },
    );
    expect(applied).toBe(1);
    expect(out[0]).toMatchObject({
      speaker: 'Kait',
      resolvedSpeaker: 'Kait',
      speakerConfidence: 0.94,
      mappingSource: 'repair',
      repairedFrom: 'Speaker A',
      localSpeakerId: 'c1:label:a', // local identity provenance survives
    });
    // Input untouched (immutable application).
    expect(segments[0].speaker).toBe('Speaker A');
  });

  it('skips patches below the confidence floor without invalidating anything', () => {
    const segments = [unresolved('s1-0', 8)];
    const result = applySpeakerRepairPatches(segments, [{ segmentId: 's1-0', speaker: 'Kait', confidence: 0.8 }], {
      knownNames: NAMES,
      minConfidence: 0.9,
    });
    expect(result.applied).toBe(0);
    expect(result.belowConfidence).toBe(1);
    expect(result.segments[0].speaker).toBe('Speaker A');
  });

  it('never overwrites a user-confirmed assignment', () => {
    const confirmed = { ...unresolved('s1-0', 8), userConfirmed: true, speaker: 'James' };
    const result = applySpeakerRepairPatches([confirmed], [{ segmentId: 's1-0', speaker: 'Kait', confidence: 0.99 }], {
      knownNames: NAMES,
      minConfidence: 0.9,
    });
    expect(result.applied).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.segments[0].speaker).toBe('James');
  });

  it('never overwrites an already-resolved segment', () => {
    const seg = resolved('s0-0', 0, 'James');
    const result = applySpeakerRepairPatches([seg], [{ segmentId: 's0-0', speaker: 'Kait', confidence: 0.99 }], {
      knownNames: NAMES,
      minConfidence: 0.9,
    });
    expect(result.applied).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.segments[0].speaker).toBe('James');
  });

  it('rejects patches for ids not present in the transcript and unapproved names', () => {
    const segments = [unresolved('s1-0', 8)];
    const result = applySpeakerRepairPatches(
      segments,
      [
        { segmentId: 'ghost', speaker: 'Kait', confidence: 0.99 },
        { segmentId: 's1-0', speaker: 'Bob', confidence: 0.99 },
      ],
      { knownNames: NAMES, minConfidence: 0.9 },
    );
    expect(result.applied).toBe(0);
    expect(result.rejected).toBe(2);
  });

  it('clears a conflict flag when a confident repair resolves the segment', () => {
    const conflicted = { ...unresolved('s1-0', 8), mappingConflict: true };
    const result = applySpeakerRepairPatches([conflicted], [{ segmentId: 's1-0', speaker: 'James', confidence: 0.95 }], {
      knownNames: NAMES,
      minConfidence: 0.9,
    });
    expect(result.segments[0].mappingConflict).toBeUndefined();
    expect(result.segments[0].resolvedSpeaker).toBe('James');
  });
});
