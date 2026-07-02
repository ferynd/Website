'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download } from 'lucide-react';
import Button from '@/components/Button';
import { formatTimestamp } from '../lib/formatTranscript';
import { readTranscriberSettings } from '../lib/settings';
import type { ArgumentTag, TurnBlock } from '../lib/types';
import type { TranscriberState } from '../useTranscriberPipeline';

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same "[HH:MM:SS] Speaker: text" shape as formatCleanTranscript, with the
 * block's tag appended in brackets, e.g. "... [argument_conflict]" — used
 * only by the "Show tags" toggle below; untagged blocks (tagging was off
 * for this block, or a merged block had no majority tag) render unchanged. */
function formatTurnWithTag(block: TurnBlock): string {
  const tagSuffix = block.tag ? ` [${block.tag}]` : '';
  return `[${formatTimestamp(block.start)}] ${block.speaker}: ${block.text}${tagSuffix}`;
}

const TAG_SUMMARY_ORDER: ArgumentTag[] = [
  'argument_conflict',
  'repair_attempt',
  'emotional_support',
  'logistics_or_normal',
  'unrelated',
  'unclear',
];

function TagSummaryLine({ summary }: { summary: Record<ArgumentTag, number> }) {
  return (
    <p className="text-xs text-text-3">
      Tag counts: {TAG_SUMMARY_ORDER.map((tag) => `${tag}: ${summary[tag]}`).join(' · ')}
    </p>
  );
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-2"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : label}
    </Button>
  );
}

