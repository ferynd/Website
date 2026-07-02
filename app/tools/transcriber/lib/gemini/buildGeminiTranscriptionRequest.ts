// Builds the Gemini `generateContent` request body for one direct-
// transcription window (or the whole file, when isFullFile is true). Pure —
// no fetch, no file access — so it's unit-testable without a live upload.
// Used by app/api/transcriber/gemini/window/route.ts.
//
// Relative imports here deliberately (see note at top of ../settings.ts) —
// this module is imported directly by vitest.

/** NOTE: Gemini direct transcription has no acoustic speaker-reference
 * support (unlike the OpenAI diarized path, which can attach known-speaker
 * clips) — speaker identity here is entirely prompt-inferred from the names,
 * optional voice notes, and context given below. Callers surface this as
 * "prompt-inferred" in the UI/debug JSON (see runDebug.ts). */

/** One experimental voice-reference clip (settings.geminiReferenceClips, default OFF — see the plan's "Gemini experimental refs" section). Gemini has no acoustic speaker-reference support the way OpenAI's diarized model does; these are appended as plain labeled audio parts and the model is told they're an extra (unreliable) signal, not a guarantee. */
export interface GeminiVoiceReference {
  name: string;
  mimeType: string;
  /** Base64-encoded audio bytes (no `data:` prefix) — Gemini's `inlineData.data` field expects this shape. */
  dataBase64: string;
}

export interface BuildGeminiTranscriptionRequestInput {
  fileUri: string;
  mimeType: string;
  /** Absolute seconds from the start of the recording. */
  windowStart: number;
  windowEnd: number;
  speakerNames: string[];
  /** Parallel to speakerNames — speakerNotes[i] is the voice/speaking-style note for speakerNames[i], if any. */
  speakerNotes?: string[];
  contextNotes?: string;
  /** True when this call's audio (the fileData part below) is the entire
   * recording (see GEMINI_SINGLE_CALL_MAX_SECONDS) — false means the audio
   * is a genuine slice of the recording starting at `windowStart` (see
   * lib/providers/geminiProvider.ts's per-window slicing via
   * decodeAudioMono16k.ts), which changes how the timestamp instructions
   * below are worded. */
  isFullFile: boolean;
  /** Experimental voice-reference clips — absent/empty by default. When present, appended as labeled inlineData parts AFTER the main fileData part (see buildGeminiTranscriptionRequest below). */
  references?: GeminiVoiceReference[];
}

type GeminiRequestPart =
  | { text: string }
  | { fileData: { fileUri: string; mimeType: string } }
  | { inlineData: { mimeType: string; data: string } };

/* ------------------------------------------------------------ */
/* CONFIGURATION: transcription generationConfig                 */
/* ------------------------------------------------------------ */

/** Low temperature — transcription is a precision task, not a creative one (mirrors CORRECTION_TEMPERATURE). */
const TRANSCRIPTION_TEMPERATURE = 0.1;

const SEGMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    start: { type: 'STRING' },
    end: { type: 'STRING' },
    speaker: { type: 'STRING' },
    text: { type: 'STRING' },
  },
  required: ['start', 'end', 'speaker', 'text'],
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: SEGMENT_SCHEMA,
    },
  },
  required: ['segments'],
};

/**
 * Formats seconds as `H:MM:SS` (hours NOT zero-padded — Gemini's own
 * timestamp examples and the plan's window-instruction wording use this
 * shape, distinct from formatTranscript.ts's zero-padded `HH:MM:SS` used in
 * the app's own transcript output).
 */
function formatWindowTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

function buildSpeakerNotesLines(speakerNames: string[], speakerNotes?: string[]): string[] {
  if (!speakerNotes) return [];
  const entries = speakerNames
    .map((name, i) => ({ name, note: (speakerNotes[i] ?? '').trim() }))
    .filter((entry) => entry.note.length > 0);
  if (entries.length === 0) return [];
  return [`Speaker voice/speaking-style notes: ${entries.map((e) => `${e.name} — ${e.note}`).join('; ')}.`];
}

function buildPrompt(input: BuildGeminiTranscriptionRequestInput): string {
  const speakerList = input.speakerNames.length ? input.speakerNames.join(', ') : '(none provided)';

  const lines = [
    'You are transcribing a personal audio recording of a real conversation, verbatim, for the person who recorded it. This is a preservation-first pass: your job is an accurate speech-to-text transcription, not a summary or a cleaned-up version.',
    '- Transcribe every word actually spoken, exactly as spoken: keep false starts, filler words ("um", "uh"), repetitions, interruptions, and unfinished sentences. Do NOT summarize, paraphrase, sanitize, or add commentary of any kind.',
    '- Do NOT infer or invent words that were not actually said — never complete a sentence or fill in a thought that trails off.',
    '- Break the transcript into segments along natural utterance boundaries (a speaker turn, or a natural pause within a long turn) — do not produce one giant segment for the whole window.',
  ];

  if (input.isFullFile) {
    lines.push(
      `- Every segment's "start" and "end" must be an absolute timestamp measured from the very beginning of the recording, formatted as H:MM:SS (e.g. "0:10:00", "1:02:15").`,
    );
  } else {
    const clipStart = formatWindowTimestamp(input.windowStart);
    const clipEnd = formatWindowTimestamp(input.windowEnd);
    lines.push(
      `- This audio clip is a short excerpt from a longer recording, NOT the whole recording — it covers only ${clipStart} to ${clipEnd} of the full recording and does not start at 0:00:00 of the full recording.`,
      `- Every segment's "start" and "end" must still be an absolute timestamp measured from the very beginning of the FULL recording, NOT relative to the start of this clip: take the position where you hear something within this clip and add ${clipStart} to it. Format as H:MM:SS (e.g. "0:10:00", "1:02:15").`,
    );
  }

  lines.push(
    `- Known speakers in this conversation: ${speakerList}. Use exactly one of these names for every segment when you can identify the speaker. Never invent a name that is not in this list.`,
    '- If you are not confident who is speaking, use exactly the string "Unknown". Do not guess.',
  );

  lines.push(...buildSpeakerNotesLines(input.speakerNames, input.speakerNotes));

  if (input.references && input.references.length > 0) {
    lines.push(
      `- Experimental: voice reference samples are provided after the main recording for: ${input.references.map((r) => r.name).join(', ')}. Use them only as an extra, unreliable signal to help judge who is speaking when the conversation itself is ambiguous — never override clear context/turn-taking evidence just because a voice sounds similar to a reference.`,
    );
  }

  if (input.contextNotes?.trim()) {
    lines.push(`- Additional context from the user: ${input.contextNotes.trim()}`);
  }

  lines.push(
    '',
    'Respond with ONLY the structured JSON output described by the response schema — no prose, no markdown code fences.',
  );

  return lines.join('\n');
}

/**
 * Builds the full `generateContent` request body: one user turn with the
 * prompt as text, followed by the uploaded file as a fileData part (order
 * matters for the tests below and is the documented Gemini convention —
 * instructions first, then the media they apply to).
 */
export function buildGeminiTranscriptionRequest(input: BuildGeminiTranscriptionRequestInput) {
  const parts: GeminiRequestPart[] = [
    { text: buildPrompt(input) },
    { fileData: { fileUri: input.fileUri, mimeType: input.mimeType } },
  ];

  for (const reference of input.references ?? []) {
    parts.push({ text: `Reference sample of ${reference.name}'s voice:` });
    parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.dataBase64 } });
  }

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      temperature: TRANSCRIPTION_TEMPERATURE,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}
