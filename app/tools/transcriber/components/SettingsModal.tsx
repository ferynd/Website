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
  CORRECTION_GEMINI_MODEL,
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
      </div>
    </div>
  );
}