function TranscriptSection({
  title,
  text,
  filename,
  defaultOpen,
  note,
}: {
  title: string;
  text: string;
  filename: string;
  defaultOpen: boolean;
  note?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-surface-2 focus-ring"
      >
        <span className="text-sm font-semibold">{title}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="p-4 space-y-3">
          {note && <p className="text-xs text-text-3">{note}</p>}
          <textarea
            readOnly
            value={text}
            rows={12}
            className="w-full bg-surface-2 border border-border text-text rounded-lg px-4 py-3 font-mono text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadText(text, filename)}
              className="inline-flex items-center gap-2"
            >
              <Download size={14} />
              Download .txt
            </Button>
            <CopyButton text={text} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dual raw/cleaned output, always both captured (raw is free — see
 * useTranscriberPipeline's "capture raw before suppression" step). Cleaned
 * defaults open, Raw defaults collapsed UNLESS there's no cleaned text for
 * this run (cleanup skipped, disabled, or failed with a raw-only
 * completion), in which case Raw is forced open with an explanatory note.
 * settings.showRawOutput/showCleanedOutput gate whether each section is
 * shown at all — Raw is never fully hidden when it's the only output.
 */
export default function TranscriptOutput({ state, onReset }: { state: TranscriberState; onReset: () => void }) {
  // Lazy init only — this component only ever mounts client-side (after a
  // run completes), so there's no SSR/hydration mismatch to guard against.
  const [settings] = useState(() => readTranscriberSettings());
  // Inline per-turn tags are hidden by default — this only affects the
  // Cleaned section's displayed/downloaded text, and only exists at all when
  // tagging was on for this run (state.tagSummary !== null).
  const [showTags, setShowTags] = useState(false);

  const hasCleaned = state.cleanedText !== null;
  const showCleanedSection = hasCleaned && settings.showCleanedOutput;
  const showRawSection = !showCleanedSection || settings.showRawOutput;
  const hasTagging = state.tagSummary !== null;

  const cleanedDisplayText = useMemo(() => {
    if (!showTags || !hasCleaned) return state.cleanedText ?? '';
    return state.turnBlocks.map(formatTurnWithTag).join('\n\n');
  }, [showTags, hasCleaned, state.cleanedText, state.turnBlocks]);

  const totalRemoved = state.suppressionReport?.removed.reduce((sum, r) => sum + r.count, 0) ?? 0;

  const handleDownloadDebug = () => {
    if (!state.debugJson) return;
    downloadText(state.debugJson, `transcript-debug-${todayStamp()}.json`);
  };

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Transcript</h2>
        <div className="flex flex-wrap items-center gap-2">
          {state.cleanupSkipped && (
            <span className="text-xs rounded-full border border-accent/40 bg-accent/10 text-accent px-3 py-1 whitespace-nowrap">
              Raw — cleanup pass skipped
            </span>
          )}
          <span className="text-xs rounded-full border border-border px-3 py-1 text-text-2 whitespace-nowrap">
            {state.mode === 'diarized'
              ? 'OpenAI diarized'
              : state.mode === 'gemini'
                ? 'Gemini direct (speakers prompt-inferred)'
                : 'Fallback (Whisper + inferred speakers)'}
          </span>
        </div>
      </div>

      {state.cleanupSkipped && (
        <p className="text-sm text-text-2 bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">
          The Gemini cleanup pass was skipped for this run. A ready-to-paste prompt is included at the top of the
          raw text below — copy the whole thing into a browser AI chat (ChatGPT, Claude, Gemini, etc.) if you want
          it cleaned up manually.
        </p>
      )}

      {!hasCleaned && !state.cleanupSkipped && (
        <p className="text-sm text-text-2 bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
          Cleanup didn&apos;t produce output for this run — showing the raw transcript only.
        </p>
      )}

      {state.warning && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
          {state.warning}
        </p>
      )}

      {totalRemoved > 0 && state.suppressionReport && (
        <div className="text-sm text-text-2 bg-surface-2 border border-border rounded-lg px-4 py-3 space-y-1">
          <p>
            Removed {totalRemoved} repeated phrase{totalRemoved === 1 ? '' : 's'} (
            {state.suppressionReport.removed.length} group{state.suppressionReport.removed.length === 1 ? '' : 's'}) from
            the cleaned transcript — still present in the raw transcript below.
          </p>
          <ul className="text-xs text-text-3 list-disc pl-4 space-y-0.5">
            {state.suppressionReport.removed.map((r, i) => (
              <li key={i}>
                &quot;{r.phrase}&quot; × {r.count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasTagging && state.tagSummary && (
        <div className="text-sm text-text-2 bg-surface-2 border border-border rounded-lg px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Argument tagging was on for this run.</span>
            <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showTags}
                onChange={(e) => setShowTags(e.target.checked)}
                className="rounded border-border"
              />
              Show tags in the Cleaned transcript
            </label>
          </div>
          <TagSummaryLine summary={state.tagSummary} />
        </div>
      )}

      <div className="space-y-3">
        {showCleanedSection && (
          <TranscriptSection
            title="Cleaned"
            text={cleanedDisplayText}
            filename={`transcript-cleaned-${todayStamp()}.txt`}
            defaultOpen
          />
        )}
        {showRawSection && (
          <TranscriptSection
            title="Raw"
            text={state.rawText}
            filename={`transcript-raw-${todayStamp()}.txt`}
            defaultOpen={!hasCleaned}
            note={
              !hasCleaned && !state.cleanupSkipped
                ? 'No cleaned version is available for this run — this is the unedited transcript.'
                : undefined
            }
          />
        )}
        {hasTagging && state.argumentRelevantText !== null && (
          <TranscriptSection
            title="Argument-relevant transcript"
            text={state.argumentRelevantText}
            filename={`transcript-argument-${todayStamp()}.txt`}
            defaultOpen={false}
            note="Filtered to conflict, repair, and support turns, plus short surrounding context — excludes ordinary logistics and unrelated chatter."
          />
        )}
      </div>

      {state.debugJson && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <span className="text-xs text-text-3">Debug JSON (no transcript text or audio included):</span>
          <CopyButton text={state.debugJson} label="Copy debug JSON" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadDebug}
            className="inline-flex items-center gap-2"
          >
            <Download size={14} />
            Download debug JSON
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button variant="ghost" onClick={onReset} className="w-full sm:w-auto">
          Start over
        </Button>
      </div>
    </div>
  );
}
