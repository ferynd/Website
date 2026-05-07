import type { Show } from '../types';
import type { MoodEntry, ViewerPreferenceProfile, RatedShowEntry } from './recommendationContext';
import { memberComposite } from './compositeScore';
import { inferFocusLevel, inferVibeKeywords, computeCandidatePreScore } from './preScore';

const BRAIN_POWER_LABELS: Record<number, string> = {
  1: 'braindead/background',
  2: 'easy watch',
  3: 'normal focus',
  4: 'pay attention',
  5: 'dense/thought-provoking',
};

function formatRatedEntry(e: RatedShowEntry): string {
  const parts = [`"${e.title}"`, `score:${e.composite.toFixed(1)}`];
  if (e.wouldRewatch) parts.push(`wr:${e.wouldRewatch}`);
  if (e.brainPower != null) parts.push(`brain:${e.brainPower}/5`);
  const vibes = e.vibeTags.length > 0 ? e.vibeTags.join('/') : '';
  if (vibes) parts.push(`vibes:${vibes}`);
  if (e.note) parts.push(`note:"${e.note}"`);
  return parts.join(' ');
}

export function buildPrompt(
  moods: Record<string, MoodEntry>,
  candidates: Show[],
  profiles: Record<string, ViewerPreferenceProfile>,
  sharedMood?: string,
): string {
  const presentUids = Object.keys(moods);

  // UID → display name for present viewers
  const uidToName: Record<string, string> = {};
  for (const [uid, entry] of Object.entries(moods)) {
    uidToName[uid] = entry.name;
  }

  // Infer combined focus level and vibe preferences from all mood text
  const allMoodText = [sharedMood ?? '', ...Object.values(moods).map((m) => m.mood)].join(' ');
  const focusLevel = inferFocusLevel(allMoodText);
  const vibeKeywords = inferVibeKeywords(allMoodText);

  // --- SHARED VIBE (highest priority) ---
  const sharedMoodSection = sharedMood?.trim()
    ? `TONIGHT'S VIBE (highest priority — parse each named person's mood from this):\n"${sharedMood.trim()}"\n\n`
    : '';

  // --- PER-PERSON MOOD (secondary) ---
  const hasMoods = Object.values(moods).some((m) => m.mood.trim());
  const moodSection = hasMoods
    ? `PER-PERSON MOOD (secondary context):\n` +
      Object.values(moods)
        .map((m) => `  ${m.name}: ${m.mood || '(no input)'}`)
        .join('\n') +
      '\n\n'
    : '';

  // --- VIEWER PREFERENCE PROFILES ---
  const profileSection =
    `VIEWER PREFERENCE PROFILES (taste evidence — use all rating bands, not just high scores):\n` +
    Object.values(profiles)
      .map((p) => {
        const lines: string[] = [`  ${p.name}:`];
        if (p.stronglyLiked.length > 0) {
          lines.push(`    Loved (8–10): ${p.stronglyLiked.map(formatRatedEntry).join(' | ')}`);
        }
        if (p.conditionallyLiked.length > 0) {
          lines.push(
            `    Liked conditionally (6–7.9, great if tonight's mood matches): ${p.conditionallyLiked.map(formatRatedEntry).join(' | ')}`,
          );
        }
        if (p.weaklyLiked.length > 0) {
          lines.push(
            `    Mixed (4–5.9, use cautiously): ${p.weaklyLiked.map(formatRatedEntry).join(' | ')}`,
          );
        }
        if (p.disliked.length > 0) {
          lines.push(`    Disliked (<4): ${p.disliked.map((e) => `"${e.title}"`).join(', ')}`);
        }
        if (p.notedButUnrated.length > 0) {
          lines.push(
            `    Noted but unrated: ${p.notedButUnrated.map((e) => `"${e.title}" note:"${e.note}"`).join(' | ')}`,
          );
        }
        if (
          p.stronglyLiked.length === 0 &&
          p.conditionallyLiked.length === 0 &&
          p.weaklyLiked.length === 0 &&
          p.disliked.length === 0 &&
          p.notedButUnrated.length === 0
        ) {
          lines.push(`    (no rating history yet)`);
        }
        return lines.join('\n');
      })
      .join('\n\n') +
    '\n\n';

  // --- CANDIDATES with per-viewer signals and pre-scores ---
  const candidateLines = candidates
    .map((s) => {
      const ep =
        s.currentSeason !== null || s.currentEpisode !== null
          ? ` S${s.currentSeason ?? '?'}E${s.currentEpisode ?? '?'}`
          : '';
      const vibes = s.vibeTags.length > 0 ? s.vibeTags.join(', ') : 'none';
      const bp =
        s.brainPower != null
          ? `${s.brainPower}/5 (${BRAIN_POWER_LABELS[s.brainPower] ?? ''})`
          : 'unknown';

      const preScore = computeCandidatePreScore(s, focusLevel, vibeKeywords, presentUids);
      const preScoreStr = `preScore: brain=${preScore.brainPowerMatch.toFixed(0)} vibe=${preScore.vibeFit.toFixed(0)} overall=${preScore.overallPreScore.toFixed(1)}`;

      // Per-viewer rating signals
      const viewerSignals = presentUids
        .map((uid) => {
          const rating = s.ratings[uid];
          const name = uidToName[uid] ?? uid;
          const note = s.memberNotes?.[uid] ?? s.notes ?? '';
          if (!rating) {
            return note.trim() ? `${name}: unrated note:"${note}"` : `${name}: unrated`;
          }
          const composite = memberComposite(rating);
          const scorePart = composite !== null ? `${composite.toFixed(1)}/10` : 'partial';
          const parts = [`${name}: ${scorePart}`];
          if (rating.wouldRewatch) parts.push(`wr:${rating.wouldRewatch}`);
          if (note.trim()) parts.push(`note:"${note}"`);
          return parts.join(' ');
        })
        .join(' | ');

      // Notes from absent viewers (extra context)
      const memberNotes = s.memberNotes ?? {};
      const absentNotes = Object.entries(memberNotes)
        .filter(([uid, v]) => !presentUids.includes(uid) && v.trim())
        .map(([uid, n]) => `[${uidToName[uid] ?? uid}] ${n}`)
        .join(' / ');

      const lines = [
        `  - id:${s.id} | "${s.title}" (${s.type}) | vibes: ${vibes} | brain: ${bp} | status: ${s.status}${ep}`,
        `    viewers: ${viewerSignals}`,
        `    ${preScoreStr}`,
      ];
      if (s.service) lines.push(`    service: ${s.service}`);
      if (s.description) lines.push(`    desc: ${s.description}`);
      if (absentNotes) lines.push(`    absent viewer notes: ${absentNotes}`);

      return lines.join('\n');
    })
    .join('\n');

  // --- DECISION RULES ---
  const rules =
    `DECISION RULES (apply in this order):\n` +
    `1. PARSE TONIGHT'S VIBE FIRST: From the shared vibe text, identify each named person's energy and mood. ` +
    `"brain dead", "tired", "drained", "multitasking", "background", "low focus", "low energy" → strong LOW brain-power signal. ` +
    `"funny", "exciting", "chill", "romantic", etc. → vibe preferences. ` +
    `When two viewers want different things, pick the best compromise.\n` +
    `2. BRAIN POWER FIT: When anyone is tired, brain dead, or multitasking → strongly prefer brain power 1–2. ` +
    `A 6/10 show with brain power 1 beats a 9/10 show with brain power 5 when someone is exhausted. Unknown brain power is neutral.\n` +
    `3. MOOD AND VIBE MATCH: Match show vibe tags to inferred mood. ` +
    `"funny" → Comedy/Humor/Lighthearted. "exciting" → Action/Thrilling. "chill" → Cozy/Relaxing. Strong vibe overlap = strong positive signal.\n` +
    `4. USE ALL RATING BANDS AS TASTE EVIDENCE:\n` +
    `   - 8–10 (Loved): strong signal they enjoy this show's style\n` +
    `   - 6–7.9 (Conditionally liked): excellent pick if tonight's mood matches this show's vibes\n` +
    `   - 4–5.9 (Mixed): use cautiously\n` +
    `   - <4 (Disliked): negative signal — avoid similar vibes/style\n` +
    `   - wouldRewatch=yes: extra positive signal | wouldRewatch=no: mild negative signal\n` +
    `   - Unrated but noted: read the note for qualitative signal\n` +
    `5. DO NOT simply pick the highest-rated show. Pre-scores are hints, not final answers. ` +
    `A mid-rated show with perfect brain-power and vibe fit beats a high-rated show that is wrong for tonight.\n` +
    `6. NOTES: High-signal when directly relevant to tonight's mood. Ignore unrelated trivia.\n\n`;

  const jsonInstruction =
    `Return JSON only (no markdown, no prose, no code fences):\n` +
    `{ "showId": "<id from list above>", "reason": "<2–4 sentences: how it matched tonight's mood, brain power fit if relevant, how it balanced both viewers, any key rating or note signal that mattered>" }\n\n` +
    `The showId must be one of the candidate IDs listed above. Do not invent IDs.`;

  return (
    `Pick one show for these people to watch together tonight.\n\n` +
    sharedMoodSection +
    moodSection +
    profileSection +
    `CANDIDATE SHOWS (choose exactly one id from this list):\n${candidateLines}\n\n` +
    rules +
    jsonInstruction
  );
}
