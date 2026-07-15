import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSCRIBER_SETTINGS, type TranscriberSettings } from '../lib/settings';
import {
  buildAttemptKey,
  buildClassifyKey,
  buildClassifyKeyBase,
  buildCleanupKey,
  buildRepairKeyBase,
  fingerprint,
  fingerprintContent,
} from '../lib/stageCacheKeys';

const SETTINGS: TranscriberSettings = { ...DEFAULT_TRANSCRIBER_SETTINGS, fallbackOrder: ['gemini', 'openai-whisper'] };

const SEGMENTS_A = [
  { id: 's0-0', speaker: 'Kait', text: 'Hello there.' },
  { id: 's0-1', speaker: 'James', text: 'Hi.' },
];
const SEGMENTS_B = [
  { id: 's0-0', speaker: 'James', text: 'Hello there.' },
  { id: 's0-1', speaker: 'Kait', text: 'Hi.' },
];
const FP_A = fingerprintContent(SEGMENTS_A);
const FP_B = fingerprintContent(SEGMENTS_B);

function attemptKey(settings: TranscriberSettings = SETTINGS, overrides: Partial<Parameters<typeof buildAttemptKey>[0]> = {}) {
  return buildAttemptKey({
    fileKey: 'file.m4a|1000|123',
    providerId: 'openai-diarized',
    model: 'gpt-4o-transcribe-diarize',
    settings,
    speakerNames: ['Kait', 'James'],
    speakerNotes: ['', ''],
    clipsFingerprint: 'Kait:abc123',
    contextNotes: 'ctx',
    ...overrides,
  });
}

