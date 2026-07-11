import { describe, expect, it } from 'vitest';
import { appendDebugEvent, buildDebugJson, createDebugLog, setDebugManifest, SPEAKER_REFERENCE_NOT_CONFIGURED } from '../lib/runDebug';

const FILE_META = { name: 'argument-2026-06-30.m4a', sizeBytes: 16 * 1024 * 1024, mimeType: 'audio/x-m4a' };

describe('runDebug', () => {
  it('createDebugLog starts with the given file metadata and no events', () => {
    const log = createDebugLog(FILE_META);
    expect(log.file).toEqual(FILE_META);
    expect(log.events).toEqual([]);
    expect(typeof log.createdAt).toBe('number');
  });

  it('appendDebugEvent appends in place and returns the same log object', () => {
    const log = createDebugLog(FILE_META);
    const returned = appendDebugEvent(log, { kind: 'raw-captured', segmentCount: 42 });
    expect(returned).toBe(log);
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({ kind: 'raw-captured', segmentCount: 42 });
    expect(typeof log.events[0].at).toBe('number');
  });

  it('preserves event append order', () => {
    const log = createDebugLog(FILE_META);
    appendDebugEvent(log, { kind: 'provider-attempt', provider: 'openai-diarized', model: 'gpt-4o-transcribe-diarize' });
    appendDebugEvent(log, { kind: 'provider-attempt', provider: 'openai-whisper', model: 'whisper-1' });
    appendDebugEvent(log, { kind: 'raw-captured', segmentCount: 10 });

    expect(log.events.map((e) => e.kind)).toEqual(['provider-attempt', 'provider-attempt', 'raw-captured']);

    const parsed = JSON.parse(buildDebugJson(log));
    expect(parsed.provider.fallbackPath).toEqual(['openai-diarized', 'openai-whisper']);
    expect(parsed.provider.selected).toBe('openai-whisper');
    expect(parsed.provider.model).toBe('whisper-1');
  });

  it('buildDebugJson has the documented top-level shape', () => {
    const log = createDebugLog(FILE_META);
    appendDebugEvent(log, { kind: 'provider-attempt', provider: 'openai-diarized', model: 'gpt-4o-transcribe-diarize' });
    appendDebugEvent(log, { kind: 'raw-captured', segmentCount: 120 });
    appendDebugEvent(log, { kind: 'suppression', sensitivity: 'conservative', groupsRemoved: 1, segmentsRemoved: 6 });
    appendDebugEvent(log, { kind: 'cleanup-warning', failedChunks: 1, totalChunks: 3 });
    appendDebugEvent(log, {
      kind: 'error',
      category: 'openai-quota',
      stage: 'transcribe',
      provider: 'openai-diarized',
      upstreamStatus: 429,
      upstreamBody: 'insufficient_quota',
    });

    const parsed = JSON.parse(buildDebugJson(log));
    expect(parsed).toHaveProperty('file');
    expect(parsed).toHaveProperty('provider.selected', 'openai-diarized');
    expect(parsed).toHaveProperty('provider.model', 'gpt-4o-transcribe-diarize');
    expect(parsed).toHaveProperty('provider.fallbackPath');
    expect(parsed.rawSegmentCount).toBe(120);
    expect(parsed.suppressionWarnings).toEqual([{ sensitivity: 'conservative', groupsRemoved: 1, segmentsRemoved: 6 }]);
    expect(parsed.cleanupWarnings).toEqual([{ failedChunks: 1, totalChunks: 3 }]);
    expect(parsed.speakerReferenceStatus).toBe(SPEAKER_REFERENCE_NOT_CONFIGURED);
    expect(parsed.errors).toEqual([
      { category: 'openai-quota', stage: 'transcribe', provider: 'openai-diarized', upstreamStatus: 429, upstreamBody: 'insufficient_quota' },
    ]);
  });

  it('defaults rawSegmentCount to null and speakerReferenceStatus to the placeholder when no events were appended', () => {
    const parsed = JSON.parse(buildDebugJson(createDebugLog(FILE_META)));
    expect(parsed.rawSegmentCount).toBeNull();
    expect(parsed.provider.selected).toBeNull();
    expect(parsed.speakerReferenceStatus).toBe(SPEAKER_REFERENCE_NOT_CONFIGURED);
    expect(parsed.suppressionWarnings).toEqual([]);
    expect(parsed.cleanupWarnings).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it('a Gemini prompt-inferred speaker-reference event overrides the placeholder', () => {
    const log = createDebugLog(FILE_META);
    appendDebugEvent(log, { kind: 'speaker-reference', status: 'prompt-inferred' });
    expect(JSON.parse(buildDebugJson(log)).speakerReferenceStatus).toBe('prompt-inferred');
  });

  it('a Gemini experimental-reference-clips speaker-reference event overrides the placeholder', () => {
    const log = createDebugLog(FILE_META);
    appendDebugEvent(log, { kind: 'speaker-reference', status: 'prompt-inferred+reference-clips (experimental)' });
    expect(JSON.parse(buildDebugJson(log)).speakerReferenceStatus).toBe('prompt-inferred+reference-clips (experimental)');
  });

  it('defaults argumentTagSummary to null when no argument-tagging event was appended', () => {
    const parsed = JSON.parse(buildDebugJson(createDebugLog(FILE_META)));
    expect(parsed.argumentTagSummary).toBeNull();
  });

  it('an argument-tagging event surfaces the zero-filled tag summary', () => {
    const log = createDebugLog(FILE_META);
    const tagSummary = {
      argument_conflict: 2,
      repair_attempt: 1,
      emotional_support: 0,
      logistics_or_normal: 10,
      unrelated: 0,
      unclear: 3,
    };
    appendDebugEvent(log, { kind: 'argument-tagging', tagSummary });
    expect(JSON.parse(buildDebugJson(log)).argumentTagSummary).toEqual(tagSummary);
  });

  it('an OpenAI diarized speaker-reference event carries a per-speaker attached/validationStatus array', () => {
    const log = createDebugLog(FILE_META);
    const entries = [
      { name: 'Kait', attached: true, validationStatus: 'ok' },
      { name: 'James', attached: false, validationStatus: 'missing' },
    ];
    appendDebugEvent(log, { kind: 'speaker-reference', status: entries });
    expect(JSON.parse(buildDebugJson(log)).speakerReferenceStatus).toEqual(entries);
  });

  it('never carries transcript text: events only accept counts/labels, and the JSON never contains content that was not explicitly passed as a label', () => {
    const secretTranscriptSnippet = 'I really think we should talk about this later tonight';
    const log = createDebugLog(FILE_META);
    appendDebugEvent(log, { kind: 'raw-captured', segmentCount: 5 });
    appendDebugEvent(log, { kind: 'suppression', sensitivity: 'aggressive', groupsRemoved: 2, segmentsRemoved: 9 });
    appendDebugEvent(log, {
      kind: 'error',
      category: 'gemini-parse',
      stage: 'cleanup',
      provider: null,
      upstreamStatus: 502,
      upstreamBody: 'Correction model returned invalid JSON.',
    });

    const json = buildDebugJson(log);
    expect(json).not.toContain(secretTranscriptSnippet);
    // Every event payload key is a count, label, or already-sanitized diagnostic string — never free-form transcript content.
    const parsed = JSON.parse(json);
    for (const event of parsed.events) {
      const { kind, at, ...rest } = event;
      expect(kind).toBeTruthy();
      expect(typeof at).toBe('number');
      for (const value of Object.values(rest)) {
        if (typeof value === 'string') {
          expect(value.length).toBeLessThan(500); // sanitizeUpstreamError's own cap; never an unbounded transcript dump
        }
      }
    }
  });

  describe('stage manifest', () => {
    function sampleManifest() {
      return {
        pipelineSchemaVersion: 2,
        mappingAlgorithmVersion: 'map-v2/reconcile-v1',
        gitCommit: null,
        models: {
          transcribe: { provider: 'openai-diarized' as const, model: 'gpt-4o-transcribe-diarize' },
          speakerRepair: 'gemini-2.5-flash-lite',
          correction: 'gemini-2.5-flash',
          classification: null,
        },
        settings: { cleanupEnabled: true, openaiSpeedFactor: 1.0, provider: 'openai-diarized' },
        chunks: {
          transcription: { expected: 4, completed: 4 },
          cleanup: { expected: 3, completed: 3 },
          classification: null,
        },
        referenceClips: [{ name: 'Kait', attached: true, sha256: 'ab'.repeat(32) }],
        quality: null,
        patches: {
          speakerRepairApplied: 2,
          speakerRepairRejected: 0,
          textPatchesApplied: 5,
          textPatchesReverted: 1,
          classificationsApplied: 0,
        },
        usage: [{ stage: 'correct', usage: { model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 20, requests: 1 } }],
        fallbackPath: ['openai-diarized' as const],
        warningCodes: ['speaker-quality-low'],
      };
    }

    it('setDebugManifest attaches the manifest and buildDebugJson serializes it at the top level', () => {
      const log = createDebugLog({ name: 'a.m4a', sizeBytes: 10, mimeType: 'audio/mp4' });
      setDebugManifest(log, sampleManifest());
      const parsed = JSON.parse(buildDebugJson(log));
      expect(parsed.manifest.pipelineSchemaVersion).toBe(2);
      expect(parsed.manifest.models.speakerRepair).toBe('gemini-2.5-flash-lite');
      expect(parsed.manifest.referenceClips[0].sha256).toHaveLength(64);
    });

    it('manifest defaults to null when never set', () => {
      const log = createDebugLog({ name: 'a.m4a', sizeBytes: 10, mimeType: 'audio/mp4' });
      expect(JSON.parse(buildDebugJson(log)).manifest).toBeNull();
    });

    it('a full manifest never carries transcript text — only versions, counts, hashes, and safe settings', () => {
      const log = createDebugLog({ name: 'a.m4a', sizeBytes: 10, mimeType: 'audio/mp4' });
      setDebugManifest(log, sampleManifest());
      const json = buildDebugJson(log);
      // The manifest shape has no field that could carry content; spot-check
      // that serialization only contains the values we passed as labels.
      expect(json).not.toMatch(/"text"/);
      expect(json).not.toMatch(/"prompt"/);
    });
  });
});
