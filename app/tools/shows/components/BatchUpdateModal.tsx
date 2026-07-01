'use client';

import { useState } from 'react';
import { X, Sparkles, Loader2, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import type { Show } from '../types';
import { useShows } from '../ShowsContext';
import { classifyShow } from '../lib/classifyShow';
import {
  DEFAULT_CLASSIFY_GEMINI_MODEL,
  readStoredGeminiModel,
  SHOWS_CLASSIFY_MODEL_STORAGE_KEY,
} from '@/app/lib/aiModels';

type RowState = 'pending' | 'running' | 'success' | 'failed';

interface Props {
  shows: Show[];
  onClose: () => void;
}

export default function BatchUpdateModal({ shows, onClose }: Props) {
  const { updateShow } = useShows();
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [status, setStatus] = useState<Record<string, RowState>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  const succeeded = Object.values(status).filter((s) => s === 'success').length;
  const failed = Object.entries(status).filter(([, s]) => s === 'failed').map(([id]) => id);
  const finished = Object.values(status).filter((s) => s === 'success' || s === 'failed').length;

  async function runOne(show: Show) {
    setStatus((prev) => ({ ...prev, [show.id]: 'running' }));
    const modelId = readStoredGeminiModel(SHOWS_CLASSIFY_MODEL_STORAGE_KEY, DEFAULT_CLASSIFY_GEMINI_MODEL);
    try {
      const data = await classifyShow({
        title: show.title,
        typeHint: show.type,
        typeHintWasUserSelected: true,
        modelId,
      });
      if (data.status === 'resolved') {
        await updateShow(show.id, {
          title: data.canonicalTitle ?? show.title,
          type: data.type ?? show.type,
          vibeTags: data.vibes?.length ? data.vibes : show.vibeTags,
          description: typeof data.description === 'string' ? data.description : show.description,
          metadataSource: data.source ?? show.metadataSource ?? null,
          metadataSourceId: data.sourceId ?? show.metadataSourceId ?? null,
        });
        setStatus((prev) => ({ ...prev, [show.id]: 'success' }));
      } else {
        setStatus((prev) => ({ ...prev, [show.id]: 'failed' }));
        setMessages((prev) => ({
          ...prev,
          [show.id]: data.status === 'needs_selection' ? 'Multiple matches — needs manual review' : 'No confident match found',
        }));
      }
    } catch (err) {
      setStatus((prev) => ({ ...prev, [show.id]: 'failed' }));
      setMessages((prev) => ({ ...prev, [show.id]: err instanceof Error ? err.message : 'Failed' }));
    }
  }

  async function runBatch(targets: Show[]) {
    setPhase('running');
    // Sequential to stay well under provider rate limits and keep progress readable.
    for (const show of targets) {
      await runOne(show);
    }
    setPhase('done');
  }

  function retryFailed() {
    const targets = shows.filter((s) => failed.includes(s.id));
    runBatch(targets);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase === 'running' ? undefined : onClose} />
      <div className="relative z-10 w-full sm:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-1 border border-border shadow-2">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Sparkles size={16} className="text-accent" /> AI update
          </h2>
          {phase !== 'running' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-4 space-y-4">
          {phase === 'confirm' && (
            <>
              <p className="text-sm text-text-2">
                Re-run AI classification for <strong className="text-text">{shows.length}</strong> selected show
                {shows.length === 1 ? '' : 's'}. This will overwrite title, type, vibe tags, and description with the
                latest AI match for each — existing ratings and notes are untouched.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => runBatch(shows)}
                  className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-opacity min-h-[48px]"
                >
                  Update {shows.length}
                </button>
              </div>
            </>
          )}

          {(phase === 'running' || phase === 'done') && (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-text-2">
                  <span>{finished} / {shows.length} processed</span>
                  {phase === 'running' && <Loader2 size={14} className="animate-spin text-accent" />}
                </div>
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-200"
                    style={{ width: `${shows.length ? (finished / shows.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {shows.map((show) => {
                  const s = status[show.id] ?? 'pending';
                  return (
                    <li key={show.id} className="flex items-center gap-2 text-sm py-1">
                      {s === 'running' && <Loader2 size={14} className="animate-spin text-accent flex-shrink-0" />}
                      {s === 'success' && <CheckCircle2 size={14} className="text-success flex-shrink-0" />}
                      {s === 'failed' && <AlertCircle size={14} className="text-error flex-shrink-0" />}
                      {s === 'pending' && <span className="w-3.5 h-3.5 flex-shrink-0 rounded-full border border-border" />}
                      <span className="truncate flex-1 text-text-2">{show.title}</span>
                      {s === 'failed' && messages[show.id] && (
                        <span className="text-xs text-error flex-shrink-0">{messages[show.id]}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {phase === 'done' && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <p className="text-sm text-text-2">
                    <span className="text-success font-medium">{succeeded} updated</span>
                    {failed.length > 0 && (
                      <> · <span className="text-error font-medium">{failed.length} need attention</span></>
                    )}
                  </p>
                  <div className="flex gap-3">
                    {failed.length > 0 && (
                      <button
                        type="button"
                        onClick={retryFailed}
                        className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px] flex items-center justify-center gap-2"
                      >
                        <RotateCcw size={14} /> Retry failed
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-opacity min-h-[48px]"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
