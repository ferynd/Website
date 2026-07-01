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
    'You are correcting a raw speech-to-text transcript. This is a preservation-first pass: your job is to fix transcription mistakes, not to improve how anyone sounds. Follow these rules exactly:',
    '- Do NOT summarize, rewrite, paraphrase, sanitize, therapize, or add analysis or commentary.',
    '- Do NOT infer or invent content that was not actually said — never complete a sentence or fill in a thought that trails off.',
    '- Preserve the original wording as closely as possible: misspeaking, false starts, unfinished thoughts, interruptions, repeated words, filler, and emotionally important or upsetting phrasing all stay exactly as spoken.',
    '- You may fix an obvious automatic-speech-recognition (ASR) error only when context strongly supports the correction, plus punctuation and formatting.',
    '- You may correct an obvious speaker-label flip (e.g. two adjacent lines are clearly swapped) using context, turn-taking, and speaking style.',
    `- Known speakers in this conversation: ${speakerList}.`,
    input.mode === 'fallback'
      ? '- This transcript has NO existing speaker labels (every segment is currently "Unknown"). Infer who is speaking for each line from context and turn-taking.'
      : '- This transcript already has speaker labels, which may contain mistakes. Fix clear speaker-label flips only — do not relabel anything you are not confident about.',
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
