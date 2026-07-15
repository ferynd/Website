export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { callGeminiWithUsage } from '@/app/lib/aiConfig';
import { resolveGeminiModelId } from '@/app/lib/aiModels';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import {
  buildClassifyPrompt,
  buildClassifyResponseSchema,
  parseClassifyResponse,
} from '@/app/tools/transcriber/lib/argumentClassify';
import {
  ARGUMENT_CLASSIFIER_GEMINI_MODEL,
  CORRECTION_TEMPERATURE,
} from '@/app/tools/transcriber/lib/constants';
import { accumulateStageUsage } from '@/app/tools/transcriber/lib/stageUsage';
import type {
  BlockClassification,
  ClassifyApiRequestBody,
  ClassifyRequestBlock,
  StageUsage,
} from '@/app/tools/transcriber/lib/types';

/** One automatic re-ask on upstream failure / invalid JSON — same policy as the correct route. */
const CLASSIFY_MODEL_ATTEMPTS = 2;

/** Hard cap on blocks per request — one classification window should never come close. */
const MAX_BLOCKS_PER_REQUEST = 500;

function parseRequestBlocks(value: unknown): ClassifyRequestBlock[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BLOCKS_PER_REQUEST) return null;
  const blocks: ClassifyRequestBlock[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      record.id.length === 0 ||
      typeof record.speaker !== 'string' ||
      typeof record.text !== 'string' ||
      seenIds.has(record.id)
    ) {
      return null;
    }
    seenIds.add(record.id);
    blocks.push({ id: record.id, speaker: record.speaker, text: record.text });
  }
  return blocks;
}

export async function POST(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAdminUser(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  let body: ClassifyApiRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const blocks = parseRequestBlocks(body.blocks);
  if (!blocks) {
    return NextResponse.json(
      { error: 'blocks is required: a non-empty array of {id, speaker, text}.' },
      { status: 400 },
    );
  }

  const prompt = buildClassifyPrompt(blocks, typeof body.contextNotes === 'string' ? body.contextNotes : '');
  const modelId = resolveGeminiModelId(body.model, ARGUMENT_CLASSIFIER_GEMINI_MODEL);
  const responseSchema = buildClassifyResponseSchema();
  const allowedIds = blocks.map((b) => b.id);

  let classifications: BlockClassification[] | null = null;
  let invalidCount = 0;
  let usage: StageUsage | undefined;
  let requests = 0;
  let lastError = 'Argument classification failed.';
  for (let attempt = 0; attempt < CLASSIFY_MODEL_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      // NOTE: never log `prompt` or `raw` — the prompt contains transcript contents.
      requests += 1;
      const result = await callGeminiWithUsage(prompt, key, {
        modelId,
        temperature: CORRECTION_TEMPERATURE,
        responseSchema,
      });
      raw = result.text;
      // Accumulate tokens from every successful provider response — even one
      // whose output later fails local validation below and triggers a
      // retry — never just the final winning attempt's tokens.
      if (result.usage) usage = accumulateStageUsage(usage, result.usage, requests);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Argument classification failed.';
      continue;
    }

    let parsed;
    try {
      // Server-side validation: unknown ids and invalid tags never reach the client.
      parsed = parseClassifyResponse(raw, allowedIds);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Classifier returned an unexpected response.';
      continue;
    }

    if (parsed.invalidCount > 0) {
      // The model attempted output but some of it didn't validate — distinct
      // from a genuinely empty response. Keep the valid subset as a
      // fallback and retry once for a cleaner sample; if this was the last
      // attempt, the valid subset ships with a warning rather than silently
      // looking like a clean no-op.
      classifications = parsed.classifications;
      invalidCount = parsed.invalidCount;
      lastError = `Classifier returned ${parsed.invalidCount} invalid item(s).`;
      continue;
    }

    classifications = parsed.classifications;
    invalidCount = 0;
    break;
  }

  if (classifications === null) {
    return NextResponse.json({ error: lastError }, { status: 502 });
  }

  return NextResponse.json({
    classifications,
    ...(invalidCount > 0
      ? {
          warning: `Classifier returned ${invalidCount} invalid item(s) after ${requests} attempt(s); applying the valid subset.`,
        }
      : {}),
    ...(usage ? { usage } : {}),
  });
}
