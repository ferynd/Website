export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTitle } from '@/app/tools/shows/lib/titleResolver';
import type { ClassifyRequestBody } from '@/app/tools/shows/lib/classifyTypes';
import type { ShowType } from '@/app/tools/shows/types';

const ALLOWED_TYPES = new Set<string>(['anime', 'tv', 'movie', 'animated_movie', 'cartoon']);

export async function POST(req: NextRequest) {
  let body: ClassifyRequestBody & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  if (!rawTitle) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400 });
  }

  // Determine if the type hint was explicitly chosen by the user
  const typeHintWasUserSelected =
    body.typeHintWasUserSelected === true ||
    // legacy field: if sent as typeHintWasUserSelected explicitly
    false;

  const rawTypeHint = body.typeHint ?? (body.type as string | undefined) ?? null;
  const typeHint: ShowType | null =
    rawTypeHint && ALLOWED_TYPES.has(rawTypeHint) && typeHintWasUserSelected
      ? (rawTypeHint as ShowType)
      : null;

  const tmdbApiKey = process.env.TMDB_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  try {
    const result = await resolveTitle({
      title: rawTitle,
      typeHint,
      typeHintWasUserSelected,
      tmdbApiKey,
      geminiApiKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Classification failed.';
    // Never expose API keys in error messages
    const safe = message.replace(/key=[^&\s]*/gi, 'key=***');
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
