import { describe, expect, it } from 'vitest';
import { OPENAI_SPEED_FACTOR_MAX, OPENAI_SPEED_FACTOR_MIN } from '../lib/constants';
import {
  CLEANUP_CHUNK_SECONDS_MAX,
  CLEANUP_CHUNK_SECONDS_MIN,
  CLEANUP_OVERLAP_SECONDS_MAX,
  CLEANUP_OVERLAP_SECONDS_MIN,
  CLEANUP_PARALLEL_CHUNKS_MAX,
  CLEANUP_PARALLEL_CHUNKS_MIN,
  CLEANUP_TEMPERATURE_MAX,
  CLEANUP_TEMPERATURE_MIN,
  DEFAULT_TRANSCRIBER_SETTINGS,
  MERGE_GAP_SECONDS_MAX,
  MERGE_GAP_SECONDS_MIN,
  OPENAI_PARALLEL_CHUNKS_MAX,
  OPENAI_PARALLEL_CHUNKS_MIN,
  parseStoredSettings,
} from '../lib/settings';

describe('parseStoredSettings', () => {
  it('returns the documented defaults for null raw input', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
  });

  it('returns defaults for unparseable garbage', () => {
    expect(parseStoredSettings('not json at all {{{')).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
  });

  it('returns defaults when the parsed value is not a plain object', () => {
    expect(parseStoredSettings('[1,2,3]')).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
    expect(parseStoredSettings('"just a string"')).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
    expect(parseStoredSettings('42')).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
  });

  it('round-trips a full valid settings object unchanged', () => {
    const settings = {
      ...DEFAULT_TRANSCRIBER_SETTINGS,
      provider: 'gemini' as const,
      openaiModel: 'whisper-1' as const,
      geminiTranscribeModel: 'gemini-2.5-flash-lite' as const,
      autoFallback: true,
      fallbackOrder: ['openai-whisper', 'gemini'] as const,
      speakerClipsEnabled: false,
      geminiReferenceClips: true,
      showRawOutput: false,
      showCleanedOutput: false,
      suppressionEnabled: false,
      suppressionSensitivity: 'aggressive' as const,
      mergeTurnsEnabled: false,
      mergeGapSeconds: 5,
      cleanupEnabled: false,
      strictCorrection: true,
      cleanupModel: 'gemini-2.5-pro' as const,
      cleanupTemperature: 0.5,
      cleanupChunkSeconds: 1200,
      cleanupOverlapSeconds: 120,
      argumentTagging: true,
      debugMode: 'always' as const,
      openaiPreprocessing: false,
      openaiSilenceRemoval: false,
      openaiSpeedFactor: 1.35,
      openaiParallelChunks: 2,
      cleanupParallelChunks: 9,
    };
    const serialized = JSON.stringify(settings);
    expect(parseStoredSettings(serialized)).toEqual(settings);
  });

  describe('per-field fallback for invalid values', () => {
    it('falls back an invalid provider enum to the default, keeping other fields', () => {
      const raw = JSON.stringify({ provider: 'not-a-provider', autoFallback: true });
      const result = parseStoredSettings(raw);
      expect(result.provider).toBe(DEFAULT_TRANSCRIBER_SETTINGS.provider);
      expect(result.autoFallback).toBe(true);
    });

    it('falls back an invalid openaiModel id to the default', () => {
      const raw = JSON.stringify({ openaiModel: 'not-a-real-model' });
      expect(parseStoredSettings(raw).openaiModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiModel);
    });

    it('falls back an invalid geminiTranscribeModel id to the default', () => {
      const raw = JSON.stringify({ geminiTranscribeModel: 'not-a-real-model' });
      expect(parseStoredSettings(raw).geminiTranscribeModel).toBe(
        DEFAULT_TRANSCRIBER_SETTINGS.geminiTranscribeModel,
      );
    });

    it('falls back an invalid cleanupModel id to the default', () => {
      const raw = JSON.stringify({ cleanupModel: 'not-a-real-model' });
      expect(parseStoredSettings(raw).cleanupModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel);
    });

    it('falls back an invalid suppressionSensitivity enum to the default', () => {
      const raw = JSON.stringify({ suppressionSensitivity: 'extreme' });
      expect(parseStoredSettings(raw).suppressionSensitivity).toBe(
        DEFAULT_TRANSCRIBER_SETTINGS.suppressionSensitivity,
      );
    });

    it('falls back an invalid debugMode enum to the default', () => {
      const raw = JSON.stringify({ debugMode: 'never' });
      expect(parseStoredSettings(raw).debugMode).toBe(DEFAULT_TRANSCRIBER_SETTINGS.debugMode);
    });

    it('falls back non-boolean values on boolean fields to the default', () => {
      const raw = JSON.stringify({ autoFallback: 'yes', suppressionEnabled: 1, argumentTagging: null });
      const result = parseStoredSettings(raw);
      expect(result.autoFallback).toBe(DEFAULT_TRANSCRIBER_SETTINGS.autoFallback);
      expect(result.suppressionEnabled).toBe(DEFAULT_TRANSCRIBER_SETTINGS.suppressionEnabled);
      expect(result.argumentTagging).toBe(DEFAULT_TRANSCRIBER_SETTINGS.argumentTagging);
    });

    it('defaults openaiPreprocessing/openaiSilenceRemoval/openaiSpeedFactor to true/true/OPENAI_SPEED_FACTOR_DEFAULT when missing', () => {
      const result = parseStoredSettings(JSON.stringify({}));
      expect(result.openaiPreprocessing).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiPreprocessing);
      expect(result.openaiSilenceRemoval).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiSilenceRemoval);
      expect(result.openaiSpeedFactor).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiSpeedFactor);
    });

    it('accepts explicit openaiPreprocessing/openaiSilenceRemoval false values', () => {
      const raw = JSON.stringify({ openaiPreprocessing: false, openaiSilenceRemoval: false });
      const result = parseStoredSettings(raw);
      expect(result.openaiPreprocessing).toBe(false);
      expect(result.openaiSilenceRemoval).toBe(false);
    });

    it('falls back non-boolean values on openaiPreprocessing/openaiSilenceRemoval to the default', () => {
      const raw = JSON.stringify({ openaiPreprocessing: 'nope', openaiSilenceRemoval: 0 });
      const result = parseStoredSettings(raw);
      expect(result.openaiPreprocessing).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiPreprocessing);
      expect(result.openaiSilenceRemoval).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiSilenceRemoval);
    });

    it('falls back a non-numeric openaiSpeedFactor to the default', () => {
      const raw = JSON.stringify({ openaiSpeedFactor: 'fast' });
      expect(parseStoredSettings(raw).openaiSpeedFactor).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiSpeedFactor);
    });

    it('falls back non-numeric values on numeric fields to the default', () => {
      const raw = JSON.stringify({ mergeGapSeconds: 'fast', cleanupTemperature: 'hot' });
      const result = parseStoredSettings(raw);
      expect(result.mergeGapSeconds).toBe(DEFAULT_TRANSCRIBER_SETTINGS.mergeGapSeconds);
      expect(result.cleanupTemperature).toBe(DEFAULT_TRANSCRIBER_SETTINGS.cleanupTemperature);
    });

    it('always forces version to 1 regardless of stored value', () => {
      const raw = JSON.stringify({ ...DEFAULT_TRANSCRIBER_SETTINGS, version: 99 });
      expect(parseStoredSettings(raw).version).toBe(1);
    });

    it('ignores unknown extra keys', () => {
      const raw = JSON.stringify({ ...DEFAULT_TRANSCRIBER_SETTINGS, someFutureField: 'surprise' });
      const result = parseStoredSettings(raw) as unknown as Record<string, unknown>;
      expect(result.someFutureField).toBeUndefined();
      expect(result).toEqual(DEFAULT_TRANSCRIBER_SETTINGS);
    });
  });

  describe('numeric clamping', () => {
    it('clamps mergeGapSeconds at the lower bound', () => {
      expect(parseStoredSettings(JSON.stringify({ mergeGapSeconds: 0 })).mergeGapSeconds).toBe(
        MERGE_GAP_SECONDS_MIN,
      );
    });

    it('clamps mergeGapSeconds at the upper bound', () => {
      expect(parseStoredSettings(JSON.stringify({ mergeGapSeconds: 999 })).mergeGapSeconds).toBe(
        MERGE_GAP_SECONDS_MAX,
      );
    });

    it('clamps cleanupChunkSeconds at both bounds', () => {
      expect(
        parseStoredSettings(JSON.stringify({ cleanupChunkSeconds: 1 })).cleanupChunkSeconds,
      ).toBe(CLEANUP_CHUNK_SECONDS_MIN);
      expect(
        parseStoredSettings(JSON.stringify({ cleanupChunkSeconds: 999999 })).cleanupChunkSeconds,
      ).toBe(CLEANUP_CHUNK_SECONDS_MAX);
    });

    it('clamps cleanupOverlapSeconds at both bounds', () => {
      expect(
        parseStoredSettings(JSON.stringify({ cleanupOverlapSeconds: -50 })).cleanupOverlapSeconds,
      ).toBe(CLEANUP_OVERLAP_SECONDS_MIN);
      expect(
        parseStoredSettings(JSON.stringify({ cleanupOverlapSeconds: 999999 })).cleanupOverlapSeconds,
      ).toBe(CLEANUP_OVERLAP_SECONDS_MAX);
    });

    it('clamps cleanupTemperature at both bounds', () => {
      expect(parseStoredSettings(JSON.stringify({ cleanupTemperature: -1 })).cleanupTemperature).toBe(
        CLEANUP_TEMPERATURE_MIN,
      );
      expect(parseStoredSettings(JSON.stringify({ cleanupTemperature: 5 })).cleanupTemperature).toBe(
        CLEANUP_TEMPERATURE_MAX,
      );
    });

    it('accepts an in-range numeric value unchanged', () => {
      expect(parseStoredSettings(JSON.stringify({ mergeGapSeconds: 3 })).mergeGapSeconds).toBe(3);
    });

    it('clamps openaiSpeedFactor at both bounds', () => {
      expect(parseStoredSettings(JSON.stringify({ openaiSpeedFactor: 0 })).openaiSpeedFactor).toBe(
        OPENAI_SPEED_FACTOR_MIN,
      );
      expect(parseStoredSettings(JSON.stringify({ openaiSpeedFactor: 99 })).openaiSpeedFactor).toBe(
        OPENAI_SPEED_FACTOR_MAX,
      );
    });

    it('accepts an in-range openaiSpeedFactor unchanged', () => {
      expect(parseStoredSettings(JSON.stringify({ openaiSpeedFactor: 1.3 })).openaiSpeedFactor).toBe(1.3);
    });

    it('clamps openaiParallelChunks at both bounds', () => {
      expect(parseStoredSettings(JSON.stringify({ openaiParallelChunks: 0 })).openaiParallelChunks).toBe(
        OPENAI_PARALLEL_CHUNKS_MIN,
      );
      expect(parseStoredSettings(JSON.stringify({ openaiParallelChunks: 99 })).openaiParallelChunks).toBe(
        OPENAI_PARALLEL_CHUNKS_MAX,
      );
    });

    it('clamps cleanupParallelChunks at both bounds', () => {
      expect(parseStoredSettings(JSON.stringify({ cleanupParallelChunks: -3 })).cleanupParallelChunks).toBe(
        CLEANUP_PARALLEL_CHUNKS_MIN,
      );
      expect(parseStoredSettings(JSON.stringify({ cleanupParallelChunks: 500 })).cleanupParallelChunks).toBe(
        CLEANUP_PARALLEL_CHUNKS_MAX,
      );
    });

    it('rounds fractional parallel-request counts to whole numbers', () => {
      expect(parseStoredSettings(JSON.stringify({ openaiParallelChunks: 3.6 })).openaiParallelChunks).toBe(4);
      expect(parseStoredSettings(JSON.stringify({ cleanupParallelChunks: 5.2 })).cleanupParallelChunks).toBe(5);
    });

    it('falls back non-numeric parallel-request counts to the defaults', () => {
      expect(parseStoredSettings(JSON.stringify({ openaiParallelChunks: 'many' })).openaiParallelChunks).toBe(
        DEFAULT_TRANSCRIBER_SETTINGS.openaiParallelChunks,
      );
      expect(parseStoredSettings(JSON.stringify({ cleanupParallelChunks: null })).cleanupParallelChunks).toBe(
        DEFAULT_TRANSCRIBER_SETTINGS.cleanupParallelChunks,
      );
    });
  });

  describe('legacy migration', () => {
    it('seeds openaiModel and cleanupModel from legacy keys when raw is null', () => {
      const result = parseStoredSettings(null, {
        transcribeModel: 'whisper-1',
        correctionModel: 'gemini-2.5-pro',
      });
      expect(result.openaiModel).toBe('whisper-1');
      expect(result.cleanupModel).toBe('gemini-2.5-pro');
      // Everything else still comes from the documented defaults.
      expect(result.provider).toBe(DEFAULT_TRANSCRIBER_SETTINGS.provider);
    });

    it('seeds from legacy keys when raw is unparseable', () => {
      const result = parseStoredSettings('{{{not json', {
        transcribeModel: 'whisper-1',
        correctionModel: 'gemini-2.5-pro',
      });
      expect(result.openaiModel).toBe('whisper-1');
      expect(result.cleanupModel).toBe('gemini-2.5-pro');
    });

    it('falls back to defaults when legacy values are invalid', () => {
      const result = parseStoredSettings(null, { transcribeModel: 'bogus', correctionModel: 'bogus' });
      expect(result.openaiModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiModel);
      expect(result.cleanupModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel);
    });

    it('falls back to defaults when no legacy values are supplied', () => {
      const result = parseStoredSettings(null);
      expect(result.openaiModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiModel);
      expect(result.cleanupModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel);
    });

    it('does not apply legacy seeding when a (partial) v1 object already exists', () => {
      // A v1 object is present (even if incomplete) — legacy keys should be
      // ignored since migration is a one-time, no-v1-object-yet path only.
      const result = parseStoredSettings(JSON.stringify({ autoFallback: true }), {
        transcribeModel: 'whisper-1',
        correctionModel: 'gemini-2.5-pro',
      });
      expect(result.openaiModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.openaiModel);
      expect(result.cleanupModel).toBe(DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel);
    });
  });

  describe('fallbackOrder validation', () => {
    it('keeps a fully valid fallbackOrder as-is', () => {
      const raw = JSON.stringify({ fallbackOrder: ['openai-whisper', 'gemini'] });
      expect(parseStoredSettings(raw).fallbackOrder).toEqual(['openai-whisper', 'gemini']);
    });

    it('drops invalid entries but keeps the valid ones', () => {
      const raw = JSON.stringify({ fallbackOrder: ['gemini', 'not-a-provider', 'openai-diarized'] });
      expect(parseStoredSettings(raw).fallbackOrder).toEqual(['gemini', 'openai-diarized']);
    });

    it('falls back to the default order when every entry is invalid', () => {
      const raw = JSON.stringify({ fallbackOrder: ['bogus', 42, null] });
      expect(parseStoredSettings(raw).fallbackOrder).toEqual(DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder);
    });

    it('falls back to the default order when the array is empty', () => {
      const raw = JSON.stringify({ fallbackOrder: [] });
      expect(parseStoredSettings(raw).fallbackOrder).toEqual(DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder);
    });

    it('falls back to the default order when fallbackOrder is not an array', () => {
      const raw = JSON.stringify({ fallbackOrder: 'gemini' });
      expect(parseStoredSettings(raw).fallbackOrder).toEqual(DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder);
    });
  });
});
