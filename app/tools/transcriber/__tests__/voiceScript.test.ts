import { describe, expect, it } from 'vitest';
import { buildVoiceScript } from '../lib/voiceScript';

describe('buildVoiceScript', () => {
  it('interpolates the given name into the greeting', () => {
    expect(buildVoiceScript('Kait')).toContain('Hi, this is Kait.');
  });

  it('trims surrounding whitespace from the name', () => {
    expect(buildVoiceScript('  James  ')).toContain('Hi, this is James.');
  });

  it('falls back to "this speaker" for an empty name', () => {
    expect(buildVoiceScript('')).toContain('Hi, this is this speaker.');
  });

  it('falls back to "this speaker" for a whitespace-only name', () => {
    expect(buildVoiceScript('   ')).toContain('Hi, this is this speaker.');
  });

  it('produces the exact documented template', () => {
    expect(buildVoiceScript('Kait')).toBe(
      'Hi, this is Kait. I am recording a short voice sample for speaker identification. Today I walked into the kitchen, poured a glass of water, checked the time, and said that everything was okay. I might speak quickly or slowly depending on how I feel, but this is my normal speaking voice.',
    );
  });

  it('only the greeting changes between two different names — the rest of the template is stable', () => {
    const kait = buildVoiceScript('Kait');
    const james = buildVoiceScript('James');
    const kaitRest = kait.slice(kait.indexOf('. ') + 2);
    const jamesRest = james.slice(james.indexOf('. ') + 2);
    expect(kaitRest).toBe(jamesRest);
  });
});
