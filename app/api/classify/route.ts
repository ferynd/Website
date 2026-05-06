export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { VIBE_CATEGORIES } from '@/app/tools/shows/lib/vibeCategories';
import { callGemini, CLASSIFY_TEMPERATURE } from '@/app/lib/aiConfig';
import type { ShowType } from '@/app/tools/shows/types';

const ALLOWED_TYPES = new Set<string>(['anime', 'tv', 'movie', 'animated_movie', 'cartoon']);

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY not configured. Ensure it is set as a Secret in Cloudflare.' },
      { status: 500 },
    );
  }

  let body: { title?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { title, type } = body;
  if (!title?.trim() || !type) {
    return NextResponse.json({ error: 'title and type are required.' }, { status: 400 });
  }

  const prompt =
    `You are classifying a show or movie for a personal watchlist app.\n\n` +
    `Title: "${title.trim()}"\n` +
    `User-selected type hint: "${type}"\n\n` +
    `Return JSON with exactly four fields:\n\n` +
    `1. "canonicalTitle": If you confidently recognize this show or movie, return the best-known canonical English title (e.g. "Welcome to Demon School! Iruma-kun" instead of "Iruma Kun"). If uncertain or it could be multiple things, return the title exactly as given.\n\n` +
    `2. "type": one of "anime", "tv", "movie", "animated_movie", "cartoon"\n` +
    `   Rules:\n` +
    `   - anime = Japanese, Korean, or Chinese animation (anime series, anime films, donghua, manhwa adaptations, Korean animation)\n` +
    `   - cartoon = American/Western animated series (adult animation like Family Guy/South Park, kids cartoons like SpongeBob, CGI series like Bluey)\n` +
    `   - animated_movie = Non-Asian animated feature films (Disney, Pixar, DreamWorks, etc.)\n` +
    `   - tv = Live-action or mostly live-action episodic shows\n` +
    `   - movie = Live-action or mostly live-action feature films\n` +
    `   If you are not confident, use the user's type hint.\n\n` +
    `3. "vibes": array of 2 to 6 tags from this exact list (no others, no new tags):\n` +
    `   ${VIBE_CATEGORIES.join(', ')}\n\n` +
    `4. "description": 1 to 3 sentences capturing tone, themes, and any standout traits. ` +
    `Max 200 characters. No spoilers. No generic plot summary.\n\n` +
    `Return JSON only. No prose, no markdown, no code fences.`;

  let raw: string;
  try {
    raw = await callGemini(prompt, key, CLASSIFY_TEMPERATURE);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const cleaned = jsonMatch ? jsonMatch[0] : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON.' }, { status: 502 });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return NextResponse.json({ error: 'AI response was not an object.' }, { status: 502 });
  }

  const obj = parsed as Record<string, unknown>;

  // canonicalTitle: use AI result if present, fall back to original input
  const rawCanonical = typeof obj.canonicalTitle === 'string' ? obj.canonicalTitle.trim() : '';
  const canonicalTitle = rawCanonical || title.trim();

  // Validate type: if AI returns an unrecognised value, fall back to the user's hint.
  // Never default to 'anime' blindly.
  const rawType = typeof obj.type === 'string' ? obj.type.trim() : '';
  const resolvedType: ShowType = ALLOWED_TYPES.has(rawType)
    ? (rawType as ShowType)
    : ALLOWED_TYPES.has(type)
      ? (type as ShowType)
      : null!;

  if (!resolvedType) {
    return NextResponse.json({ error: 'AI returned an unrecognised type.' }, { status: 502 });
  }

  // Validate and normalize vibes (up to 6)
  const allowed = new Set<string>(VIBE_CATEGORIES);
  const rawVibes = Array.isArray(obj.vibes) ? obj.vibes : [];
  const vibes = (rawVibes as unknown[])
    .filter((t): t is string => typeof t === 'string' && allowed.has(t))
    .slice(0, 6);

  // Validate and normalize description
  const rawDescription = typeof obj.description === 'string' ? obj.description : '';
  const description = rawDescription.slice(0, 200);

  return NextResponse.json({ canonicalTitle, type: resolvedType, vibes, description });
}
