'use client';

import { Mic, Square } from 'lucide-react';
import Button from '@/components/Button';
import { useClipRecorder } from '../useClipRecorder';

interface ClipRecorderProps {
  disabled?: boolean;
  onRecorded: (blob: Blob) => void;
}

/** Small Record/Stop control backed by useClipRecorder.ts — one per speaker profile card in SpeakerProfilesPanel.tsx. */
export default function ClipRecorder({ disabled, onRecorded }: ClipRecorderProps) {
  const { state, error, elapsedSec, start, stop } = useClipRecorder(onRecorded);
  const isRecording = state === 'recording';

  const label =
    state === 'requesting' ? 'Requesting mic…' : isRecording ? `Stop (${Math.ceil(elapsedSec)}s)` : 'Record';

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant={isRecording ? 'danger' : 'secondary'}
        size="sm"
        disabled={disabled || state === 'requesting' || state === 'processing'}
        onClick={isRecording ? stop : start}
        className="inline-flex items-center gap-2"
      >
        {isRecording ? <Square size={14} /> : <Mic size={14} />}
        {label}
      </Button>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
