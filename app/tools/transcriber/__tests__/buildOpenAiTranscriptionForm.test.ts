import { describe, expect, it } from 'vitest';
import { buildOpenAiTranscriptionEntries } from '../lib/buildOpenAiTranscriptionForm';

describe('buildOpenAiTranscriptionEntries', () => {
  it('includes the model and diarized response_format/chunking fields when diarizes is true', () => {
    const entries = buildOpenAiTranscriptionEntries({ model: 'gpt-4o-transcribe-diarize', diarizes: true });
    expect(entries).toContainEqual(['model', 'gpt-4o-transcribe-diarize']);
    expect(entries).toContainEqual(['response_format', 'diarized_json']);
    expect(entries).toContainEqual(['chunking_strategy', 'auto']);
    expect(entries.some(([key]) => key === 'timestamp_granularities[]')).toBe(false);
  });

  it('includes the whisper-style verbose_json fields when diarizes is false', () => {
    const entries = buildOpenAiTranscriptionEntries({ model: 'whisper-1', diarizes: false });
    expect(entries).toContainEqual(['model', 'whisper-1']);
    expect(entries).toContainEqual(['response_format', 'verbose_json']);
    expect(entries).toContainEqual(['timestamp_granularities[]', 'segment']);
    expect(entries.some(([key]) => key === 'chunking_strategy')).toBe(false);
  });

  it('omits known_speaker fields entirely when there are no clips', () => {
    const entries = buildOpenAiTranscriptionEntries({ model: 'gpt-4o-transcribe-diarize', diarizes: true, clips: [] });
    expect(entries.some(([key]) => key.startsWith('known_speaker'))).toBe(false);
  });

  it('omits known_speaker fields when clips is undefined', () => {
    const entries = buildOpenAiTranscriptionEntries({ model: 'gpt-4o-transcribe-diarize', diarizes: true });
    expect(entries.some(([key]) => key.startsWith('known_speaker'))).toBe(false);
  });

  it('adds parallel known_speaker_names[]/known_speaker_references[] entries in matching order', () => {
    const clips = [
      { name: 'Kait', dataUrl: 'data:audio/wav;base64,AAA' },
      { name: 'James', dataUrl: 'data:audio/wav;base64,BBB' },
    ];
    const entries = buildOpenAiTranscriptionEntries({ model: 'gpt-4o-transcribe-diarize', diarizes: true, clips });

    const names = entries.filter(([key]) => key === 'known_speaker_names[]').map(([, value]) => value);
    const refs = entries.filter(([key]) => key === 'known_speaker_references[]').map(([, value]) => value);

    expect(names).toEqual(['Kait', 'James']);
    expect(refs).toEqual(['data:audio/wav;base64,AAA', 'data:audio/wav;base64,BBB']);
  });

  it('never attaches known_speaker fields for whisper even when clips are provided', () => {
    const clips = [{ name: 'Kait', dataUrl: 'data:audio/wav;base64,AAA' }];
    const entries = buildOpenAiTranscriptionEntries({ model: 'whisper-1', diarizes: false, clips });
    expect(entries.some(([key]) => key.startsWith('known_speaker'))).toBe(false);
  });
});
