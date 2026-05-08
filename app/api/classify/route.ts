export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTitle } from '@/app/tools/shows/lib/titleResolver';
import { getTmdbConfig } from '@/app/tools/shows/lib/tmdbConfig';
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

  // Only trust the type hint if the user explicitly selected it in the UI.
  // Treat the form default ("anime") as absent when typeHintWasUserSelected is false.
  const typeHintWasUserSelected = body.typeHintWasUserSelected === true;
  const rawTypeHint = body.typeHint ?? (body.type as string | undefined) ?? null;
  const typeHint: ShowType | null =
    rawTypeHint && ALLOWED_TYPES.has(rawTypeHint) && typeHintWasUserSelected
      ? (rawTypeHint as ShowType)
      : null;

  // Credentials come from Cloudflare Secrets (accessed as process.env on the edge runtime).
  // TMDB_READ_ACCESS_TOKEN is preferred; TMDB_API_KEY is used as fallback.
  // GEMINI_API_KEY is optional — only used for title expansion when no strong match is found.
  const tmdbConfig = getTmdbConfig();
  const geminiApiKey = process.env.GEMINI_API_KEY;

  try {
    const result = await resolveTitle({
      title: rawTitle,
      typeHint,
      typeHintWasUserSelected,
      tmdbConfig,
      geminiApiKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Classification failed.';
    // Sanitize any credential fragments that might appear in error messages.
    const safe = message
      .replace(/api_key=[^&\s]*/gi, 'api_key=***')
      .replace(/Bearer [A-Za-z0-9._-]{8,}/g, 'Bearer ***');
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
