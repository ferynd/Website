'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  AVAILABLE_GEMINI_MODELS,
  geminiModelOptionLabel,
  readStoredGeminiModel,
  resolveGeminiModelId,
  saveStoredGeminiModel,
  type GeminiModelId,
} from '@/app/lib/aiModels';
import {
  AVAILABLE_TRANSCRIBE_MODELS,
  readStoredTranscribeModel,
  resolveTranscribeModelId,
  saveStoredTranscribeModel,
  type TranscribeModelId,
} from '@/app/lib/transcribeModels';
import { ADMIN_EMAIL } from '../../trip-cost/firebaseConfig';
import {
  CORRECTION_CHUNK_SECONDS,
  CORRECTION_GEMINI_MODEL,
  CORRECTION_OVERLAP_SECONDS,
  CORRECTION_TEMPERATURE,
  PRIMARY_TRANSCRIBE_MODEL,
  TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY,
  TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY,
} from '../lib/constants';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [transcribeModelId, setTranscribeModelId] = useState<TranscribeModelId>(PRIMARY_TRANSCRIBE_MODEL);
  const [correctionModelId, setCorrectionModelId] = useState<GeminiModelId>(CORRECTION_GEMINI_MODEL);

  useEffect(() => {
    setTranscribeModelId(
      readStoredTranscribeModel(TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY, PRIMARY_TRANSCRIBE_MODEL),
    );
    setCorrectionModelId(
      readStoredGeminiModel(TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY, CORRECTION_GEMINI_MODEL),
    );
  }, []);

  function handleTranscribeChange(value: string) {
    const modelId = resolveTranscribeModelId(value, PRIMARY_TRANSCRIBE_MODEL);
    setTranscribeModelId(modelId);
    saveStoredTranscribeModel(TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY, modelId);
  }

  function handleCorrectionChange(value: string) {
    const modelId = resolveGeminiModelId(value, CORRECTION_GEMINI_MODEL);
    setCorrectionModelId(modelId);
    saveStoredGeminiModel(TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY, modelId);
  }

  const activeTranscribeModel = AVAILABLE_TRANSCRIBE_MODELS.find((m) => m.id === transcribeModelId);
  const activeCorrectionModel = AVAILABLE_GEMINI_MODELS.find((m) => m.id === correctionModelId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-surface-1 p-6 space-y-6 max-h-[90vh] overflow-y-auto">
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
            this UI and on every API request, independently of any setting below.
          </p>
        </div>

        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Transcription model (OpenAI)</h3>
            <p className="text-xs text-text-3 mt-0.5">
              Choose for this device only — saved locally in this browser.
            </p>
          </div>
          <select
            value={transcribeModelId}
            onChange={(e) => handleTranscribeChange(e.target.value)}
            className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
          >
            {AVAILABLE_TRANSCRIBE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} — {model.cost}
              </option>
            ))}
          </select>
          {activeTranscribeModel && (
            <div className="text-xs text-text-3 space-y-0.5">
              <p>
                <span className="text-success font-medium">Pro:</span> {activeTranscribeModel.pros}
              </p>
              <p>
                <span className="text-warning font-medium">Con:</span> {activeTranscribeModel.cons}
              </p>
            </div>
          )}
          <p className="text-xs text-text-3">
            Default: GPT-4o Transcribe (Diarize), with automatic fallback to Whisper-1 if it&apos;s unavailable.
          </p>
        </div>

        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Speaker-correction model (Gemini)</h3>
            <p className="text-xs text-text-3 mt-0.5">
              Choose for this device only — saved locally in this browser.
            </p>
          </div>
          <select
            value={correctionModelId}
            onChange={(e) => handleCorrectionChange(e.target.value)}
            className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
          >
            {AVAILABLE_GEMINI_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {geminiModelOptionLabel(model)}
              </option>
            ))}
          </select>
          {activeCorrectionModel && <p className="text-xs text-text-3">{activeCorrectionModel.note}</p>}
          <p className="text-xs text-text-3">
            Default: Gemini 2.5 Flash, run at low temperature since correction is a precision task.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3">
          <h3 className="text-sm font-semibold">How the cleanup pass reads your input</h3>
          <p className="text-xs text-text-3">
            These aren&apos;t editable here — they&apos;re the fixed rules and parameters the correction prompt
            always uses, shown so the <span className="text-text-2">Speakers</span> and{' '}
            <span className="text-text-2">Context notes</span> fields on the upload panel are easier to use well.
          </p>

          <div className="space-y-1">
            <p className="text-xs font-medium text-text-2">Chunking &amp; context window</p>
            <p className="text-xs text-text-3">
              The correction pass runs in {CORRECTION_CHUNK_SECONDS / 60}-minute chunks with a{' '}
              {CORRECTION_OVERLAP_SECONDS}-second overlap on each side (for continuity across chunk boundaries) — it
              never sees the whole recording at once. Example: if a speaker&apos;s name is only mentioned once, an
              hour before a section that needs it, the model won&apos;t automatically carry that forward — put it in{' '}
              <span className="text-text-2">Context notes</span> instead so every chunk has it.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-text-2">Temperature ({CORRECTION_TEMPERATURE})</p>
            <p className="text-xs text-text-3">
              Deliberately low/near-deterministic — this is a precision correction task, not a creative one, so the
              model is biased toward leaving wording alone rather than rephrasing it.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-text-2">Fixed prompt rules</p>
            <ul className="text-xs text-text-3 list-disc pl-4 space-y-0.5">
              <li>Never summarizes, rewrites, paraphrases, or adds commentary — output is always line-for-line.</li>
              <li>Preserves wording as closely as possible, including interruptions, fragments, and repeated words.</li>
              <li>Never sanitizes or softens language.</li>
              <li>May fix obvious transcription errors, punctuation, and formatting only.</li>
              <li>May correct obvious speaker misattributions using your Speakers list, turn-taking, and speaking style — labels it &quot;Unknown&quot; rather than guessing when unsure.</li>
              <li>Timestamps always come from the original segment — the model can never change them, only speaker and text.</li>
            </ul>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-text-2">Example</p>
            <p className="text-xs text-text-3">
              Raw: <span className="italic">[00:04:12] Unknown: yeah i i dont think thats right kait</span>
              <br />
              Corrected with Speakers = &quot;Kait, James&quot; and turn-taking context: —{' '}
              <span className="italic">[00:04:12] James: Yeah, I— I don&apos;t think that&apos;s right, Kait.</span>{' '}
              (fixed attribution, punctuation, and capitalization; wording and meaning unchanged.)
            </p>
          </div>

          <p className="text-xs text-text-3">
            Want to skip this pass entirely (e.g. to paste the transcript into a browser AI chat yourself, or if{' '}
            <code className="mx-0.5">GEMINI_API_KEY</code> isn&apos;t configured)? Use the{' '}
            <span className="text-text-2">Skip cleanup pass</span> toggle on the upload panel instead of this modal —
            it&apos;s a per-run choice, not a device setting.
          </p>
        </div>
      </div>
    </div>
  );
}
