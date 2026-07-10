import { describe, expect, it } from 'vitest';
import { buildCorrectionPrompt, buildCorrectionResponseSchema } from '../lib/buildCorrectionPrompt';
import type { IndexedTranscriptSegment } from '../lib/types';

const SEGMENTS: IndexedTranscriptSegment[] = [
  { index: 0, start: 0, end: 2, speaker: 'Kait', text: 'Hello there.' },
  { index: 1, start: 2, end: 5, speaker: 'James', text: 'Hi. How was your day?' },
];

function build(overrides: Partial<Parameters<typeof buildCorrectionPrompt>[0]> = {}) {
  return buildCorrectionPrompt({
    segments: SEGMENTS,
    speakerNames: ['Kait', 'James'],
    contextNotes: '',
    mode: 'diarized',
    ...overrides,
  });
}

describe('buildCorrectionPrompt', () => {
  it('keeps the preservation-first core rules', () => {
    const prompt = build();
    expect(prompt).toContain('preservation-first');
    expect(prompt).toContain('Do NOT summarize');
    expect(prompt).toContain('Known speakers in this conversation: Kait, James.');
  });

  it('tells the model segments are independent units — no moving words, no dropping segments', () => {
    const prompt = build();
    expect(prompt).toContain('Never move words between segments');
    expect(prompt).toContain('independent unit');
    expect(prompt).toContain('must come back under its own index');
  });

  it('tells the model to return already-correct segments unchanged and preserve input order', () => {
    const prompt = build();
    expect(prompt).toContain('return its speaker and text exactly as given');
    expect(prompt).toContain('keeping the array in the same index order as the input');
  });

  it('includes the input segments as JSON with index/start/speaker/text', () => {
    const prompt = build();
    expect(prompt).toContain('"index":0');
    expect(prompt).toContain('"speaker":"James"');
    expect(prompt).toContain('"text":"Hello there."');
  });
});

describe('buildCorrectionResponseSchema', () => {
  it('builds the base array-of-objects schema without a tag field', () => {
    const schema = buildCorrectionResponseSchema(false) as {
      type: string;
      items: { type: string; properties: Record<string, unknown>; required: string[] };
    };
    expect(schema.type).toBe('ARRAY');
    expect(schema.items.type).toBe('OBJECT');
    expect(Object.keys(schema.items.properties).sort()).toEqual(['index', 'speaker', 'text']);
    expect(schema.items.required.sort()).toEqual(['index', 'speaker', 'text']);
  });

  it('adds a required tag enum of exactly the six valid values when argument tagging is on', () => {
    const schema = buildCorrectionResponseSchema(true) as {
      items: { properties: { tag?: { type: string; enum: string[] } }; required: string[] };
    };
    expect(schema.items.required).toContain('tag');
    expect(schema.items.properties.tag?.type).toBe('STRING');
    expect(schema.items.properties.tag?.enum.sort()).toEqual(
      ['argument_conflict', 'emotional_support', 'logistics_or_normal', 'repair_attempt', 'unclear', 'unrelated'].sort(),
    );
  });
});
