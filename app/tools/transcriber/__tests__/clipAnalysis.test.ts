import { describe, expect, it } from 'vitest';
import { computeClipValidation, encodeWavPcm16, selectBestWindow } from '../lib/clipAnalysis';

function silence(sampleRate: number, seconds: number): Float32Array {
  return new Float32Array(Math.round(sampleRate * seconds));
}

function sineBurst(sampleRate: number, seconds: number, amplitude = 0.8, freq = 440): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function concat(...arrays: Float32Array[]): Float32Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

describe('selectBestWindow', () => {
  const sampleRate = 16000;

  it('recovers a loud burst located in the middle of a long silent clip', () => {
    const before = silence(sampleRate, 5);
    const burst = sineBurst(sampleRate, 8, 0.9);
    const after = silence(sampleRate, 5);
    const samples = concat(before, burst, after);

    const result = selectBestWindow(samples, sampleRate, 8, 0.25);

    expect(result.startSample).toBe(before.length);
    expect(result.endSample - result.startSample).toBe(8 * sampleRate);
    expect(result.meanRmsDb).toBeGreaterThan(-10);
  });

  it('recovers a burst located at the very end of the clip', () => {
    const before = silence(sampleRate, 6);
    const burst = sineBurst(sampleRate, 8, 0.9);
    const samples = concat(before, burst);

    const result = selectBestWindow(samples, sampleRate, 8, 0.25);
    expect(result.endSample).toBe(samples.length);
    expect(result.startSample).toBe(before.length);
  });

  it('returns the whole clip when shorter than the target window', () => {
    const samples = sineBurst(sampleRate, 3, 0.5);
    const result = selectBestWindow(samples, sampleRate, 8, 0.25);
    expect(result.startSample).toBe(0);
    expect(result.endSample).toBe(samples.length);
  });

  it('returns the whole clip when exactly the target window length', () => {
    const samples = sineBurst(sampleRate, 8, 0.5);
    const result = selectBestWindow(samples, sampleRate, 8, 0.25);
    expect(result.startSample).toBe(0);
    expect(result.endSample).toBe(samples.length);
  });

  it('reports a very negative (but finite) dB for total silence', () => {
    const samples = silence(sampleRate, 3);
    const result = selectBestWindow(samples, sampleRate, 8, 0.25);
    expect(Number.isFinite(result.meanRmsDb)).toBe(true);
    expect(result.meanRmsDb).toBeLessThan(-60);
  });

  it('handles an empty samples array without throwing', () => {
    const result = selectBestWindow(new Float32Array(0), sampleRate, 8, 0.25);
    expect(result.startSample).toBe(0);
    expect(result.endSample).toBe(0);
    expect(Number.isFinite(result.meanRmsDb)).toBe(true);
  });
});

describe('computeClipValidation', () => {
  it('flags a clip under 2 seconds as too-short', () => {
    expect(computeClipValidation({ durationSec: 1.9, meanRmsDb: -10 })).toBe('too-short');
  });

  it('does not flag exactly 2 seconds as too-short', () => {
    expect(computeClipValidation({ durationSec: 2, meanRmsDb: -10 })).toBe('ok');
  });

  it('flags a clip quieter than -40 dBFS as too-quiet', () => {
    expect(computeClipValidation({ durationSec: 5, meanRmsDb: -41 })).toBe('too-quiet');
  });

  it('does not flag exactly -40 dBFS as too-quiet', () => {
    expect(computeClipValidation({ durationSec: 5, meanRmsDb: -40 })).toBe('ok');
  });

  it('flags a clip longer than 10 seconds (pre-trim) as trimmed', () => {
    expect(computeClipValidation({ durationSec: 10.1, meanRmsDb: -10 })).toBe('trimmed');
  });

  it('does not flag exactly 10 seconds as trimmed', () => {
    expect(computeClipValidation({ durationSec: 10, meanRmsDb: -10 })).toBe('ok');
  });

  it('prioritizes too-short over too-quiet/trimmed when multiple thresholds are crossed', () => {
    expect(computeClipValidation({ durationSec: 1, meanRmsDb: -100 })).toBe('too-short');
  });

  it('prioritizes too-quiet over trimmed when both apply', () => {
    expect(computeClipValidation({ durationSec: 15, meanRmsDb: -50 })).toBe('too-quiet');
  });
});

describe('encodeWavPcm16', () => {
  it('writes a valid RIFF/WAVE header with the expected chunk sizes', () => {
    const sampleRate = 16000;
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWavPcm16(samples, sampleRate);
    const view = new DataView(buffer);
    const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buffer, offset, length));

    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM format
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * 2); // byte rate = sampleRate * blockAlign(2)
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
  });

  it('quantizes sample values correctly, including clamping out-of-range values', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const buffer = encodeWavPcm16(samples, 16000);
    const view = new DataView(buffer);

    expect(view.getInt16(44 + 0 * 2, true)).toBe(0);
    expect(view.getInt16(44 + 1 * 2, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(view.getInt16(44 + 2 * 2, true)).toBe(Math.round(-0.5 * 0x8000));
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
    // Values outside [-1, 1] are clamped before quantizing.
    expect(view.getInt16(44 + 5 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 6 * 2, true)).toBe(-0x8000);
  });

  it('produces an empty data chunk for an empty samples array', () => {
    const buffer = encodeWavPcm16(new Float32Array(0), 16000);
    expect(buffer.byteLength).toBe(44);
    const view = new DataView(buffer);
    expect(view.getUint32(40, true)).toBe(0);
  });
});
