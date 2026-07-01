'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import Button from '@/components/Button';
import type { TranscriberState } from '../useTranscriberPipeline';

export default function TranscriptOutput({
  state,
  onReset,
}: {
  state: TranscriberState;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.transcriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([state.transcriptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Transcript</h2>
        <span className="text-xs rounded-full border border-border px-3 py-1 text-text-2 whitespace-nowrap">
          {state.mode === 'diarized' ? 'OpenAI diarized' : 'Fallback (Whisper + inferred speakers)'}
        </span>
      </div>

      <textarea
        readOnly
        value={state.transcriptText}
        rows={16}
        className="w-full bg-surface-2 border border-border text-text rounded-lg px-4 py-3 font-mono text-sm"
      />

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={handleDownload} className="inline-flex items-center gap-2 w-full sm:w-auto">
          <Download size={16} />
          Download .txt
        </Button>
        <Button
          variant="secondary"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 w-full sm:w-auto"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy transcript'}
        </Button>
        <Button variant="ghost" onClick={onReset} className="w-full sm:w-auto">
          Start over
        </Button>
      </div>
    </div>
  );
}
