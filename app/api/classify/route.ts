export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { VIBE_CATEGORIES } from '@/app/tools/shows/lib/vibeCategories';
import { callGemini } from '@/app/lib/aiConfig';
import type { ShowType } from '@/app/tools/shows/types';

const ALLOWED_TYPES = new Set<string>(['anime', 'tv', 'movie', 'animated_movie']);

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured. Ensure it is set as a Secret in Cloudflare.' }, { status: 500 });
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
    `Title: "${title.trim()}"\n\n` +
    `Return JSON with three fields:\n` +
    `1. "type": one of "anime", "tv", "movie", "animated_movie"\n` +
    `2. "vibes": array of 2 to 4 tags from this exact list (no others): ${VIBE_CATEGORIES.join(', ')}\n` +
    `3. "description": a 1 to 3 sentence description capturing tone, themes, and any standout traits. Max 200 characters. No spoilers. No generic plot summary.\n\n` +
    `Return JSON only. No prose, no markdown, no code fences.`;

  let raw: string;
  try {
    raw = await callGemini(prompt, key);
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

  // Validate and normalize type
  const rawType = typeof obj.type === 'string' ? obj.type : '';
  const resolvedType: ShowType = ALLOWED_TYPES.has(rawType)
    ? (rawType as ShowType)
    : 'anime';

  // Validate and normalize vibes
  const allowed = new Set<string>(VIBE_CATEGORIES);
  const rawVibes = Array.isArray(obj.vibes) ? obj.vibes : [];
  const vibes = (rawVibes as unknown[])
    .filter((t): t is string => typeof t === 'string' && allowed.has(t))
    .slice(0, 4);

  // Validate and normalize description
  const rawDescription = typeof obj.description === 'string' ? obj.description : '';
  const description = rawDescription.slice(0, 200);

  return NextResponse.json({ type: resolvedType, vibes, description });
}
