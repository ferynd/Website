'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { AVAILABLE_GEMINI_MODELS, GEMINI_TRANSCRIBE_MODELS, geminiModelOptionLabel, getGeminiModelName } from '@/app/lib/aiModels';
import { AVAILABLE_TRANSCRIBE_MODELS } from '@/app/lib/transcribeModels';
import Button from '@/components/Button';
import { ADMIN_EMAIL } from '../../trip-cost/firebaseConfig';
import type { TranscriptionProviderId } from '../lib/providers/types';
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
  readTranscriberSettings,
  saveTranscriberSettings,
  type TranscriberSettings,
} from '../lib/settings';

/* ------------------------------------------------------------ */
/* CONFIGURATION: provider labels + section copy                 */
/* ------------------------------------------------------------ */

const PROVIDER_LABELS: Record<TranscriptionProviderId, string> = {
  'openai-diarized': 'OpenAI — GPT-4o diarized',
  'openai-whisper': 'OpenAI — Whisper',
  gemini: 'Gemini',
};

/** Small presentational building blocks shared by every section below — kept
 * local to this file since they're only ever used here. */

function Field({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
        {label}
      </label>
      {description && <p className="text-xs text-text-3">{description}</p>}
      {children}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-border"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-text">{label}</span>
        {description && <span className="block text-xs text-text-3">{description}</span>}
      </span>
    </label>
  );
}

/** Collapsible, one-line-triggered detail note — matches the read-aloud
 * script disclosure pattern in SpeakerProfilesPanel.tsx (useState + chevron). */
function DetailNote({ label = 'More detail', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-surface-2 focus-ring text-xs font-medium"
      >
        {label}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="p-3 text-xs text-text-3 space-y-1">{children}</div>}
    </div>
  );
}

/** Collapsible top-level section — same disclosure pattern, larger trigger. */
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-surface-2 focus-ring"
      >
        <span className="text-sm font-semibold">{title}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

const SELECT_CLASSES =
  'w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]';
const NUMBER_INPUT_CLASSES =
  'w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]';

/**
 * Number field with local (uncontrolled-feeling) text state so typing an
 * intermediate value (e.g. clearing the box to retype) doesn't get clamped
 * mid-keystroke — clamping happens on blur via the real settings commit
 * (parseStoredSettings, the single source of truth for valid ranges), same
 * as every other control in this modal.
 */
