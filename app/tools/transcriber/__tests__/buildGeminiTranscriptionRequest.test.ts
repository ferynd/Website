import { describe, expect, it } from 'vitest';
import { buildGeminiTranscriptionRequest } from '../lib/gemini/buildGeminiTranscriptionRequest';

function baseInput(overrides: Partial<Parameters<typeof buildGeminiTranscriptionRequest>[0]> = {}) {
  return {
    fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
    mimeType: 'audio/mp4',
    windowStart: 0,
    windowEnd: 600,
    speakerNames: ['Kait', 'James'],
    isFullFile: true,
    ...overrides,
  };
}

// The first part of the built request is always the prompt text part, but
// `GeminiRequestPart` is a union (text | fileData | inlineData) — narrow with
// an `in` check rather than casting, so a shape regression would be a type
// error here instead of a silent `undefined`.
function getPromptText(result: ReturnType<typeof buildGeminiTranscriptionRequest>): string {
  const [firstPart] = result.contents[0].parts;
  if (!('text' in firstPart)) {
    throw new Error('Expected the first part to be a text part');
  }
  return firstPart.text;
}

describe('buildGeminiTranscriptionRequest', () => {
  it('puts the text part before the fileData part', () => {
    const result = buildGeminiTranscriptionRequest(baseInput());
    const parts = result.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveProperty('text');
    expect(parts[1]).toEqual({
      fileData: { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', mimeType: 'audio/mp4' },
    });
  });

  it('produces the expected responseSchema shape', () => {
    const result = buildGeminiTranscriptionRequest(baseInput());
    expect(result.generationConfig.responseMimeType).toBe('application/json');
    expect(result.generationConfig.responseSchema).toEqual({
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              start: { type: 'STRING' },
              end: { type: 'STRING' },
              speaker: { type: 'STRING' },
              text: { type: 'STRING' },
            },
            required: ['start', 'end', 'speaker', 'text'],
          },
        },
      },
      required: ['segments'],
    });
  });

  it('uses a low, deterministic temperature', () => {
    const result = buildGeminiTranscriptionRequest(baseInput());
    expect(result.generationConfig.temperature).toBe(0.1);
  });

  it('includes a clip-excerpt + add-the-offset instruction with H:MM:SS timestamps when isFullFile is false', () => {
    const result = buildGeminiTranscriptionRequest(
      baseInput({ isFullFile: false, windowStart: 600, windowEnd: 1215 }),
    );
    const promptText = getPromptText(result);
    expect(promptText).toContain('0:10:00');
    expect(promptText).toContain('0:20:15');
    expect(promptText).toMatch(/short excerpt from a longer recording/);
    expect(promptText).toMatch(/add 0:10:00 to it/);
  });

  it('omits the excerpt/add-offset instruction when isFullFile is true', () => {
    const result = buildGeminiTranscriptionRequest(baseInput({ isFullFile: true }));
    const promptText = getPromptText(result);
    expect(promptText).not.toMatch(/short excerpt from a longer recording/);
    expect(promptText).not.toMatch(/add .* to it/);
  });

  it('formats an hour-plus timestamp as H:MM:SS with an unpadded hour', () => {
    const result = buildGeminiTranscriptionRequest(
      baseInput({ isFullFile: false, windowStart: 3600, windowEnd: 3735 }),
    );
    const promptText = getPromptText(result);
    expect(promptText).toContain('1:00:00');
    expect(promptText).toContain('1:02:15');
  });

  it('embeds the provided speaker names and instructs Unknown for uncertain cases', () => {
    const result = buildGeminiTranscriptionRequest(baseInput({ speakerNames: ['Kait', 'James'] }));
    const promptText = getPromptText(result);
    expect(promptText).toContain('Kait, James');
    expect(promptText).toContain('Unknown');
    expect(promptText).toMatch(/Never invent a name/);
  });

  it('handles an empty speaker list without throwing', () => {
    const result = buildGeminiTranscriptionRequest(baseInput({ speakerNames: [] }));
    const promptText = getPromptText(result);
    expect(promptText).toContain('(none provided)');
  });

  it('includes speaker voice notes only for speakers that have one', () => {
    const result = buildGeminiTranscriptionRequest(
      baseInput({ speakerNames: ['Kait', 'James'], speakerNotes: ['speaks slowly', ''] }),
    );
    const promptText = getPromptText(result);
    expect(promptText).toContain('Kait — speaks slowly');
    expect(promptText).not.toContain('James —');
  });

  it('omits the speaker notes line entirely when no notes are provided', () => {
    const result = buildGeminiTranscriptionRequest(baseInput({ speakerNotes: undefined }));
    const promptText = getPromptText(result);
    expect(promptText).not.toMatch(/voice\/speaking-style notes/);
  });

  it('includes context notes when provided', () => {
    const result = buildGeminiTranscriptionRequest(baseInput({ contextNotes: 'This is a phone call.' }));
    const promptText = getPromptText(result);
    expect(promptText).toContain('This is a phone call.');
  });

  it('requires absolute H:MM:SS timestamps for every segment regardless of isFullFile', () => {
    const full = buildGeminiTranscriptionRequest(baseInput({ isFullFile: true }));
    const windowed = buildGeminiTranscriptionRequest(baseInput({ isFullFile: false }));
    for (const result of [full, windowed]) {
      const promptText = getPromptText(result);
      expect(promptText).toMatch(/absolute timestamp/);
      expect(promptText).toMatch(/H:MM:SS/);
    }
  });

  describe('experimental voice references', () => {
    it('is absent by default (no references field passed)', () => {
      const result = buildGeminiTranscriptionRequest(baseInput());
      expect(result.contents[0].parts).toHaveLength(2);
    });

    it('is absent when references is an empty array', () => {
      const result = buildGeminiTranscriptionRequest(baseInput({ references: [] }));
      expect(result.contents[0].parts).toHaveLength(2);
    });

    it('appends labeled text+inlineData part pairs after the fileData part, in order', () => {
      const result = buildGeminiTranscriptionRequest(
        baseInput({
          references: [
            { name: 'Kait', mimeType: 'audio/wav', dataBase64: 'AAA' },
            { name: 'James', mimeType: 'audio/wav', dataBase64: 'BBB' },
          ],
        }),
      );
      const parts = result.contents[0].parts;
      expect(parts).toHaveLength(6);
      expect(parts[0]).toHaveProperty('text');
      expect(parts[1]).toEqual({
        fileData: { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', mimeType: 'audio/mp4' },
      });
      expect(parts[2]).toEqual({ text: "Reference sample of Kait's voice:" });
      expect(parts[3]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'AAA' } });
      expect(parts[4]).toEqual({ text: "Reference sample of James's voice:" });
      expect(parts[5]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'BBB' } });
    });

    it('mentions reference samples (and their names) in the prompt only when provided', () => {
      const withRefs = buildGeminiTranscriptionRequest(
        baseInput({ references: [{ name: 'Kait', mimeType: 'audio/wav', dataBase64: 'AAA' }] }),
      );
      const withRefsPrompt = getPromptText(withRefs);
      expect(withRefsPrompt).toMatch(/reference/i);
      expect(withRefsPrompt).toContain('Kait');

      const withoutRefs = buildGeminiTranscriptionRequest(baseInput());
      const withoutRefsPrompt = getPromptText(withoutRefs);
      expect(withoutRefsPrompt).not.toMatch(/voice reference samples/i);
    });
  });
});
