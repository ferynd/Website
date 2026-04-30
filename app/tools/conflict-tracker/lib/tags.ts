"use client";

export const DEFAULT_TAGS: string[] = [
  'Misunderstanding',
  'Repeated unmet need',
  'Hurt turned into anger',
  'Feeling dismissed',
  'Feeling unsafe',
  'Defensiveness',
  'Raised voice',
  'Shutdown',
  'Repair attempt',
  'Repair missed',
  'Repair successful',
  'Felt cared for',
  'Felt punished for sharing',
  'Needed reassurance',
  'Needed space',
  'Needed accountability',
  'Needed clarity',
];

export const allTags = (customTags: string[]): string[] => {
  const combined = [...DEFAULT_TAGS];
  for (const tag of customTags) {
    if (!combined.includes(tag)) {
      combined.push(tag);
    }
  }
  return combined;
};

export const parseTags = (input: string): string[] =>
  input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
