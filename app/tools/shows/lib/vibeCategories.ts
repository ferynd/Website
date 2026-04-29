export const VIBE_CATEGORIES = [
  'Chill',
  'Cozy',
  'Slice of Life',
  'Lighthearted',
  'Funny',
  'Wholesome',
  'Romantic',
  'Adventurous',
  'Action-Packed',
  'Intense',
  'Dark',
  'Emotional',
  'Mind-Bending',
  'Mysterious',
  'Epic',
  'Suspenseful',
  'Horror',
] as const;

export type VibeCategory = (typeof VIBE_CATEGORIES)[number];
