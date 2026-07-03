import { describe, expect, it } from 'vitest';
import { buildOpenAiTranscriptionEntries, resolveOpenAiUploadMime } from '../lib/buildOpenAiTranscriptionForm';

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

describe('resolveOpenAiUploadMime', () => {
  it('corrects a misreported browser MIME for a .m4a file to audio/mp4 (observed failure case)', () => {
    expect(resolveOpenAiUploadMime('2026-07-23_nail_discussion_faststart.m4a', 'audio/mpeg')).toBe('audio/mp4');
  });

  it('derives the MIME from the extension when the browser reports none', () => {
    expect(resolveOpenAiUploadMime('session.m4a', '')).toBe('audio/mp4');
    expect(resolveOpenAiUploadMime('session.wav', '')).toBe('audio/wav');
  });

  it('overrides a generic application/octet-stream for a known extension', () => {
    expect(resolveOpenAiUploadMime('session.mp3', 'application/octet-stream')).toBe('audio/mpeg');
  });

  it('is case-insensitive on the extension', () => {
    expect(resolveOpenAiUploadMime('SESSION.M4A', 'audio/mpeg')).toBe('audio/mp4');
  });

  it('keeps a specific browser MIME for an unknown extension', () => {
    expect(resolveOpenAiUploadMime('session.opus', 'audio/opus')).toBe('audio/opus');
  });

  it('falls back to application/octet-stream for an unknown extension with a generic/empty browser MIME', () => {
    expect(resolveOpenAiUploadMime('session.xyz', '')).toBe('application/octet-stream');
    expect(resolveOpenAiUploadMime('noextension', 'application/octet-stream')).toBe('application/octet-stream');
  });

  it('agrees with the extension for the common already-correct cases (no unnecessary rewrap)', () => {
    expect(resolveOpenAiUploadMime('session.mp3', 'audio/mpeg')).toBe('audio/mpeg');
    expect(resolveOpenAiUploadMime('session.webm', 'audio/webm')).toBe('audio/webm');
  });
});
