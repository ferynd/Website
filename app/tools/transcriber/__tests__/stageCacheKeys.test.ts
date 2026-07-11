import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSCRIBER_SETTINGS, type TranscriberSettings } from '../lib/settings';
import {
  buildAttemptKey,
  buildClassifyKey,
  buildClassifyKeyBase,
  buildCleanupKey,
  buildRepairKeyBase,
} from '../lib/stageCacheKeys';

const SETTINGS: TranscriberSettings = { ...DEFAULT_TRANSCRIBER_SETTINGS, fallbackOrder: ['gemini', 'openai-whisper'] };

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
    expect(buildCleanupKey({ attemptKey: base, settings: changed, repairsApplied: 0, contextNotes: 'ctx' })).toBe(
      buildCleanupKey({ attemptKey: base, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' }),
    );
    // ...and the classification base key doesn't change either (expansion is
    // pure post-processing; the model is appended separately).
    expect(buildClassifyKeyBase({ attemptKey: base, settings: changed, repairsApplied: 0, contextNotes: 'ctx' })).toBe(
      buildClassifyKeyBase({ attemptKey: base, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' }),
    );
  });

  it('changing the cleanup model invalidates cleanup + classification but not the attempt or repair key', () => {
    const key = attemptKey();
    const changed: TranscriberSettings = { ...SETTINGS, cleanupModel: 'gemini-3.5-flash' };
    expect(attemptKey(changed)).toBe(key);
    expect(buildRepairKeyBase({ attemptKey: key, contextNotes: 'ctx' })).toBe(
      buildRepairKeyBase({ attemptKey: key, contextNotes: 'ctx' }),
    );
    expect(buildCleanupKey({ attemptKey: key, settings: changed, repairsApplied: 0, contextNotes: 'ctx' })).not.toBe(
      buildCleanupKey({ attemptKey: key, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' }),
    );
    expect(buildClassifyKeyBase({ attemptKey: key, settings: changed, repairsApplied: 0, contextNotes: 'ctx' })).not.toBe(
      buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' }),
    );
  });

  it('a different clip content hash invalidates the attempt key (and so everything downstream)', () => {
    expect(attemptKey(SETTINGS, { clipsFingerprint: 'Kait:abc123' })).not.toBe(
      attemptKey(SETTINGS, { clipsFingerprint: 'Kait:def456' }),
    );
  });

  it('changed repair output (applied count) invalidates cleanup and classification', () => {
    const key = attemptKey();
    expect(buildCleanupKey({ attemptKey: key, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' })).not.toBe(
      buildCleanupKey({ attemptKey: key, settings: SETTINGS, repairsApplied: 3, contextNotes: 'ctx' }),
    );
    expect(buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' })).not.toBe(
      buildClassifyKeyBase({ attemptKey: key, settings: SETTINGS, repairsApplied: 3, contextNotes: 'ctx' }),
    );
  });

  it('the classifier model participates only in the final classification key', () => {
    const base = buildClassifyKeyBase({ attemptKey: attemptKey(), settings: SETTINGS, repairsApplied: 0, contextNotes: 'ctx' });
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
    expect(buildCleanupKey({ attemptKey: key, settings: SETTINGS, repairsApplied: 0, contextNotes: '' })).toMatch(/v:\d+:\d+/);
    expect(buildRepairKeyBase({ attemptKey: key, contextNotes: '' })).toContain('repair:v');
    expect(buildClassifyKey('base', 'gemini-2.5-flash-lite')).toMatch(/v\d+$/);
  });
});
