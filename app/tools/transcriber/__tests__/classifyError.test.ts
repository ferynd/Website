import { describe, expect, it } from 'vitest';
import { classifyTranscriptionError } from '../lib/classifyError';

describe('classifyTranscriptionError', () => {
  it('classifies a 429 insufficient_quota body from OpenAI as openai-quota', () => {
    const result = classifyTranscriptionError({
      httpStatus: 429,
      bodyText: '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}',
      provider: 'openai-diarized',
      stage: 'transcribe',
    });
    expect(result.category).toBe('openai-quota');
    expect(result.suggestsConversion).toBe(false);
    expect(result.retryProviders).toContain('gemini');
  });

  it('classifies a quota-worded body from Gemini as gemini-quota', () => {
    const result = classifyTranscriptionError({
      httpStatus: 429,
      bodyText: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}',
      provider: 'gemini',
      stage: 'cleanup',
    });
    expect(result.category).toBe('gemini-quota');
    expect(result.suggestsConversion).toBe(false);
  });

  it('classifies a Cloudflare-style HTML 413 body as platform-limit when the provider is not OpenAI/transcribe', () => {
    const result = classifyTranscriptionError({
      httpStatus: 413,
      bodyText: '<html><head><title>413 Request Entity Too Large</title></head><body>nginx</body></html>',
      provider: 'gemini',
      stage: 'upload',
    });
    expect(result.category).toBe('platform-limit');
    expect(result.suggestsConversion).toBe(false);
  });

  it('classifies a 413 for the OpenAI transcribe stage as openai-file-too-large', () => {
    const result = classifyTranscriptionError({
      httpStatus: 413,
      bodyText: 'File is 30.0 MB, which exceeds the upload limit.',
      provider: 'openai-diarized',
      stage: 'transcribe',
      fileName: 'session.m4a',
      fileSizeBytes: 30 * 1024 * 1024,
    });
    expect(result.category).toBe('openai-file-too-large');
    expect(result.suggestsConversion).toBe(false);
    expect(result.retryProviders).toContain('gemini');
  });

  it('classifies a 400 unsupported/corrupt format response as openai-unsupported-format and ONLY this category suggests conversion', () => {
    const result = classifyTranscriptionError({
      httpStatus: 400,
      bodyText: '{"error":{"message":"Invalid file format. The audio could not be decoded.","type":"invalid_request_error"}}',
      provider: 'openai-diarized',
      stage: 'transcribe',
      fileName: 'session.m4a',
      fileSizeBytes: 16 * 1024 * 1024,
    });
    expect(result.category).toBe('openai-unsupported-format');
    expect(result.suggestsConversion).toBe(true);
    expect(result.retryProviders).toContain('gemini');
  });

  it('frames a 400 rejection of a supported extension as file-specific, never as the format being unsupported (observed .m4a failure)', () => {
    const result = classifyTranscriptionError({
      httpStatus: 400,
      bodyText: '{"error":{"message":"Audio file might be corrupted or unsupported","type":"invalid_request_error","param":"file","code":"invalid_value"}}',
      provider: 'openai-diarized',
      stage: 'transcribe',
      fileName: '2026-07-23_nail_discussion_faststart.m4a',
      fileSizeBytes: 9523824,
      browserMime: 'audio/mpeg',
    });
    expect(result.category).toBe('openai-unsupported-format');
    expect(result.suggestsConversion).toBe(true);
    expect(result.retryProviders).toContain('gemini');
    // The copy must say .m4a IS supported and OpenAI rejected THIS file...
    expect(result.likelyCause).toContain('.m4a');
    expect(result.likelyCause).toMatch(/supported format/i);
    // ...and flag the extension/MIME mismatch as a hint about the contents.
    expect(result.likelyCause).toContain('audio/mpeg');
    // Never the old "convert because the format is unsupported" framing.
    expect(result.recommendedAction).not.toMatch(/convert the file to/i);
  });

  it('does not flag a MIME mismatch when the browser MIME is a normal one for the extension', () => {
    const result = classifyTranscriptionError({
      httpStatus: 400,
      bodyText: 'The audio could not be decoded or its format is not supported.',
      provider: 'openai-diarized',
      stage: 'transcribe',
      fileName: 'session.m4a',
      browserMime: 'audio/x-m4a',
    });
    expect(result.category).toBe('openai-unsupported-format');
    expect(result.likelyCause).toContain('.m4a');
    expect(result.likelyCause).not.toContain('audio/x-m4a');
  });

  it('keeps the generic decode-failure copy for an unknown extension', () => {
    const result = classifyTranscriptionError({
      httpStatus: 400,
      bodyText: 'Invalid file format.',
      provider: 'openai-whisper',
      stage: 'transcribe',
      fileName: 'session.amr',
      browserMime: 'audio/amr',
    });
    expect(result.category).toBe('openai-unsupported-format');
    expect(result.likelyCause.length).toBeGreaterThan(0);
    expect(result.likelyCause).not.toContain('.amr');
  });

  it('classifies a 401 from OpenAI upstream as openai-auth (not our own admin gate)', () => {
    const result = classifyTranscriptionError({
      httpStatus: 401,
      bodyText: '{"error":{"message":"Incorrect API key provided: sk-***","type":"invalid_request_error"}}',
      provider: 'openai-diarized',
      stage: 'transcribe',
    });
    expect(result.category).toBe('openai-auth');
  });

  it('classifies a 401 from our own admin-gate rejection as auth-config', () => {
    const result = classifyTranscriptionError({
      httpStatus: 401,
      bodyText: 'Missing bearer token.',
      provider: null,
      stage: 'auth',
    });
    expect(result.category).toBe('auth-config');
    expect(result.retryProviders).toEqual([]);
  });

  it('classifies a 403 site-owner-restriction rejection as auth-config', () => {
    const result = classifyTranscriptionError({
      httpStatus: 403,
      bodyText: 'This tool is restricted to the site owner.',
      provider: null,
      stage: 'auth',
    });
    expect(result.category).toBe('auth-config');
  });

  it('classifies a 401 from our own admin gate during a gemini upload as auth-config, not gemini-upload', () => {
    const result = classifyTranscriptionError({
      httpStatus: 401,
      bodyText: 'Invalid or expired token.',
      provider: 'gemini',
      stage: 'upload',
    });
    expect(result.category).toBe('auth-config');
    expect(result.retryProviders).toEqual([]);
  });

  it('classifies a Gemini Files API upload failure as gemini-upload', () => {
    const result = classifyTranscriptionError({
      httpStatus: 500,
      bodyText: 'File processing failed.',
      provider: 'gemini',
      stage: 'upload',
    });
    expect(result.category).toBe('gemini-upload');
  });

  it('classifies a Gemini Files API poll failure as gemini-upload', () => {
    const result = classifyTranscriptionError({
      httpStatus: 500,
      bodyText: 'File state is FAILED.',
      provider: 'gemini',
      stage: 'poll',
    });
    expect(result.category).toBe('gemini-upload');
  });

  it('classifies a cleanup-stage JSON/schema parse failure as gemini-parse', () => {
    const result = classifyTranscriptionError({
      httpStatus: 502,
      bodyText: 'Correction model returned invalid JSON.',
      provider: null,
      stage: 'cleanup',
    });
    expect(result.category).toBe('gemini-parse');
    expect(result.suggestsConversion).toBe(false);
  });

  it('classifies a null httpStatus as network', () => {
    const result = classifyTranscriptionError({
      httpStatus: null,
      bodyText: 'Network error while uploading.',
      provider: 'openai-diarized',
      stage: 'upload',
    });
    expect(result.category).toBe('network');
    expect(result.retryProviders).toEqual(['openai-diarized']);
  });

  it('offers a manual Whisper retry for an otherwise-unclassified diarized-model transcribe failure', () => {
    const result = classifyTranscriptionError({
      httpStatus: 503,
      bodyText: 'The model is temporarily unavailable.',
      provider: 'openai-diarized',
      stage: 'transcribe',
    });
    expect(result.category).toBe('unknown');
    expect(result.retryProviders).toEqual(['openai-whisper']);
  });

  it('does not offer a Whisper retry for an unclassified failure once Whisper itself was the provider', () => {
    const result = classifyTranscriptionError({
      httpStatus: 503,
      bodyText: 'Temporarily unavailable.',
      provider: 'openai-whisper',
      stage: 'transcribe',
    });
    expect(result.category).toBe('unknown');
    expect(result.retryProviders).toEqual([]);
  });

  it('acceptance criterion: a plain 500 for a 16 MB m4a is never mislabeled as size/format and never suggests conversion', () => {
    const result = classifyTranscriptionError({
      httpStatus: 500,
      bodyText: 'Internal Server Error',
      provider: 'openai-diarized',
      stage: 'transcribe',
      fileName: 'argument-2026-06-30.m4a',
      fileSizeBytes: 16 * 1024 * 1024,
      browserMime: 'audio/x-m4a',
    });
    expect(result.category).toBe('unknown');
    expect(result.suggestsConversion).toBe(false);
    expect(result.category).not.toBe('openai-unsupported-format');
    expect(result.category).not.toBe('openai-file-too-large');
    expect(result.category).not.toBe('platform-limit');
  });

  it('every category has non-empty likelyCause/recommendedAction copy', () => {
    const fixtures: Parameters<typeof classifyTranscriptionError>[0][] = [
      { httpStatus: null, bodyText: '', provider: null, stage: 'transcribe' },
      { httpStatus: 429, bodyText: 'insufficient_quota', provider: 'openai-diarized', stage: 'transcribe' },
      { httpStatus: 500, bodyText: 'boom', provider: null, stage: 'transcribe' },
    ];
    for (const fixture of fixtures) {
      const result = classifyTranscriptionError(fixture);
      expect(result.likelyCause.length).toBeGreaterThan(0);
      expect(result.recommendedAction.length).toBeGreaterThan(0);
      expect(Array.isArray(result.retryProviders)).toBe(true);
    }
  });
});