describe('stage cache keys: independence invariants', () => {
  it('changing the argument classifier model or expansion never changes the cleanup or attempt key', () => {
    const base = attemptKey();
    const changed: TranscriberSettings = {
      ...SETTINGS,
      argumentClassifierModel: 'gemini-2.5-flash',
      argumentExpandSeconds: 300,
      argumentTagging: true,
    };
    expect(attemptKey(changed)).toBe(base);
    expect(
      buildCleanupKey({ attemptKey: base, settings: changed, segmentsFingerprint: FP_A, contextNotes: 'ctx' }),
    ).toBe(buildCleanupKey({ attemptKey: base, settings: SETTINGS, segmentsFingerprint: FP_A, contextNotes: 'ctx' }));
    // ...and the classification base key doesn't change either (expansion is
    // pure post-processing; the model is appended separately).
    expect(
      buildClassifyKeyBase({ attemptKey: base, settings: changed, blocksFingerprint: FP_A, contextNotes: 'ctx' }),
    ).toBe(
      buildClassifyKeyBase({ attemptKey: base, settings: SETTINGS, blocksFingerprint: FP_A, contextNotes: 'ctx' }),
    );
  });

  it('changing the cleanup model invalidates cleanup + classification but not the attempt or repair key', () => {
    const key = attemptKey();
    const changed: TranscriberSettings = { ...SETTINGS, cleanupModel: 'gemini-3.5-flash' };
    expect(attemptKey(changed)).toBe(key);
    expect(buildRepairKeyBase({ attemptKey: key, contextNotes: 'ctx' })).toBe(
      buildRepairKeyBase({ attemptKey: key, contextNotes: 'ctx' }),
    );
    expect(
      buildCleanupKey({ attemptKey: key, settings: changed, segmentsFingerprint: FP_A, contextNotes: 'ctx' }),
    ).not.toBe(buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: FP_A, contextNotes: 'ctx' }));
    expect(
      buildClassifyKeyBase({ attemptKey: key, settings: changed, blocksFingerprint: FP_A, contextNotes: 'ctx' }),
    ).not.toBe(
      buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, blocksFingerprint: FP_A, contextNotes: 'ctx' }),
    );
  });

  it('a different clip content hash invalidates the attempt key (and so everything downstream)', () => {
    expect(attemptKey(SETTINGS, { clipsFingerprint: 'Kait:abc123' })).not.toBe(
      attemptKey(SETTINGS, { clipsFingerprint: 'Kait:def456' }),
    );
  });

  it('changed repair output invalidates cleanup and classification, even with the SAME patch count', () => {
    const key = attemptKey();
    // Fix 4 regression: two repair outcomes with an identical applied-patch
    // count but different speaker assignments/text must never collide.
    expect(SEGMENTS_A.length).toBe(SEGMENTS_B.length);
    expect(fingerprint(SEGMENTS_A)).not.toBe(fingerprint(SEGMENTS_B));
    expect(
      buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: FP_A, contextNotes: 'ctx' }),
    ).not.toBe(buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: FP_B, contextNotes: 'ctx' }));
    expect(
      buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, blocksFingerprint: FP_A, contextNotes: 'ctx' }),
    ).not.toBe(
      buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, blocksFingerprint: FP_B, contextNotes: 'ctx' }),
    );
  });

  it('identical repair output produces the identical cleanup/classification key (cache HIT, not just distinct on change)', () => {
    const key = attemptKey();
    const fpAAgain = fingerprintContent(SEGMENTS_A.map((s) => ({ ...s })));
    expect(
      buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: FP_A, contextNotes: 'ctx' }),
    ).toBe(buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: fpAAgain, contextNotes: 'ctx' }));
  });

  it('the classifier model participates only in the final classification key', () => {
    const base = buildClassifyKeyBase({
      attemptKey: attemptKey(),
      settings: SETTINGS,
      blocksFingerprint: FP_A,
      contextNotes: 'ctx',
    });
    expect(buildClassifyKey(base, 'gemini-2.5-flash-lite')).not.toBe(buildClassifyKey(base, 'gemini-2.5-flash'));
  });

  it('context notes key Gemini attempts but not OpenAI attempts', () => {
    const openaiA = attemptKey(SETTINGS, { contextNotes: 'a' });
    const openaiB = attemptKey(SETTINGS, { contextNotes: 'b' });
    expect(openaiA).toBe(openaiB);
    const geminiA = attemptKey(SETTINGS, { providerId: 'gemini', contextNotes: 'a' });
    const geminiB = attemptKey(SETTINGS, { providerId: 'gemini', contextNotes: 'b' });
    expect(geminiA).not.toBe(geminiB);
  });

  it('every stage key embeds a schema/prompt version so old pipelines never feed new ones', () => {
    const key = attemptKey();
    expect(key).toContain('schema:');
    expect(
      buildCleanupKey({ attemptKey: key, settings: SETTINGS, segmentsFingerprint: FP_A, contextNotes: '' }),
    ).toMatch(/v:\d+:\d+/);
    expect(buildRepairKeyBase({ attemptKey: key, contextNotes: '' })).toContain('repair:v');
    expect(buildClassifyKey('base', 'gemini-2.5-flash-lite')).toMatch(/v\d+$/);
  });
});

describe('fingerprintContent', () => {
  it('is deterministic for the same content', () => {
    expect(fingerprintContent(SEGMENTS_A)).toBe(fingerprintContent(SEGMENTS_A.map((s) => ({ ...s }))));
  });

  it('changes when text changes but ids/speakers do not', () => {
    const changed = [{ ...SEGMENTS_A[0], text: 'A different opening line.' }, SEGMENTS_A[1]];
    expect(fingerprintContent(changed)).not.toBe(fingerprintContent(SEGMENTS_A));
  });

  it('changes when speaker assignment changes but text/ids do not', () => {
    expect(fingerprintContent(SEGMENTS_B)).not.toBe(fingerprintContent(SEGMENTS_A));
  });

  it('gives id-less items a positional fallback key that still distinguishes different content', () => {
    const noIds = SEGMENTS_A.map(({ speaker, text }) => ({ speaker, text }));
    const noIdsRepeat = SEGMENTS_A.map(({ speaker, text }) => ({ speaker, text }));
    const noIdsSwapped = SEGMENTS_B.map(({ speaker, text }) => ({ speaker, text }));
    expect(fingerprintContent(noIds)).toBe(fingerprintContent(noIdsRepeat));
    expect(fingerprintContent(noIds)).not.toBe(fingerprintContent(noIdsSwapped));
  });
});
