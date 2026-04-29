export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import type { Show } from '@/app/tools/shows/types';
import type { MoodEntry, HistoryEntry } from '@/app/tools/shows/lib/recommendationContext';
import { callGemini } from '@/app/lib/aiConfig';

interface RecommendBody {
  moods: Record<string, MoodEntry>;
  candidates: Show[];
  history: Record<string, HistoryEntry>;
  excludeIds?: string[];
}

function buildPrompt(
  moods: Record<string, MoodEntry>,
  candidates: Show[],
  history: Record<string, HistoryEntry>,
): string {
  const moodLines = Object.values(moods)
    .map((m) => `${m.name} is feeling: ${m.mood || '(no input)'}`)
    .join('\n');

  const historyLines = Object.values(history)
    .map((h) => {
      const shows =
        h.highScoringShows.length > 0
          ? h.highScoringShows
              .map((s) => `  - ${s.title}: ${s.vibes.join(', ')} (${s.composite.toFixed(1)})`)
              .join('\n')
          : '  (no high-scoring history yet)';
      return `${h.name}'s high-scoring shows (composite ≥ 7):\n${shows}`;
    })
    .join('\n\n');

  const candidateLines = candidates
    .map((s) => {
      const ep =
        s.currentSeason !== null || s.currentEpisode !== null
          ? ` — S${s.currentSeason ?? '?'} E${s.currentEpisode ?? '?'}`
          : '';
      const vibes = s.vibeTags.length > 0 ? s.vibeTags.join(', ') : 'no tags';
      return `  - id:${s.id} | ${s.title} (${s.type}) | vibes: ${vibes} | status: ${s.status}${ep}`;
    })
    .join('\n');

  return (
    `Pick one show for these people to watch together right now.\n\n` +
    `${moodLines}\n\n` +
    `${historyLines}\n\n` +
    `Available shows (status: watching/planned/on_hold):\n${candidateLines}\n\n` +
    `Pick the show that best fits both moods AND the patterns in what each person has historically rated highly. ` +
    `Prefer shows whose vibes overlap with vibes both people have liked before. ` +
    `Return JSON only (no prose, no markdown): { "showId": "<id from the list above>", "reason": "<2-3 sentences>" }. ` +
    `Reason should explain why this fits both moods and aligns with their history.`
  );
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
    return NextResponse.json({ error: 'moods, candidates, and history are required.' }, { status: 400 });
  }

  const candidates = allCandidates.filter((s) => !excludeIds.includes(s.id));

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: 'No more candidates to pick from. You\'ve exhausted the list!' },
      { status: 400 },
    );
  }

  const prompt = buildPrompt(moods, candidates, history);

  let raw: string;
  try {
    raw = await callGemini(prompt, key);
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
