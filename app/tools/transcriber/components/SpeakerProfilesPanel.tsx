'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Plus, Trash2, Upload, X } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import type { ClipValidationStatus } from '../lib/clipAnalysis';
import { buildVoiceScript } from '../lib/voiceScript';
import type { SpeakerProfileMeta } from '../lib/speakerProfiles';
import type { SpeakerProfileClipStatus, UseSpeakerProfilesResult } from '../useSpeakerProfiles';
import ClipRecorder from './ClipRecorder';

/* ------------------------------------------------------------ */
/* CONFIGURATION: status pill copy + recording guidance          */
/* ------------------------------------------------------------ */

const STATUS_PILL: Record<ClipValidationStatus, { label: string; className: string }> = {
  missing: { label: 'No clip yet', className: 'border-border text-text-3' },
  'too-short': { label: 'Too short — record again', className: 'border-error/40 bg-error/10 text-error' },
  'too-quiet': { label: 'Too quiet — move closer', className: 'border-warning/40 bg-warning/10 text-warning' },
  trimmed: { label: 'Trimmed to best 8s — usable', className: 'border-accent/40 bg-accent/10 text-accent' },
  ok: { label: 'Looks good', className: 'border-success/40 bg-success/10 text-success' },
};

const RECORDING_GUIDANCE = [
  'Record 10–20 seconds.',
  'Only the one speaker should talk during the clip.',
  'Use a quiet room — no TV, music, or background conversation.',
  'Stay at a normal conversational distance from the microphone.',
  'Speak naturally, at your normal pace — do not whisper.',
  'Leave a short pause before and after you speak.',
];

const LOCAL_STORAGE_NOTE =
  'Speaker clips are stored locally in this browser and sent only during transcription runs. They are not stored in Firestore or on the server.';

function StatusPill({ status }: { status: ClipValidationStatus }) {
  const pill = STATUS_PILL[status];
  return (
    <span className={`text-xs rounded-full border px-2.5 py-0.5 whitespace-nowrap ${pill.className}`}>
      {pill.label}
    </span>
  );
}

function ScriptDisclosure({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const script = buildVoiceScript(name);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-surface-2 focus-ring text-xs font-medium"
      >
        Read-aloud script
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="p-3 space-y-3 text-xs">
          <p className="text-text-2 italic">&quot;{script}&quot;</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(script);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex items-center gap-2"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy script'}
          </Button>
          <ul className="text-text-3 list-disc pl-4 space-y-0.5">
            {RECORDING_GUIDANCE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  status,
  disabled,
  canRemove,
  onRename,
  onNotesChange,
  onRemove,
  onUpload,
  onRecord,
  onDelete,
}: {
  profile: SpeakerProfileMeta;
  status: SpeakerProfileClipStatus;
  disabled: boolean;
  canRemove: boolean;
  onRename: (name: string) => void;
  onNotesChange: (notes: string) => void;
  onRemove: () => void;
  onUpload: (file: File) => void;
  onRecord: (blob: Blob) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Input
          value={profile.name}
          disabled={disabled}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Speaker name"
          className="flex-1 w-full"
          wrapperClassName="flex-1"
        />
        {canRemove && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            className="text-text-3 hover:text-error focus-ring rounded p-2 flex-shrink-0"
            aria-label={`Remove ${profile.name || 'speaker'}`}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {!profile.name.trim() && <p className="text-xs text-error">Name is required — this profile is skipped until named.</p>}

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text-2">Voice / speaking-style notes (optional)</label>
        <textarea
          value={profile.notes}
          disabled={disabled}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          placeholder="e.g. speaks quickly, slight accent, tends to trail off at the end of sentences"
          className="w-full bg-surface-1 border border-border text-text placeholder:text-text-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ease-in-out hover:border-accent focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        />
      </div>

      <ScriptDisclosure name={profile.name} />

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={status.validationStatus} />
        {status.durationSec !== null && <span className="text-xs text-text-3">{status.durationSec.toFixed(1)}s</span>}
        {status.processing && <span className="text-xs text-text-3">Processing…</span>}
      </div>
      {status.error && <p className="text-xs text-error">{status.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`inline-flex items-center gap-2 text-sm rounded-lg bg-surface-2 text-text hover:bg-surface-3 px-4 py-1.5 cursor-pointer transition-all duration-200 ease-in-out ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <Upload size={14} />
          {status.hasClip ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="audio/*"
            disabled={disabled}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </label>
        <ClipRecorder disabled={disabled} onRecorded={onRecord} />
        {status.hasClip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onDelete}
            className="inline-flex items-center gap-2 text-error"
          >
            <Trash2 size={14} />
            Delete clip
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible speaker-profiles section (main page, between RequirementsPanel
 * and UploadPanel). Profile names/notes REPLACE the old free-form
 * speaker-name inputs that used to live in UploadPanel — page.tsx reads
 * `sp.speakerNames`/`sp.speakerNotes` for a run instead.
 */
export default function SpeakerProfilesPanel({ sp, disabled }: { sp: UseSpeakerProfilesResult; disabled: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? !sp.allProfilesValid;

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 sm:p-6 space-y-4">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="w-full flex items-center justify-between gap-3 text-left focus-ring rounded"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Speaker profiles</span>
          {sp.profiles.map((profile) => (
            <StatusPill key={profile.id} status={sp.clipStatusByProfile[profile.id]?.validationStatus ?? 'missing'} />
          ))}
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="space-y-4">
          <p className="text-xs text-text-3">{LOCAL_STORAGE_NOTE}</p>

          {sp.clipStorageAvailable === false && (
            <p className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
              This browser does not support local clip storage (e.g. private browsing mode) — clips recorded or
              uploaded below are kept in memory for this run only and will need to be re-added next time.
            </p>
          )}

          <div className="space-y-3">
            {sp.profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                status={
                  sp.clipStatusByProfile[profile.id] ?? {
                    hasClip: false,
                    validationStatus: 'missing',
                    durationSec: null,
                    rmsDb: null,
                    processing: false,
                    error: null,
                  }
                }
                disabled={disabled}
                canRemove={sp.profiles.length > 1}
                onRename={(name) => sp.renameProfile(profile.id, name)}
                onNotesChange={(notes) => sp.updateNotes(profile.id, notes)}
                onRemove={() => sp.removeProfile(profile.id)}
                onUpload={(file) => sp.uploadClip(profile.id, file)}
                onRecord={(blob) => sp.recordClip(profile.id, blob)}
                onDelete={() => sp.deleteClipForProfile(profile.id)}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={sp.addProfile}
            className="inline-flex items-center gap-2"
          >
            <Plus size={14} />
            Add speaker profile
          </Button>
        </div>
      )}
    </div>
  );
}
