import type { TranscriptionMode } from './types';

export interface ManualCleanupPromptInput {
  speakerNames: string[];
  contextNotes: string;
  mode: TranscriptionMode;
}

/**
 * Builds a plain-language cleanup prompt meant to be pasted, together with
 * the raw transcript beneath it, into a general-purpose browser AI chat
 * (ChatGPT, Claude, Gemini, etc.) instead of running the built-in Gemini
 * correction pass. Mirrors the rules in buildCorrectionPrompt.ts, but in
 * prose asking for a plain-text reply instead of strict-JSON-out
 * instructions, since a human is pasting this rather than an API parsing it.
 */
export function buildManualCleanupPrompt(input: ManualCleanupPromptInput): string {
  const speakerList = input.speakerNames.length ? input.speakerNames.join(', ') : '(not specified)';

  const lines = [
    'Please clean up the following raw speech-to-text transcript. Follow these rules:',
    '- Do NOT summarize, rewrite, paraphrase, or add analysis or commentary — return the full transcript, corrected.',
    '- Preserve the original wording as closely as possible. Keep interruptions, fragments, repeated words, and emotionally important phrasing.',
    '- Do not sanitize or soften the language.',
    '- You may fix obvious transcription errors, punctuation, and formatting issues.',
    '- You may correct obvious speaker misattributions using context, turn-taking, and speaking style.',
    `- Known speakers in this conversation: ${speakerList}.`,
    input.mode === 'fallback'
      ? '- This transcript has NO existing speaker labels (every line is currently "Unknown"). Infer who is speaking for each line from context and turn-taking.'
      : "- This transcript already has speaker labels, which may contain mistakes. Fix clear mistakes only — don't relabel lines you aren't confident about.",
    '- If you are not confident who is speaking, leave the label as "Unknown" rather than guessing.',
  ];

  if (input.contextNotes.trim()) {
    lines.push(`- Additional context: ${input.contextNotes.trim()}`);
  }

  lines.push(
    '',
    'Keep each line in the same "[HH:MM:SS] Speaker: text" format as the original, one line per line, in the same order. Do not add, remove, merge, or split lines, and do not change the timestamps.',
    '',
    'Transcript to clean up:',
    '',
  );

  return lines.join('\n');
}
