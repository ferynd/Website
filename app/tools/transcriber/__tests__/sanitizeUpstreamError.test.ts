import { describe, expect, it } from 'vitest';
import { sanitizeUpstreamError } from '../lib/sanitizeUpstreamError';

describe('sanitizeUpstreamError', () => {
  it('redacts OpenAI-style sk- keys', () => {
    const result = sanitizeUpstreamError('Invalid API key: sk-abcdefghijklmnopqrstuvwxyz');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('sk-***');
  });

  it('redacts Google/Gemini-style AIza keys', () => {
    const result = sanitizeUpstreamError('Request failed for key AIzaSyD1234567890abcdefghijklmno');
    expect(result).not.toContain('SyD1234567890abcdefghijklmno');
    expect(result).toContain('AIza***');
  });

  it('redacts key= query-param values without dropping the rest of the URL', () => {
    const result = sanitizeUpstreamError(
      'Fetch failed: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSyD1234567890abcdefghijklmno',
    );
    expect(result).not.toContain('AIzaSyD1234567890abcdefghijklmno');
    expect(result).toContain('generateContent?key=***');
  });

  it('truncates to 500 characters', () => {
    const long = 'x'.repeat(2000);
    const result = sanitizeUpstreamError(long);
    expect(result.length).toBe(500);
  });

  it('returns an empty string for non-string input', () => {
    expect(sanitizeUpstreamError(null)).toBe('');
    expect(sanitizeUpstreamError(undefined)).toBe('');
    expect(sanitizeUpstreamError(42)).toBe('');
  });

  it('returns an empty string for an empty string', () => {
    expect(sanitizeUpstreamError('')).toBe('');
  });

  it('leaves ordinary error text untouched (aside from truncation)', () => {
    expect(sanitizeUpstreamError('The file could not be decoded.')).toBe('The file could not be decoded.');
  });
});
