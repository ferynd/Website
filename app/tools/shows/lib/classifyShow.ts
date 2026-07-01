import type { ShowType, MetadataSource } from '../types';
import type { GeminiModelId } from '@/app/lib/aiModels';

export interface ClassifyShowResult {
  status: 'resolved' | 'needs_selection' | 'not_found';
  canonicalTitle?: string;
  type?: ShowType;
  vibes?: string[];
  description?: string;
  source?: MetadataSource;
  sourceId?: string;
  message?: string;
}

/** Thin wrapper around POST /api/classify shared by the single-show form and the batch AI update workflow. */
export async function classifyShow(opts: {
  title: string;
  typeHint: ShowType | null;
  typeHintWasUserSelected: boolean;
  modelId: GeminiModelId;
}): Promise<ClassifyShowResult> {
  const res = await fetch('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Classification failed');
  }
  return res.json() as Promise<ClassifyShowResult>;
}
