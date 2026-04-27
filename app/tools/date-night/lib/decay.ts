/* ------------------------------------------------------------ */
/* CONFIGURATION: decay and frequency cooldown behavior         */
/* ------------------------------------------------------------ */

import type { DateNightFrequency, DateNightPoolItem, DateNightSettings } from './types';

const MS_PER_DAY = 86_400_000;

export const FREQUENCY_COOLDOWN_DAYS: Record<DateNightFrequency, number> = {
  anytime: 0,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  biannual: 182,
  annual: 365,
};

export const weeksSince = (iso?: string, now = Date.now()): number => {
  if (!iso) return 52;
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) return 52;
  return Math.max(0, (now - parsed) / (MS_PER_DAY * 7));
};

export const isEligibleByFrequency = (
  item: DateNightPoolItem,
  options?: { overrideFrequency?: boolean; now?: number },
): boolean => {
  if (options?.overrideFrequency) return true;
  const cooldownDays = FREQUENCY_COOLDOWN_DAYS[item.frequency] ?? 0;
  if (!cooldownDays || !item.lastAcceptedAt) return true;
  const now = options?.now ?? Date.now();
  const elapsedDays = (now - new Date(item.lastAcceptedAt).getTime()) / MS_PER_DAY;
  return !Number.isFinite(elapsedDays) || elapsedDays >= cooldownDays;
};

export const effectiveWeight = (
  item: DateNightPoolItem,
  settings: DateNightSettings,
  options?: { overrideFrequency?: boolean; now?: number },
): number => {
  if (!isEligibleByFrequency(item, options)) return 0;
  const multiplier = item.decayEnabled
    ? Math.min(1 + weeksSince(item.lastAcceptedAt, options?.now) * settings.decayRatePerWeek, settings.decayCap)
    : 1;
  return Math.max(0.0001, item.baseWeight * multiplier);
};
