import { formatTimestamp } from './formatTranscript';
import type { IndexedTranscriptSegment, TranscriptionMode } from './types';

export interface CorrectionPromptInput {
  segments: IndexedTranscriptSegment[];
  speakerNames: string[];
  contextNotes: string;
  mode: TranscriptionMode;
}

/**
 * Builds the strict-JSON-out correction prompt. Timestamps are shown to the
 * model for readability/context only — the app is the source of truth for
 * start/end times, so the model is asked to return only index/speaker/text
 * and can never actually change a timestamp.
 */
export function buildCorrectionPrompt(input: CorrectionPromptInput): string {
  const speakerList = input.speakerNames.length ? input.speakerNames.join(', ') : '(none provided)';

  const lines = input.segments.map((seg) => ({
    index: seg.index,
    start: formatTimestamp(seg.start),
    speaker: seg.speaker,
    text: seg.text,
  }));

  const rules = [
    'You are correcting a raw speech-to-text transcript. Follow these rules exactly:',
    '- Do NOT summarize, rewrite, paraphrase, or add analysis or commentary.',
    '- Preserve the original wording as closely as possible. Keep interruptions, fragments, repeated words, and emotionally important phrasing.',
    '- Do not sanitize or soften the language.',
    '- You may fix obvious transcription errors, punctuation, and formatting issues only.',
    '- You may correct obvious speaker misattributions using context, turn-taking, and speaking style.',
    `- Known speakers in this conversation: ${speakerList}.`,
    input.mode === 'fallback'
      ? '- This transcript has NO existing speaker labels (every segment is currently "Unknown"). Infer who is speaking for each line from context and turn-taking.'
      : '- This transcript already has speaker labels, which may contain mistakes. Fix clear mistakes only — do not relabel lines you are not confident about.',
    '- If you are not confident who is speaking, use exactly the string "Unknown". Do not guess.',
  ];

  if (input.contextNotes.trim()) {
    rules.push(`- Additional context from the user: ${input.contextNotes.trim()}`);
  }

  const instructions = [
    '',
    'Respond with ONLY a strict JSON array (no prose, no markdown code fences). Each element must be exactly:',
    '{"index": number, "speaker": string, "text": string}',
    'Return exactly one output element per input segment below, reusing the same "index" values. Do not add, remove, merge, or split segments. Timestamps are not part of your output — the app preserves them.',
    '',
    `Input segments (JSON): ${JSON.stringify(lines)}`,
  ];

  return [...rules, ...instructions].join('\n');
}
