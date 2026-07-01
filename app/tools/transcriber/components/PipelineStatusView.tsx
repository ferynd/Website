'use client';

import { Check, Loader2 } from 'lucide-react';
import type { TranscriberState } from '../useTranscriberPipeline';
import type { PipelineStatus } from '../lib/types';

const STEPS: { key: PipelineStatus; label: string }[] = [
  { key: 'validating', label: 'Validating file' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'transcribing', label: 'Transcribing' },
  { key: 'correcting', label: 'Correcting speaker labels' },
  { key: 'building', label: 'Building final transcript' },
  { key: 'complete', label: 'Complete' },
];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function PipelineStatusView({ state }: { state: TranscriberState }) {
  const currentIndex = STEPS.findIndex((s) => s.key === state.status);

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Progress</h2>
        <span className="text-sm text-text-2 whitespace-nowrap">Elapsed: {formatElapsed(state.elapsedMs)}</span>
      </div>

      {state.status === 'failed' ? (
        <p className="text-error text-sm">{state.error}</p>
      ) : (
        <ul className="space-y-2">
          {STEPS.map((step, i) => {
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
          Using fallback mode (Whisper + inferred speakers) — the diarized model wasn&apos;t available.
          {state.primaryError ? ` (${state.primaryError})` : ''}
        </p>
      )}
    </div>
  );
}