function NumberField({
  label,
  description,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    onCommit(Number.isFinite(parsed) ? parsed : value);
  };

  return (
    <Field label={label} description={description}>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step ?? 1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className={NUMBER_INPUT_CLASSES}
      />
      <p className="text-xs text-text-3">
        Clamped to {min}–{max} on save.
      </p>
    </Field>
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  // Lazy init avoids a flash of the hard-coded defaults before the effect
  // below runs, while still staying SSR-safe (readTranscriberSettings()
  // returns defaults when window is undefined).
  const [settings, setSettings] = useState<TranscriberSettings>(() => DEFAULT_TRANSCRIBER_SETTINGS);

  useEffect(() => {
    setSettings(readTranscriberSettings());
  }, []);

  // Every change funnels through parseStoredSettings — a JSON round-trip of
  // the merged object — so every field (numbers included) gets exactly the
  // same clamping/validation as a freshly-loaded settings object. This is
  // "the existing parse" the numeric inputs above clamp through on commit;
  // it never writes an invalid value to the store.
  function updateSettings(patch: Partial<TranscriberSettings>) {
    setSettings((prev) => {
      const merged = { ...prev, ...patch };
      const next = parseStoredSettings(JSON.stringify(merged));
      saveTranscriberSettings(next);
      return next;
    });
  }

  function handleResetToDefaults() {
    // Writes DEFAULT_TRANSCRIBER_SETTINGS only — speaker profile metadata
    // lives in a separate localStorage key (transcriber_speaker_profiles_v1)
    // and is never touched here.
    const defaults = { ...DEFAULT_TRANSCRIBER_SETTINGS, fallbackOrder: [...DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder] };
    setSettings(defaults);
    saveTranscriberSettings(defaults);
  }

  function swapFallbackOrder() {
    if (settings.fallbackOrder.length < 2) return;
    const next = [...settings.fallbackOrder];
    [next[0], next[1]] = [next[1], next[0]];
    updateSettings({ fallbackOrder: next });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-surface-1 p-6 space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Transcriber settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text focus-ring rounded p-1 flex-shrink-0"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-1">
          <h3 className="text-sm font-semibold">Access</h3>
          <p className="text-xs text-text-3">
            This tool is restricted to the site owner&apos;s account ({ADMIN_EMAIL}). That&apos;s enforced both in
            this UI and on every API request, independently of every setting below.
          </p>
        </div>

        <p className="text-xs text-text-3">
          Every setting below is saved to this browser only, and takes effect on the next run — nothing here is sent
          anywhere until you transcribe.
        </p>

        <div className="space-y-3">
          <Section title="Provider & fallback">
            <Field label="Transcription provider" htmlFor="settings-provider" description="Which provider a new run starts with — also changeable per-run from the upload panel.">
              <select
                id="settings-provider"
                value={settings.provider}
                onChange={(e) => updateSettings({ provider: e.target.value as TranscriptionProviderId })}
                className={SELECT_CLASSES}
              >
                {(Object.keys(PROVIDER_LABELS) as TranscriptionProviderId[]).map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="OpenAI model" htmlFor="settings-openai-model" description="Used whenever the provider above (or the fallback order below) is an OpenAI option.">
              <select
                id="settings-openai-model"
                value={settings.openaiModel}
                onChange={(e) => updateSettings({ openaiModel: e.target.value as TranscriberSettings['openaiModel'] })}
                className={SELECT_CLASSES}
              >
                {AVAILABLE_TRANSCRIBE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} — {model.cost}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Gemini transcription model" htmlFor="settings-gemini-transcribe-model" description="Used whenever the provider above (or the fallback order below) is Gemini.">
              <select
                id="settings-gemini-transcribe-model"
                value={settings.geminiTranscribeModel}
                onChange={(e) => updateSettings({ geminiTranscribeModel: e.target.value as TranscriberSettings['geminiTranscribeModel'] })}
                className={SELECT_CLASSES}
              >
                {GEMINI_TRANSCRIBE_MODELS.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {getGeminiModelName(modelId)}
                  </option>
                ))}
              </select>
            </Field>

            <ToggleField
              label="Auto-fallback"
              description="When the starting provider fails, automatically retry once with the next provider in the fallback order below, instead of stopping at the recovery panel."
              checked={settings.autoFallback}
              onChange={(checked) => updateSettings({ autoFallback: checked })}
            />

            <Field label="Fallback order" description="When auto-fallback is on, the pipeline tries these providers in order after the starting provider fails.">
              <ol className="space-y-1 text-sm text-text-2">
                {settings.fallbackOrder.map((id, i) => (
                  <li key={`${id}-${i}`} className="flex items-center gap-2">
                    <span className="w-4 text-text-3">{i + 1}.</span>
                    {PROVIDER_LABELS[id]}
                  </li>
                ))}
              </ol>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={settings.fallbackOrder.length < 2}
                onClick={swapFallbackOrder}
                className="inline-flex items-center gap-2"
              >
                <ArrowLeftRight size={14} />
                Swap order
              </Button>
            </Field>
          </Section>

          <Section title="Speaker clips">
            <ToggleField
              label="Use speaker clips (OpenAI)"
              description="Attach each speaker profile's voice reference clip to OpenAI diarized runs as a known-speaker reference."
              checked={settings.speakerClipsEnabled}
              onChange={(checked) => updateSettings({ speakerClipsEnabled: checked })}
            />
            <ToggleField
              label="Gemini reference clips (experimental)"
              description="Also attach reference clips to Gemini runs as an extra signal. Gemini has no built-in acoustic speaker-reference support — this is prompt-based and unproven, so it's off by default."
              checked={settings.geminiReferenceClips}
              onChange={(checked) => updateSettings({ geminiReferenceClips: checked })}
            />
          </Section>

          <Section title="OpenAI long recordings">
            <ToggleField
              label="Auto-optimize & chunk long recordings"
              description="When an OpenAI run's recording is long or large enough to risk gpt-4o-transcribe-diarize's duration cap or OpenAI's 25 MB upload limit, remove long silences, optionally speed up, and split it into chunks client-side, then stitch the results back together with timestamps remapped to the original recording. Off falls back to a single plain upload (may fail on long/large files)."
              checked={settings.openaiPreprocessing}
              onChange={(checked) => updateSettings({ openaiPreprocessing: checked })}
            />
            <ToggleField
              label="Remove long silences"
              description="Trims long stretches of silence out of the recording before chunking, shrinking both duration and upload size. Only applies when auto-optimize is on."
              checked={settings.openaiSilenceRemoval}
              disabled={!settings.openaiPreprocessing}
              onChange={(checked) => updateSettings({ openaiSilenceRemoval: checked })}
            />
            <NumberField
              label="Speed-up factor"
              description="Speeds up the whole recording before chunking, shrinking both duration and upload size further — but raises the pitch slightly. Set to 1.0 if transcription accuracy suffers."
              value={settings.openaiSpeedFactor}
              min={OPENAI_SPEED_FACTOR_MIN}
              max={OPENAI_SPEED_FACTOR_MAX}
              step={0.05}
              disabled={!settings.openaiPreprocessing}
              onCommit={(value) => updateSettings({ openaiSpeedFactor: value })}
            />
            <NumberField
              label="Parallel chunk uploads"
              description="How many chunks transcribe at once (1 = one at a time). Each in-flight chunk is a ~20 MB upload sharing your connection, so past ~4 the extra parallelism mostly just splits the same bandwidth; lower it if runs start hitting OpenAI rate limits."
              value={settings.openaiParallelChunks}
              min={OPENAI_PARALLEL_CHUNKS_MIN}
              max={OPENAI_PARALLEL_CHUNKS_MAX}
              step={1}
              disabled={!settings.openaiPreprocessing}
              onCommit={(value) => updateSettings({ openaiParallelChunks: value })}
            />
          </Section>

          <Section title="Outputs">
            <ToggleField
              label="Show raw output"
              description="Visibility default only — the raw transcript is always captured for every successful run regardless of this setting."
              checked={settings.showRawOutput}
              onChange={(checked) => updateSettings({ showRawOutput: checked })}
            />
            <ToggleField
              label="Show cleaned output"
              description="Visibility default only — controls whether the cleaned section starts expanded when a run has one."
              checked={settings.showCleanedOutput}
              onChange={(checked) => updateSettings({ showCleanedOutput: checked })}
            />
          </Section>

          <Section title="Artifact suppression">
            <ToggleField
              label="Suppress hallucinated filler"
              description="Remove clusters of repeated short phrases (e.g. a hallucinated “Thank you.” across a long silence) from the cleaned transcript only — the raw transcript always keeps everything."
              checked={settings.suppressionEnabled}
              onChange={(checked) => updateSettings({ suppressionEnabled: checked })}
            />
            <Field label="Sensitivity" htmlFor="settings-suppression-sensitivity" description="Aggressive removes a phrase with fewer repeats/looser spacing than conservative.">
              <select
                id="settings-suppression-sensitivity"
                value={settings.suppressionSensitivity}
                disabled={!settings.suppressionEnabled}
                onChange={(e) => updateSettings({ suppressionSensitivity: e.target.value as TranscriberSettings['suppressionSensitivity'] })}
                className={SELECT_CLASSES}
              >
                <option value="conservative">Conservative (default)</option>
                <option value="aggressive">Aggressive</option>
              </select>
              <DetailNote>
                A group of short (&lt;4-word), near-identical segments is only ever removed when it repeats enough
                times, spans enough time, and repeats regularly enough that it looks mechanical rather than
                conversational — protecting genuine short replies like scattered &quot;yeah&quot;s.
              </DetailNote>
            </Field>
          </Section>

          <Section title="Turn merging">
            <ToggleField
              label="Merge speaker turns"
              description="Combine consecutive same-speaker segments into one block in the cleaned transcript, instead of one line per raw segment."
              checked={settings.mergeTurnsEnabled}
              onChange={(checked) => updateSettings({ mergeTurnsEnabled: checked })}
            />
            <NumberField
              label="Merge gap (seconds)"
              description="Maximum pause between two same-speaker segments that still merges them into one turn."
              value={settings.mergeGapSeconds}
              min={MERGE_GAP_SECONDS_MIN}
              max={MERGE_GAP_SECONDS_MAX}
              step={0.5}
              disabled={!settings.mergeTurnsEnabled}
              onCommit={(value) => updateSettings({ mergeGapSeconds: value })}
            />
          </Section>

          <Section title="Cleanup">
            <ToggleField
              label="Run cleanup pass"
              description="Send the transcript through the Gemini correction pass. Turning this off returns the raw transcript with a ready-to-paste manual cleanup prompt instead."
              checked={settings.cleanupEnabled}
              onChange={(checked) => updateSettings({ cleanupEnabled: checked })}
            />
            <ToggleField
              label="Strict correction"
              description="Abort the whole cleanup pass on the first chunk failure, instead of falling back to uncorrected text for just that chunk."
              checked={settings.strictCorrection}
              disabled={!settings.cleanupEnabled}
              onChange={(checked) => updateSettings({ strictCorrection: checked })}
            />
            <Field label="Cleanup model" htmlFor="settings-cleanup-model" description="Gemini model used for the correction/cleanup pass.">
              <select
                id="settings-cleanup-model"
                value={settings.cleanupModel}
                disabled={!settings.cleanupEnabled}
                onChange={(e) => updateSettings({ cleanupModel: e.target.value as TranscriberSettings['cleanupModel'] })}
                className={SELECT_CLASSES}
              >
                {AVAILABLE_GEMINI_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {geminiModelOptionLabel(model)}
                  </option>
                ))}
              </select>
            </Field>
            <NumberField
              label="Temperature"
              description="Low is near-deterministic — this is a precision correction task, not a creative one."
              value={settings.cleanupTemperature}
              min={CLEANUP_TEMPERATURE_MIN}
              max={CLEANUP_TEMPERATURE_MAX}
              step={0.05}
              disabled={!settings.cleanupEnabled}
              onCommit={(value) => updateSettings({ cleanupTemperature: value })}
            />
            <NumberField
              label="Chunk size (seconds)"
              description="The cleanup pass never sees the whole recording at once — it runs in chunks this long. Put anything a chunk needs but might not see (e.g. a speaker's name mentioned only once) in the upload panel's context notes instead."
              value={settings.cleanupChunkSeconds}
              min={CLEANUP_CHUNK_SECONDS_MIN}
              max={CLEANUP_CHUNK_SECONDS_MAX}
              step={60}
              disabled={!settings.cleanupEnabled}
              onCommit={(value) => updateSettings({ cleanupChunkSeconds: value })}
            />
            <NumberField
              label="Chunk overlap (seconds)"
              description="Extra context on each side of a chunk boundary, so speaker continuity carries over between chunks."
              value={settings.cleanupOverlapSeconds}
              min={CLEANUP_OVERLAP_SECONDS_MIN}
              max={CLEANUP_OVERLAP_SECONDS_MAX}
              step={15}
              disabled={!settings.cleanupEnabled}
              onCommit={(value) => updateSettings({ cleanupOverlapSeconds: value })}
            />
            <NumberField
              label="Parallel chunk requests"
              description="How many cleanup chunks are corrected at once (1 = one at a time). The default assumes a paid-tier Gemini key; lower it if chunks start failing with rate-limit (429) errors."
              value={settings.cleanupParallelChunks}
              min={CLEANUP_PARALLEL_CHUNKS_MIN}
              max={CLEANUP_PARALLEL_CHUNKS_MAX}
              step={1}
              disabled={!settings.cleanupEnabled}
              onCommit={(value) => updateSettings({ cleanupParallelChunks: value })}
            />
          </Section>

          <Section title="Argument tagging" defaultOpen={false}>
            <ToggleField
              label="Tag turns during cleanup"
              description="Tags each turn during cleanup — no extra AI pass; enables the argument-relevant export (a filtered transcript of just the conflict/repair/support turns, plus short lead-up context) on the transcript output."
              checked={settings.argumentTagging}
              disabled={!settings.cleanupEnabled}
              onChange={(checked) => updateSettings({ argumentTagging: checked })}
            />
          </Section>

          <Section title="Debug" defaultOpen={false}>
            <Field label="Debug JSON" htmlFor="settings-debug-mode" description="Debug JSON never contains transcript text, audio, or keys — only counts, labels, and sanitized diagnostic strings.">
              <select
                id="settings-debug-mode"
                value={settings.debugMode}
                onChange={(e) => updateSettings({ debugMode: e.target.value as TranscriberSettings['debugMode'] })}
                className={SELECT_CLASSES}
              >
                <option value="on-failure">On failure only (default)</option>
                <option value="always">Always</option>
              </select>
            </Field>
          </Section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetToDefaults}
            className="inline-flex items-center gap-2"
          >
            <RotateCcw size={14} />
            Reset to recommended defaults
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
