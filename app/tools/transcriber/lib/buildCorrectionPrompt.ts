// Sparse text-correction prompt: the model receives every segment in the
// window (stable id + speaker + text) but returns ONLY the segments whose
// text it actually changed, as {"patches": [{"id", "text"}]}. Speakers are
// context — speaker repair is a separate stage (lib/speakerRepair.ts) and
// argument classification another (lib/argumentClassify.ts); neither happens
// here anymore.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import { formatTimestamp } from './formatTranscript';
import type { CorrectionRequestSegment, TranscriptionMode } from './types';

export interface CorrectionPromptInput {
  segments: CorrectionRequestSegment[];
  speakerNames: string[];
  contextNotes: string;
  mode: TranscriptionMode;
}

/**
 * Builds the strict-JSON-out sparse correction prompt. Timestamps are shown
 * to the model for readability/context only — the app is the source of
 * truth for start/end times. The model returns only changed segments; ids
 * are stable and validated server-side, so it can never add, delete, split,
 * merge, or reorder segments.
 */
export function buildCorrectionPrompt(input: CorrectionPromptInput): string {
  const speakerList = input.speakerNames.length ? input.speakerNames.join(', ') : '(none provided)';

  const lines = input.segments.map((seg) => ({
    id: seg.id,
    start: formatTimestamp(seg.start),
    speaker: seg.speaker,
    text: seg.text,
  }));

  const rules = [
    'You are correcting a raw speech-to-text transcript. This is a preservation-first pass: your job is to fix transcription mistakes, not to improve how anyone sounds. Follow these rules exactly:',
    '- Do NOT summarize, rewrite, paraphrase, sanitize, therapize, or add analysis or commentary.',
    '- Do NOT infer or invent content that was not actually said — never complete a sentence or fill in a thought that trails off.',
    '- Preserve the original wording as closely as possible: misspeaking, false starts, unfinished thoughts, interruptions, repeated words, filler, profanity, and emotionally important or upsetting phrasing all stay exactly as spoken.',
    "- Treat each segment as an independent unit: every fix happens entirely within that one segment's own text. Never move words between segments.",
    '- You may fix an obvious automatic-speech-recognition (ASR) error only when context strongly supports the correction, plus punctuation and formatting.',
    `- Known speakers in this conversation (context only): ${speakerList}. Speaker labels are shown for context and may contain mistakes — do NOT correct them; a separate pass handles speakers.`,
  ];

  if (input.contextNotes.trim()) {
    rules.push(`- Additional context from the user: ${input.contextNotes.trim()}`);
  }

  const instructions = [
    '',
    'Respond with ONLY a strict JSON object (no prose, no markdown code fences) of exactly this shape:',
    '{"patches": [{"id": string, "text": string}]}',
    'Include one patch ONLY for each segment whose text you actually changed, reusing that segment\'s exact "id". Do NOT include unchanged segments. Most segments need no changes — an empty patches array is a perfectly good response.',
    'Never invent an id, and never return the same id twice.',
    '',
    `Input segments (JSON): ${JSON.stringify(lines)}`,
  ];

  return [...rules, ...instructions].join('\n');
}

/**
 * Gemini structured-output `responseSchema` matching the sparse patch shape
 * above (same uppercase type-name convention as
 * lib/gemini/buildGeminiTranscriptionRequest.ts). Constraining the response
 * server-side eliminates markdown fences, prose preambles, and malformed
 * items.
 */
export function buildCorrectionResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      patches: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            text: { type: 'STRING' },
          },
          required: ['id', 'text'],
        },
      },
    },
    required: ['patches'],
  };
}
