import { describe, expect, it } from 'vitest';
import { buildCorrectionPrompt, buildCorrectionResponseSchema } from '../lib/buildCorrectionPrompt';
import type { CorrectionRequestSegment } from '../lib/types';

const SEGMENTS: CorrectionRequestSegment[] = [
  { id: 's0-0', start: 0, end: 2, speaker: 'Kait', text: 'Hello there.' },
  { id: 's0-1', start: 2, end: 5, speaker: 'James', text: 'Hi. How was your day?' },
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
    expect(prompt).toContain('profanity');
  });

  it('tells the model segments are independent units — no moving words', () => {
    const prompt = build();
    expect(prompt).toContain('Never move words between segments');
    expect(prompt).toContain('independent unit');
  });

  it('asks for sparse patches only, with empty patches as a valid answer', () => {
    const prompt = build();
    expect(prompt).toContain('{"patches": [{"id": string, "text": string}]}');
    expect(prompt).toContain('ONLY for each segment whose text you actually changed');
    expect(prompt).toContain('empty patches array');
  });

  it('marks speakers as context only — no speaker corrections in this pass', () => {
    const prompt = build();
    expect(prompt).toContain('context only');
    expect(prompt).toContain('do NOT correct them');
  });

  it('never asks for argument tags (classification is a separate stage)', () => {
    const prompt = build();
    expect(prompt).not.toContain('argument_conflict');
    expect(prompt).not.toContain('tag');
  });

  it('includes the input segments as JSON with id/start/speaker/text', () => {
    const prompt = build();
    expect(prompt).toContain('"id":"s0-0"');
    expect(prompt).toContain('"speaker":"James"');
    expect(prompt).toContain('"text":"Hello there."');
  });

  it('includes user context notes when present', () => {
    const prompt = build({ contextNotes: 'Two speakers, arguing about dishes.' });
    expect(prompt).toContain('Two speakers, arguing about dishes.');
  });
});

describe('buildCorrectionResponseSchema', () => {
  it('builds the sparse-patch object schema', () => {
    const schema = buildCorrectionResponseSchema() as {
      type: string;
      properties: { patches: { type: string; items: { properties: Record<string, unknown>; required: string[] } } };
      required: string[];
    };
    expect(schema.type).toBe('OBJECT');
    expect(schema.required).toEqual(['patches']);
    expect(schema.properties.patches.type).toBe('ARRAY');
    expect(Object.keys(schema.properties.patches.items.properties).sort()).toEqual(['id', 'text']);
    expect(schema.properties.patches.items.required.sort()).toEqual(['id', 'text']);
  });
});
