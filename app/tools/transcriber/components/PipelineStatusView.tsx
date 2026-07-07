'use client';

import { Check, Loader2 } from 'lucide-react';
import type { TranscriberState } from '../useTranscriberPipeline';
import type { PipelineStatus } from '../lib/types';

interface StepDef {
  key: PipelineStatus;
  label: string;
}

/* ------------------------------------------------------------ */
/* CONFIGURATION: per-provider step sequences                    */
/* ------------------------------------------------------------ */

/** The OpenAI path also enters 'processing' — but only for a long/large
 * recording that goes through client-side preprocessing/chunking (silence
 * removal, optional speed-up) — and unlike Gemini's Files-API activation,
 * that happens BEFORE any upload (see lib/preprocessOpenAiAudio.ts /
 * lib/providers/openaiProvider.ts's onPreparing), hence 'processing'
 * preceding 'uploading' here. A plain small-file run never enters it, so
 * it's just marked done-by-sequence once the run reaches 'uploading', same
 * as every other step here (this list is sequence-based, not
 * event-verified). */
const OPENAI_STEP_KEYS: PipelineStatus[] = [
  'validating',
  'processing',
  'uploading',
  'transcribing',
  'correcting',
  'building',
  'complete',
];
/** Gemini direct transcription has an extra 'processing' step (Files API
 * upload activation) between uploading and the transcription call(s) that
 * the OpenAI path never enters — see lib/providers/geminiProvider.ts. */
const GEMINI_STEP_KEYS: PipelineStatus[] = [
  'validating',
  'uploading',
  'processing',
  'transcribing',
  'correcting',
  'building',
  'complete',
];

const STEP_LABELS: Record<PipelineStatus, string> = {
  idle: 'Idle',
  validating: 'Validating file',
  uploading: 'Uploading',
  processing: 'Processing',
  transcribing: 'Transcribing',
  correcting: 'Cleaning up transcript',
  building: 'Building final transcript',
  complete: 'Complete',
  failed: 'Failed',
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function PipelineStatusView({ state }: { state: TranscriberState }) {
  // currentProvider reflects the provider being attempted right now (set
  // before mode is known); mode reflects the last SUCCESSFUL attempt — using
  // both keeps the gemini-specific step sequence correct both mid-run and
  // once complete.
  const isGemini = state.currentProvider === 'gemini' || state.mode === 'gemini';
  const stepKeys = isGemini ? GEMINI_STEP_KEYS : OPENAI_STEP_KEYS;
  const currentIndex = stepKeys.findIndex((key) => key === state.status);

  const steps: StepDef[] = stepKeys.map((key) => {
    if (key === 'correcting' && state.cleanupSkipped) {
      return { key, label: 'Cleanup pass (skipped by request)' };
    }
    // OpenAI's 'processing' step is client-side audio preprocessing
    // (silence removal / speed-up), not Gemini's Files API activation —
    // distinct label for the same status key.
    if (key === 'processing' && !isGemini) {
      return { key, label: 'Optimizing audio…' };
    }
    // Fold the chunk-loop progress directly into the "Transcribing" step
    // label — "Transcribing window i of N" for Gemini's per-window calls,
    // "Transcribing chunk i of N" for OpenAI's preprocessed chunks — rather
    // than a separate line.
    if (key === 'transcribing' && key === state.status && state.chunkProgress) {
      const unit = isGemini ? 'window' : 'chunk';
      return { key, label: `Transcribing ${unit} ${state.chunkProgress.current} of ${state.chunkProgress.total}` };
    }
    return { key, label: STEP_LABELS[key] };
  });

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Progress</h2>
        <span className="text-sm text-text-2 whitespace-nowrap">Elapsed: {formatElapsed(state.elapsedMs)}</span>
      </div>

      {state.status === 'failed' ? (
        // The ErrorRecoveryPanel (rendered by the page when state.recovery is
        // set) replaces this bare line with a full diagnostics table and
        // retry actions. Every failure path in useTranscriberPipeline.ts sets
        // `recovery`, so this fallback line is only ever a last resort.
        !state.recovery && <p className="text-error text-sm">{state.error}</p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step, i) => {
            const done = currentIndex > i || state.status === 'complete';
            const active = step.key === state.status;
            return (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                {done ? (
                  <Check size={16} className="text-success flex-shrink-0" />
                ) : active ? (
                  <Loader2 size={16} className="animate-spin text-accent flex-shrink-0" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border flex-shrink-0" />
                )}
                <span className={active ? 'text-text font-medium' : 'text-text-2'}>{step.label}</span>
              </li>
            );
          })}
        </ul>
      )}

      {state.status === 'uploading' && state.uploadProgress !== null && (
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-200"
            style={{ width: `${Math.round((state.uploadProgress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      {state.status === 'correcting' && state.chunkProgress && (
        <p className="text-sm text-text-2">
          Chunk {state.chunkProgress.current} of {state.chunkProgress.total}
        </p>
      )}

      {state.mode === 'fallback' && state.status !== 'failed' && (
        <p className="text-sm text-warning">
          {state.primaryError ?? 'Using Whisper (no speaker diarization) — selected in Settings.'}
        </p>
      )}
    </div>
  );
}
