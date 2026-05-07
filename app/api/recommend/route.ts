export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import type { MoodEntry, HistoryEntry } from '@/app/tools/shows/lib/recommendationContext';
import type { Show } from '@/app/tools/shows/types';
import { buildPrompt } from '@/app/tools/shows/lib/buildRecommendPrompt';
import { callGemini, RECOMMEND_TEMPERATURE } from '@/app/lib/aiConfig';

interface RecommendBody {
  moods: Record<string, MoodEntry>;
  candidates: Show[];
  history: Record<string, HistoryEntry>;
  excludeIds?: string[];
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  let body: RecommendBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { moods, candidates: allCandidates, history, excludeIds = [] } = body;

  if (!moods || !allCandidates || !history) {
    return NextResponse.json(
      { error: 'moods, candidates, and history are required.' },
      { status: 400 },
    );
  }

  const candidates = allCandidates.filter((s) => !excludeIds.includes(s.id));

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "No more candidates to pick from. You've exhausted the list!" },
      { status: 400 },
    );
  }

  const prompt = buildPrompt(moods, candidates, history);

  let raw: string;
  try {
    raw = await callGemini(prompt, key, RECOMMEND_TEMPERATURE);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();

  let result: { showId?: string; reason?: string };
  try {
    result = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON.' }, { status: 502 });
  }

  const { showId, reason } = result;

  if (!showId || !reason) {
    return NextResponse.json({ error: 'AI response missing showId or reason.' }, { status: 502 });
  }

  const validIds = new Set(candidates.map((s) => s.id));
  if (!validIds.has(showId)) {
    return NextResponse.json(
      { error: 'AI returned an unrecognised show ID. Try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ showId, reason });
}
