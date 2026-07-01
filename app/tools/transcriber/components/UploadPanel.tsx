'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { ACCEPTED_FILE_EXTENSIONS, MAX_GEMINI_UPLOAD_BYTES, MAX_OPENAI_UPLOAD_BYTES } from '../lib/constants';
import type { TranscriberSettings } from '../lib/settings';
import ProviderPicker from './ProviderPicker';

interface UploadPanelProps {
  disabled: boolean;
  defaultSpeakerNames: string[];
  defaultContextNotes: string;
  settings: TranscriberSettings;
  /** Shallow-merged into the settings store — see page.tsx's updateSettings. Threaded through to ProviderPicker. */
  onSettingsChange: (patch: Partial<TranscriberSettings>) => void;
  onRun: (opts: {
    file: File;
    speakerNames: string[];
    contextNotes: string;
    strictMode: boolean;
    skipCleanup: boolean;
  }) => void;
}

const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_FILE_EXTENSIONS,
  'audio/x-m4a',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
].join(',');

export default function UploadPanel({
  disabled,
  defaultSpeakerNames,
  defaultContextNotes,
  settings,
  onSettingsChange,
  onRun,
}: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [speakerNames, setSpeakerNames] = useState<string[]>(defaultSpeakerNames);
  const [contextNotes, setContextNotes] = useState(defaultContextNotes);

  // "Skip cleanup" / "Strict correction" now live in ProviderPicker's toggle
  // row, reading/writing the settings store directly — see
  // settings.cleanupEnabled / settings.strictCorrection.
  const skipCleanup = !settings.cleanupEnabled;
  const strictMode = settings.strictCorrection && !skipCleanup;

  const maxUploadBytes = settings.provider === 'gemini' ? MAX_GEMINI_UPLOAD_BYTES : MAX_OPENAI_UPLOAD_BYTES;
  const maxUploadMb = (maxUploadBytes / (1024 * 1024)).toFixed(0);
  const providerLabel = settings.provider === 'gemini' ? 'Gemini' : 'OpenAI';

  const validation = useMemo(() => {
    if (!file) return null;
    const sizeMb = file.size / (1024 * 1024);
    const lowerName = file.name.toLowerCase();
    const hasValidExtension = ACCEPTED_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const overLimit = file.size > maxUploadBytes;
    return { sizeMb, hasValidExtension, overLimit };
  }, [file, maxUploadBytes]);

  const canRun = !!file && !!validation && validation.hasValidExtension && !validation.overLimit && !disabled;

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8 space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">
          Recording ({ACCEPTED_FILE_EXTENSIONS.join(', ')})
        </label>
        <input
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          disabled={disabled}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-text-2 file:mr-4 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-black file:font-medium hover:file:bg-accent-600 file:cursor-pointer cursor-pointer"
        />
        {file && validation && (
          <div className="text-sm space-y-1">
            <p className="text-text-2 break-all">
              {file.name} · {validation.sizeMb.toFixed(1)} MB
            </p>
            {!validation.hasValidExtension && (
              <p className="text-error">Please choose one of: {ACCEPTED_FILE_EXTENSIONS.join(', ')}.</p>
            )}
            {validation.overLimit && (
              <p className="text-error">
                This file is over {providerLabel}&apos;s {maxUploadMb} MB upload limit. Compress it (lower bitrate)
                or split it into smaller parts before uploading{settings.provider === 'gemini' ? '' : ', or switch to Gemini below (higher limit)'}.
              </p>
            )}
            {validation.hasValidExtension && !validation.overLimit && (
              <p className="text-success">
                Looks good — under the {maxUploadMb} MB limit for {providerLabel}.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text">Speakers</label>
          <p className="text-xs text-text-3 mt-0.5">
            Fed to the cleanup pass so it knows which names to assign lines to. Example: with diarized transcription
            (default), the first speaker detected in the audio is mapped to the first name here, the second detected
            speaker to the second name, and so on — order matters more than exact spelling.
          </p>
        </div>
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
        <div>
          <label className="block text-sm font-medium text-text">Context notes (optional)</label>
          <p className="text-xs text-text-3 mt-0.5">
            Free text passed directly into the cleanup prompt as extra background — the correction pass only sees
            ~15 minutes of the recording at a time, so this is the way to hand it context it can&apos;t otherwise
            infer (who&apos;s who, accents, in-jokes, names it might mishear). Example: &quot;Kait is female and
            speaks more slowly. James is male and speaks more quickly. This is a couples&apos; therapy session — do
            not soften or sanitize what either person says.&quot;
          </p>
        </div>
        <textarea
          value={contextNotes}
          disabled={disabled}
          onChange={(e) => setContextNotes(e.target.value)}
          rows={3}
          className="w-full bg-surface-1 border border-border text-text placeholder:text-text-3 rounded-lg px-4 py-3 transition-all duration-200 ease-in-out hover:border-accent focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        />
      </div>

      <ProviderPicker settings={settings} onChange={onSettingsChange} disabled={disabled} />

      {skipCleanup && (
        <p className="text-xs text-text-3">
          Skip cleanup is on — the raw transcript will be returned as-is, with a ready-to-paste cleanup prompt
          (including your speakers and context notes above) at the top, for pasting into a browser AI chat (ChatGPT,
          Claude, Gemini, etc.) instead.
        </p>
      )}

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
            strictMode,
            skipCleanup,
          })
        }
        className="w-full sm:w-auto"
      >
        {disabled ? 'Running…' : 'Transcribe'}
      </Button>
    </div>
  );
}
