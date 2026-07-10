'use client';

import { useState } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Download, Play, RotateCcw, Settings2 } from 'lucide-react';
import Button from '@/components/Button';
import type { TranscriptionProviderId } from '../lib/providers/types';
import type { RecoveryInfo, ResumeInfo } from '../useTranscriberPipeline';

/* ------------------------------------------------------------ */
/* CONFIGURATION: retry button labels + which providers can always be offered */
/* ------------------------------------------------------------ */
const PROVIDER_LABELS: Record<TranscriptionProviderId, string> = {
  'openai-diarized': 'OpenAI diarized',
  'openai-whisper': 'Whisper',
  gemini: 'Gemini',
};
/** OpenAI retry buttons are only shown when classifyTranscriptionError actually recommends them. */
const CONDITIONAL_RETRY_PROVIDERS: TranscriptionProviderId[] = ['openai-diarized', 'openai-whisper'];

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-text-3">{label}</dt>
      <dd className="text-text break-all">{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-readable line describing what a Resume would reuse — see useTranscriberPipeline.ts's ResumeInfo. */
function describeResume(resume: ResumeInfo): string {
  if (resume.stage === 'transcribe') {
    return `${resume.completedChunks} of ${resume.totalChunks} transcription chunks already succeeded and are saved — Resume re-runs only the ones that failed.`;
  }
  return resume.completedChunks > 0
    ? `The transcription is saved, and ${resume.completedChunks} of ${resume.totalChunks} cleanup chunks already succeeded — Resume redoes only the cleanup that failed.`
    : 'The transcription is saved — Resume skips straight to re-running the cleanup pass.';
}

export interface ErrorRecoveryPanelProps {
  recovery: RecoveryInfo;
  /** When non-empty, the raw-preserving actions (download / complete with raw only) are offered. */
  rawText: string;
  onRetry: (providerId: TranscriptionProviderId) => void;
  /** Re-runs with the same provider/parameters as the failed run, reusing everything recovery.resume says is saved. Only rendered when recovery.resume is set. */
  onResume: () => void;
  onOpenSettings: () => void;
  onCompleteWithRawOnly: () => void;
}

/**
 * Replaces the old dead-end "run failed" line: a diagnostics table plus
 * concrete next actions. Retry buttons for the two OpenAI providers are
 * filtered by `classified.retryProviders`; the Gemini retry button is always
 * shown (per the product decision to make it a visible, first-class choice)
 * regardless of `retryProviders` — retrying with Gemini is a real, runnable
 * choice for any failure, not just ones Gemini is specifically recommended
 * for.
 */
export default function ErrorRecoveryPanel({
  recovery,
  rawText,
  onRetry,
  onResume,
  onOpenSettings,
  onCompleteWithRawOnly,
}: ErrorRecoveryPanelProps) {
  const [copied, setCopied] = useState(false);

  const diagnostics = {
    category: recovery.classified.category,
    likelyCause: recovery.classified.likelyCause,
    recommendedAction: recovery.classified.recommendedAction,
    suggestsConversion: recovery.classified.suggestsConversion,
    provider: recovery.provider,
    model: recovery.model,
    fileName: recovery.fileName,
    fileSizeBytes: recovery.fileSizeBytes,
    browserMime: recovery.browserMime,
    upstreamStatus: recovery.upstreamStatus,
    upstreamBody: recovery.upstreamBody,
  };

  const handleCopyDiagnostics = async () => {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadRaw = () => {
    const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-raw-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const offeredOpenAiRetries = CONDITIONAL_RETRY_PROVIDERS.filter((p) => recovery.classified.retryProviders.includes(p));

  return (
    <div className="rounded-xl border border-error/40 bg-error/5 p-6 sm:p-8 space-y-5">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-error flex-shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-text">Run failed</h2>
          <p className="text-sm text-text-2">{recovery.classified.likelyCause}</p>
          <p className="text-sm text-text-2">{recovery.classified.recommendedAction}</p>
          {recovery.classified.suggestsConversion && (
            <p className="text-sm text-warning">
              If it keeps failing, re-export the audio (e.g. to WAV or MP3) to rebuild the container, then re-upload.
            </p>
          )}
          {recovery.resume && <p className="text-sm text-success">{describeResume(recovery.resume)}</p>}
        </div>
      </div>

      <dl className="rounded-lg border border-border bg-surface-1 p-4 space-y-2">
        <DiagnosticRow label="Category" value={recovery.classified.category} />
        <DiagnosticRow label="Provider" value={recovery.provider ? PROVIDER_LABELS[recovery.provider] : '(none)'} />
        <DiagnosticRow label="Model" value={recovery.model ?? '(none)'} />
        <DiagnosticRow label="File" value={`${recovery.fileName} · ${formatBytes(recovery.fileSizeBytes)}`} />
        <DiagnosticRow label="Browser MIME" value={recovery.browserMime} />
        <DiagnosticRow
          label="Upstream status"
          value={recovery.upstreamStatus === null ? '(none — network error)' : String(recovery.upstreamStatus)}
        />
        {recovery.upstreamBody && <DiagnosticRow label="Upstream body" value={recovery.upstreamBody} />}
      </dl>

      <div className="flex flex-wrap gap-3">
        {recovery.resume && (
          <Button type="button" variant="primary" onClick={onResume} className="inline-flex items-center gap-2">
            <Play size={16} />
            Resume run
          </Button>
        )}
        {offeredOpenAiRetries.map((providerId) => (
          <Button
            key={providerId}
            type="button"
            // Resume (when offered) is the one primary action — picking a
            // provider explicitly still works (and still reuses saved work
            // when it's the same provider) but demotes to secondary.
            variant={recovery.resume ? 'secondary' : 'primary'}
            onClick={() => onRetry(providerId)}
            className="inline-flex items-center gap-2"
          >
            <RotateCcw size={16} />
            Retry with {PROVIDER_LABELS[providerId]}
          </Button>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => onRetry('gemini')}
          className="inline-flex items-center gap-2"
        >
          <RotateCcw size={16} />
          Retry with Gemini
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenSettings} className="inline-flex items-center gap-2">
          <Settings2 size={16} />
          Open settings
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleCopyDiagnostics}
          className="inline-flex items-center gap-2"
        >
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
          {copied ? 'Copied!' : 'Copy diagnostics'}
        </Button>
        {rawText && (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={handleDownloadRaw}
              className="inline-flex items-center gap-2"
            >
              <Download size={16} />
              Download raw .txt
            </Button>
            <Button type="button" variant="secondary" onClick={onCompleteWithRawOnly}>
              Complete with raw only
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
