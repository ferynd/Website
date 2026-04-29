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
  const historyLines = Object.values(history)
    .map((h) => {
      const shows =
        h.highScoringShows.length > 0
          ? h.highScoringShows
              .map((s) => {
                const parts = [
                  `  - ${s.title}`,
                  `vibes: ${s.vibes.join(', ')}`,
                  `composite: ${s.composite.toFixed(1)}`,
                ];
                if (s.description) parts.push(`description: ${s.description}`);
                if (s.notes) parts.push(`notes: ${s.notes}`);
                return parts.join(' | ');
              })
              .join('\n')
          : '  (no high-scoring history yet)';
      return `${h.name}'s high-scoring shows (composite ≥ 7):\n${shows}`;
    })
    .join('\n\n');

  const candidateLines = candidates
    .map((s) => {
      const ep =
        s.currentSeason !== null || s.currentEpisode !== null
          ? ` | current: S${s.currentSeason ?? '?'} E${s.currentEpisode ?? '?'}`
          : '';
      const vibes = s.vibeTags.length > 0 ? s.vibeTags.join(', ') : 'no tags';
      const parts = [
        `  - id:${s.id}`,
        `${s.title} (${s.type})`,
        `vibes: ${vibes}`,
        `status: ${s.status}${ep}`,
      ];
      if (s.description) parts.push(`description: ${s.description}`);
      if (s.notes) parts.push(`notes: ${s.notes}`);
      return parts.join(' | ');
    })
    .join('\n');

  return (
    `Pick one show for these people to watch together right now. Weight your decision in this exact order:\n\n` +
    `1. VIBES FIRST: Match the candidate's vibe tags to what each person is feeling right now, and to the vibes of shows each person has historically rated highly. This is your strongest signal.\n\n` +
    `2. SCORE HISTORY SECOND: Each person's high-scoring shows (composite ≥ 7) show what they tend to enjoy. Favor candidates whose vibes overlap with vibes from each person's high-scoring shows.\n\n` +
    `3. NOTES IF RELEVANT: Personal notes are written by the viewers themselves and are high-signal when they apply. Read each candidate's notes carefully. If a note seems relevant to the current mood or situation (e.g. comments on pacing, content that matches what someone wants tonight, prior watch context), weight it heavily. If a note is unrelated trivia, ignore it. Same for notes on history shows.\n\n` +
    `4. DESCRIPTION FOURTH: AI-generated descriptions add tone and theme nuance. Use as light context and tiebreaker.\n\n` +
    Object.values(moods).map((m) => `${m.name} is feeling: ${m.mood || '(no input)'}`).join('\n') +
    `\n\n${historyLines}\n\n` +
    `Available shows in their watchlist (status: watching/planned/on_hold):\n${candidateLines}\n\n` +
    `Pick one. Return JSON only (no prose, no markdown, no code fences):\n` +
    `{ "showId": "<id from the list above>", "reason": "<2-3 sentences>" }\n\n` +
    `The reason should lead with the vibe match. Mention score-history connection if relevant. Bring in notes only if a note materially shaped the pick. Description is fine to leave unmentioned.`
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
