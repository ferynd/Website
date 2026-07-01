'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { ACCEPTED_FILE_EXTENSION, MAX_OPENAI_UPLOAD_BYTES } from '../lib/constants';

interface UploadPanelProps {
  disabled: boolean;
  defaultSpeakerNames: string[];
  defaultContextNotes: string;
  onRun: (opts: { file: File; speakerNames: string[]; contextNotes: string }) => void;
}

const MAX_MB = (MAX_OPENAI_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);

export default function UploadPanel({
  disabled,
  defaultSpeakerNames,
  defaultContextNotes,
  onRun,
}: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [speakerNames, setSpeakerNames] = useState<string[]>(defaultSpeakerNames);
  const [contextNotes, setContextNotes] = useState(defaultContextNotes);

  const validation = useMemo(() => {
    if (!file) return null;
    const sizeMb = file.size / (1024 * 1024);
    const hasValidExtension = file.name.toLowerCase().endsWith(ACCEPTED_FILE_EXTENSION);
    const overLimit = file.size > MAX_OPENAI_UPLOAD_BYTES;
    return { sizeMb, hasValidExtension, overLimit };
  }, [file]);

  const canRun = !!file && !!validation && validation.hasValidExtension && !validation.overLimit && !disabled;

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8 space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">Recording (.m4a)</label>
        <input
          type="file"
          accept=".m4a,audio/x-m4a,audio/mp4,audio/m4a"
          disabled={disabled}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-text-2 file:mr-4 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-black file:font-medium hover:file:bg-accent-600 file:cursor-pointer cursor-pointer"
        />
        {file && validation && (
          <div className="text-sm space-y-1">
            <p className="text-text-2 break-all">
              {file.name} · {validation.sizeMb.toFixed(1)} MB
            </p>
            {!validation.hasValidExtension && <p className="text-error">Please choose a .m4a file.</p>}
            {validation.overLimit && (
              <p className="text-error">
                This file is over OpenAI&apos;s {MAX_MB} MB upload limit. Compress it (lower bitrate) or split it
                into smaller parts before uploading.
              </p>
            )}
            {validation.hasValidExtension && !validation.overLimit && (
              <p className="text-success">Looks good — under the {MAX_MB} MB limit.</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-text">Speakers</label>
        <div className="space-y-2">
          {speakerNames.map((name, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={name}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...speakerNames];
                  next[i] = e.target.value;
                  setSpeakerNames(next);
                }}
                placeholder={`Speaker ${i + 1}`}
                className="flex-1 w-full"
                wrapperClassName="flex-1"
              />
              {speakerNames.length > 1 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSpeakerNames(speakerNames.filter((_, idx) => idx !== i))}
                  className="text-text-3 hover:text-error focus-ring rounded p-2 flex-shrink-0"
                  aria-label={`Remove speaker ${i + 1}`}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setSpeakerNames([...speakerNames, ''])}
          className="inline-flex items-center gap-2"
        >
          <Plus size={14} />
          Add speaker
        </Button>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">Context notes (optional)</label>
        <textarea
          value={contextNotes}
          disabled={disabled}
          onChange={(e) => setContextNotes(e.target.value)}
          rows={3}
          className="w-full bg-surface-1 border border-border text-text placeholder:text-text-3 rounded-lg px-4 py-3 transition-all duration-200 ease-in-out hover:border-accent focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        />
      </div>

      <Button
        type="button"
        variant="primary"
        disabled={!canRun}
        onClick={() =>
          file &&
          onRun({
            file,
            speakerNames: speakerNames.map((s) => s.trim()).filter(Boolean),
            contextNotes,
          })
        }
        className="w-full sm:w-auto"
      >
        {disabled ? 'Running…' : 'Transcribe'}
      </Button>
    </div>
  );
}
