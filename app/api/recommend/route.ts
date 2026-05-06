export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import type { Show } from '@/app/tools/shows/types';
import type { MoodEntry, HistoryEntry } from '@/app/tools/shows/lib/recommendationContext';
import { callGemini, RECOMMEND_TEMPERATURE } from '@/app/lib/aiConfig';

interface RecommendBody {
  moods: Record<string, MoodEntry>;
  candidates: Show[];
  history: Record<string, HistoryEntry>;
  excludeIds?: string[];
}

const BRAIN_POWER_LABELS: Record<number, string> = {
  1: 'braindead/background-friendly',
  2: 'easy watch',
  3: 'normal focus',
  4: 'pay attention',
  5: 'dense/thought-provoking',
};

function buildPrompt(
  moods: Record<string, MoodEntry>,
  candidates: Show[],
  history: Record<string, HistoryEntry>,
): string {
  const moodLines = Object.values(moods)
    .map((m) => `  ${m.name}: ${m.mood || '(no input)'}`)
    .join('\n');

  const historyLines = Object.values(history)
    .map((h) => {
      const shows =
        h.highScoringShows.length > 0
          ? h.highScoringShows
              .map((s) => {
                const parts = [
                  `    - "${s.title}"`,
                  `vibes: ${s.vibes.join(', ')}`,
                  `score: ${s.composite.toFixed(1)}`,
                ];
                if (s.description) parts.push(`desc: ${s.description}`);
                if (s.note) parts.push(`note: ${s.note}`);
                return parts.join(' | ');
              })
              .join('\n')
          : '    (no high-scoring history yet)';
      return `  ${h.name}'s high-scoring shows (≥7):\n${shows}`;
    })
    .join('\n\n');

  const candidateLines = candidates
    .map((s) => {
      const ep =
        s.currentSeason !== null || s.currentEpisode !== null
          ? ` | progress: S${s.currentSeason ?? '?'} E${s.currentEpisode ?? '?'}`
          : '';
      const vibes = s.vibeTags.length > 0 ? s.vibeTags.join(', ') : 'no tags';
      const bp =
        s.brainPower != null
          ? `${s.brainPower}/5 (${BRAIN_POWER_LABELS[s.brainPower] ?? ''})`
          : 'unknown';

      const parts = [
        `  - id:${s.id}`,
        `"${s.title}" (${s.type})`,
        `status: ${s.status}${ep}`,
        `vibes: ${vibes}`,
        `brain power: ${bp}`,
      ];
      if (s.service) parts.push(`service: ${s.service}`);
      if (s.description) parts.push(`desc: ${s.description}`);

      // Per-person notes labeled by watcher
      const memberNotes = s.memberNotes ?? {};
      const noteEntries = Object.entries(memberNotes).filter(([, v]) => v.trim());
      if (noteEntries.length > 0) {
        parts.push(`notes: ${noteEntries.map(([uid, n]) => `[${uid}] ${n}`).join(' / ')}`);
      } else if (s.notes) {
        parts.push(`notes: ${s.notes}`);
      }

      return parts.join(' | ');
    })
    .join('\n');

  return (
    `Pick one show for these people to watch together right now.\n\n` +
    `WHO IS WATCHING AND THEIR MOODS:\n${moodLines}\n\n` +
    `THEIR HIGH-SCORING HISTORY (shows they loved):\n${historyLines}\n\n` +
    `CANDIDATE SHOWS (choose exactly one id from this list):\n${candidateLines}\n\n` +
    `DECISION WEIGHTS (apply in this order):\n` +
    `1. VIBES FIRST: Match candidate vibe tags to each person's current mood and to the vibes of their high-scoring history. This is the strongest signal.\n` +
    `2. BRAIN POWER: When moods mention tired, braindead, chill, or low focus → strongly prefer brain power 1-2. When moods mention engaged, thoughtful, mystery, or ready to focus → allow brain power 3-5. Unknown brain power is neutral.\n` +
    `3. SCORE HISTORY: Favor candidates whose vibes overlap with each person's high-scoring history.\n` +
    `4. NOTES IF RELEVANT: Personal notes are high-signal when directly relevant to the current mood or situation. Ignore unrelated trivia.\n` +
    `5. DESCRIPTION: Use as light context/tiebreaker.\n\n` +
    `Return JSON only (no prose, no markdown, no code fences):\n` +
    `{ "showId": "<id from list above>", "reason": "<2-3 sentences>" }\n\n` +
    `The reason should lead with the vibe match. Mention brain power if it was a factor. Bring in notes only if a note materially shaped the pick.`
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
