// Pure builder for the speaker-profile read-aloud script shown in
// SpeakerProfilesPanel's "Read-aloud script" disclosure — a fixed,
// speaker-neutral script (only the greeting name changes) so every
// profile's reference clip captures a comparable ~10-20 second sample of
// natural, unscripted-sounding speech.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

/**
 * Builds the read-aloud script for one speaker profile. The name is
 * trimmed and interpolated into the greeting; an empty/blank name falls
 * back to the neutral "this speaker" so the script never renders with a
 * dangling "Hi, this is ."
 */
export function buildVoiceScript(name: string): string {
  const trimmed = name.trim();
  const who = trimmed || 'this speaker';
  return `Hi, this is ${who}. I am recording a short voice sample for speaker identification. Today I walked into the kitchen, poured a glass of water, checked the time, and said that everything was okay. I might speak quickly or slowly depending on how I feel, but this is my normal speaking voice.`;
}
