'use client';

import { GEMINI_TRANSCRIBE_MODELS, getGeminiModelName, type GeminiModelId } from '@/app/lib/aiModels';
import Select from '@/components/Select';
import type { TranscriptionProviderId } from '../lib/providers/types';
import type { TranscriberSettings } from '../lib/settings';

export interface ProviderPickerProps {
  settings: TranscriberSettings;
  /** Shallow-merged into the settings store by the caller (page.tsx owns the single source-of-truth state — see its updateSettings). */
  onChange: (patch: Partial<TranscriberSettings>) => void;
  disabled?: boolean;
}

/* ------------------------------------------------------------ */
/* CONFIGURATION: <select> option values + one-line helper copy  */
/* ------------------------------------------------------------ */

const OPENAI_DIARIZED_VALUE = 'openai-diarized';
const OPENAI_WHISPER_VALUE = 'openai-whisper';
/** Gemini options encode BOTH the provider and the specific transcription model in one <select> value, since choosing "Gemini" always means choosing one of its Flash-family models too. */
const GEMINI_VALUE_PREFIX = 'gemini:';

const PROVIDER_HELPER_TEXT: Record<TranscriptionProviderId, string> = {
  'openai-diarized':
    'OpenAI labels distinct speakers directly from the audio, matched in order to your speaker profiles above — their reference clips are attached automatically when "Use speaker clips" is on.',
  'openai-whisper': 'No built-in speaker labels — the cleanup pass infers who is speaking from context.',
  gemini: 'Speaker names and notes from your speaker profiles are given as context — no acoustic voice-reference support.',
};

const GEMINI_EXPERIMENTAL_REFERENCE_NOTE =
  ' Experimental voice-reference clips are also included as an extra signal for this run — reliability is not guaranteed.';

function providerHelperText(settings: TranscriberSettings): string {
  const base = PROVIDER_HELPER_TEXT[settings.provider];
  if (settings.provider === 'gemini' && settings.geminiReferenceClips) {
    return `${base}${GEMINI_EXPERIMENTAL_REFERENCE_NOTE}`;
  }
  return base;
}

function optionValueFor(settings: TranscriberSettings): string {
  return settings.provider === 'gemini' ? `${GEMINI_VALUE_PREFIX}${settings.geminiTranscribeModel}` : settings.provider;
}

function parseOptionValue(value: string): Partial<TranscriberSettings> {
  if (value.startsWith(GEMINI_VALUE_PREFIX)) {
    return { provider: 'gemini', geminiTranscribeModel: value.slice(GEMINI_VALUE_PREFIX.length) as GeminiModelId };
  }
  return { provider: value === OPENAI_WHISPER_VALUE ? 'openai-whisper' : 'openai-diarized' };
}

/**
 * Inline provider/model selector plus a compact row of run-affecting
 * toggles — all read from and written straight through to the settings
 * store via `onChange` (page.tsx holds the single copy of settings state;
 * see its updateSettings). Rendered inside UploadPanel, above the
 * Transcribe button.
 */
export default function ProviderPicker({ settings, onChange, disabled }: ProviderPickerProps) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="transcriber-provider-picker" className="block text-sm font-medium text-text mb-1">
          Transcription provider
        </label>
        <Select
          id="transcriber-provider-picker"
          value={optionValueFor(settings)}
          disabled={disabled}
          onChange={(e) => onChange(parseOptionValue(e.target.value))}
          className="w-full"
        >
          <option value={OPENAI_DIARIZED_VALUE}>OpenAI — GPT-4o diarized (recommended)</option>
          <option value={OPENAI_WHISPER_VALUE}>OpenAI — Whisper (no speaker labels)</option>
          {GEMINI_TRANSCRIBE_MODELS.map((modelId) => (
            <option key={modelId} value={`${GEMINI_VALUE_PREFIX}${modelId}`}>
              Gemini — {getGeminiModelName(modelId)} (speakers inferred from context)
            </option>
          ))}
        </Select>
        <p className="text-xs text-text-3 mt-1">{providerHelperText(settings)}</p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={settings.autoFallback}
            disabled={disabled}
            onChange={(e) => onChange({ autoFallback: e.target.checked })}
            className="rounded border-border"
          />
          Auto-fallback
        </label>
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={settings.strictCorrection}
            disabled={disabled}
            onChange={(e) => onChange({ strictCorrection: e.target.checked })}
            className="rounded border-border"
          />
          Strict correction
        </label>
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={!settings.cleanupEnabled}
            disabled={disabled}
            onChange={(e) => onChange({ cleanupEnabled: !e.target.checked })}
            className="rounded border-border"
          />
          Skip cleanup
        </label>
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={settings.speakerClipsEnabled}
            disabled={disabled}
            onChange={(e) => onChange({ speakerClipsEnabled: e.target.checked })}
            className="rounded border-border"
          />
          Use speaker clips
        </label>
      </div>
    </div>
  );
}
