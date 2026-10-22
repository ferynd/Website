import type { DefaultSplit, OverageSplit, SpendCap, Trip, TripParticipant } from '../pageTypes';
import { applyBudgetCaps, buildLedger, type BudgetCapResult, type Ledger } from './ledger';
import { allocateCents, formatMoney, fromCents, parseScaledInput } from './money';

export interface TripSettingsFields {
  spendCaps: SpendCap[];
  overageSplit: OverageSplit;
  defaultSplit: DefaultSplit;
}

export interface TripSettingsDraft {
  caps: Record<string, string>;
  overageType: OverageSplit['type'];
  overageShares: Record<string, string>;
  defaultShares: Record<string, string>;
}

export const STALE_SETTINGS_MESSAGE =
  'The trip changed while you were editing. Review the latest trip before saving anyway.';

/**
 * Revision of the trip document for the stale-edit warning (C13).
 * `updatedAt` is omitted because every write bumps it, including this form's
 * own save, and Firestore often delivers that timestamp in a second snapshot.
 * Expense, participant, and settings changes still change the revision.
 */
export function tripRevision(trip: Trip): string {
  // Sorted keys, so a snapshot that lists the same fields in another order
  // (for example after a first write adds overageSplit) is not "changed".
  return JSON.stringify({ ...trip, updatedAt: undefined }, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

export function settingsAreStale(baseline: string, trip: Trip): boolean {
  return baseline !== tripRevision(trip);
}

export function settingsDraft(trip: Trip): TripSettingsDraft {
  return {
    caps: Object.fromEntries((trip.spendCaps ?? []).map((cap) => [cap.participantId, String(cap.maxAmount)])),
    overageType: trip.overageSplit?.type === 'manual' ? 'manual' : 'even',
    overageShares: Object.fromEntries(
      Object.entries(trip.overageSplit?.shares ?? {}).map(([id, value]) => [id, String(value)]),
    ),
    defaultShares: Object.fromEntries(
      Object.entries(trip.defaultSplit ?? {}).map(([id, value]) => [id, String(value)]),
    ),
  };
}

/** Whole cents, or null when the field is blank or not a non-negative cent amount. */
export function parseCapInput(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = parseScaledInput(raw, 100);
  if (parsed.kind !== 'ok') return null;
  return parsed.units;
}

function dollarsFromInput(raw: string): number {
  const cents = parseCapInput(raw);
  return cents === null ? Number.NaN : fromCents(cents);
}

function percentFromInput(raw: string): number {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

function filledNumbers(
  entries: Record<string, string>,
  ids: string[],
  parse: (raw: string) => number,
): Record<string, number> {
  const known = new Set(ids);
  const result: Record<string, number> = {};
  for (const [id, raw] of Object.entries(entries)) {
    if (!known.has(id) || !raw.trim()) continue;
    result[id] = parse(raw);
  }
  return result;
}

/** Validate every settings group before the caller performs its single write. */
export function validateTripSettings(settings: TripSettingsFields, ids: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const cap of settings.spendCaps) {
    if (!ids.includes(cap.participantId) || seen.has(cap.participantId)) {
      errors.push('Budget caps must refer to distinct travelers on this trip.');
    }
    seen.add(cap.participantId);
    const cents = Number.isFinite(cap.maxAmount) ? parseCapInput(String(cap.maxAmount)) : null;
    if (cap.maxAmount < 0 || cents === null || Math.abs(fromCents(cents) - cap.maxAmount) > 1e-9) {
      errors.push('Budget caps must be non-negative amounts in whole cents.');
    }
  }

  const validateShares = (shares: Record<string, number> | undefined, label: string) => {
    for (const [id, value] of Object.entries(shares ?? {})) {
      if (!ids.includes(id) || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${label} must use known travelers and percentages from 0 to 100.`);
      }
    }
  };

  if (settings.overageSplit.type !== 'even' && settings.overageSplit.type !== 'manual') {
    errors.push('Choose even or custom overage redistribution.');
  }
  validateShares(settings.overageSplit.shares, 'Overage shares');
  if (
    settings.overageSplit.type === 'manual' &&
    !Object.values(settings.overageSplit.shares ?? {}).some((value) => value > 0)
  ) {
    errors.push('Custom overage needs at least one positive share.');
  }

  validateShares(settings.defaultSplit, 'Default split');
  const defaultValues = ids
    .filter((id) => Object.hasOwn(settings.defaultSplit, id))
    .map((id) => settings.defaultSplit[id]);
  if (defaultValues.length) {
    const total = defaultValues.reduce((sum, value) => sum + value, 0);
    if (defaultSplitTotalInvalid(total)) {
      errors.push(`Default split percentages must total 100% (currently ${total.toFixed(2)}%), or leave every field blank for equal splitting.`);
    }
  }

  return [...new Set(errors)];
}

/** Preserve the legacy default-split tolerance for previously saved trips. */
export function defaultSplitTotalInvalid(total: number): boolean {
  // 33.3 + 33.3 + 33.3 can be just below 99.9 in floating-point arithmetic.
  return Math.abs(total - 100) > 0.1 + 1e-9;
}

/**
 * Turns the form into settings fields. Blank inputs and travelers no longer
 * on the trip are omitted. Invalid text is kept as NaN so validation reports
 * it instead of dropping the field.
 */
export function parseSettingsDraft(draft: TripSettingsDraft, ids: string[]): {
  settings: TripSettingsFields;
  errors: string[];
} {
  const settings: TripSettingsFields = {
    spendCaps: Object.entries(filledNumbers(draft.caps, ids, dollarsFromInput)).map(
      ([participantId, maxAmount]) => ({ participantId, maxAmount }),
    ),
    overageSplit: draft.overageType === 'manual'
      ? { type: 'manual', shares: filledNumbers(draft.overageShares, ids, percentFromInput) }
      : { type: 'even' },
    defaultSplit: filledNumbers(draft.defaultShares, ids, percentFromInput),
  };
  return { settings, errors: validateTripSettings(settings, ids) };
}

/** Null when the write may proceed. Invalid settings never reach the write. */
export function settingsWriteError(
  settings: TripSettingsFields,
  ids: string[],
  baseline: string,
  revision: string,
  overwriteRevision?: string,
): string | null {
  const errors = validateTripSettings(settings, ids);
  if (errors.length) return errors.join(' ');
  if (baseline !== revision && overwriteRevision !== revision) return STALE_SETTINGS_MESSAGE;
  return null;
}

function sameNumbers(left: Record<string, number> | undefined, right: Record<string, number> | undefined): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}

/** True when the snapshot contains the settings this form just wrote. */
export function savedSettingsMatch(trip: Trip, settings: TripSettingsFields): boolean {
  const storedCaps = trip.spendCaps ?? [];
  const sameCaps = storedCaps.length === settings.spendCaps.length && settings.spendCaps.every((cap) =>
    storedCaps.some((stored) => stored.participantId === cap.participantId && stored.maxAmount === cap.maxAmount),
  );
  const storedType = trip.overageSplit?.type === 'manual' ? 'manual' : 'even';
  const sameOverage = storedType === settings.overageSplit.type && (
    settings.overageSplit.type === 'even'
      ? true
      : sameNumbers(trip.overageSplit?.shares, settings.overageSplit.shares)
  );
  return sameCaps && sameOverage && sameNumbers(trip.defaultSplit, settings.defaultSplit);
}

export function previewSettings(ledger: Ledger, settings: TripSettingsFields): BudgetCapResult {
  return applyBudgetCaps(ledger.subtotals, settings.spendCaps, settings.overageSplit, ledger.travelerIds);
}

export interface OveragePreview {
  /** Travelers not held at their cap, in trip order. They can absorb further overage. */
  eligible: string[];
  /** Hundredths of a percent (10000 = 100%) among eligible travelers. */
  normalized: Record<string, number>;
  /** Manual shares cover nobody eligible, so the ledger uses an even split. */
  fallback: boolean;
  /** Travelers whose final responsibility is already above their expense subtotal. */
  absorbing: string[];
}

/**
 * Eligibility and normalized shares come from the ledger's cap result.
 * Further overage uses the same cent allocator as the ledger.
 */
export function overagePreview(caps: BudgetCapResult, split: OverageSplit, ids: string[]): OveragePreview {
  const capped = new Set(caps.cappedIds);
  // capCents and final already use money.ts integer cents. The ledger only
  // adds a traveler to cappedIds after they exceed the cap, so check equality too.
  const eligible = ids.filter((id) =>
    !capped.has(id) && (!(id in caps.capCents) || (caps.final[id] ?? 0) < caps.capCents[id]),
  );
  const manual = Object.fromEntries(eligible.map((id) => {
    const share = split.shares?.[id];
    return [id, typeof share === 'number' && Number.isFinite(share) && share > 0 ? share : 0];
  }));
  const fallback = split.type === 'manual' && eligible.length > 0 && !eligible.some((id) => manual[id] > 0);
  const weights = split.type === 'even' || fallback
    ? Object.fromEntries(eligible.map((id) => [id, 1]))
    : manual;
  const normalized = eligible.length ? allocateCents(10000, weights, eligible) : {};
  return {
    eligible,
    normalized,
    fallback,
    absorbing: ids.filter((id) => (caps.adjustments[id] ?? 0) > 0),
  };
}

/** `units` are hundredths of a percent from `overagePreview`. */
export function formatNormalizedShare(units: number): string {
  if (!Number.isSafeInteger(units)) return 'Invalid share';
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}${whole}.${fraction.toString().padStart(2, '0')}%`;
}

/**
 * Near cap means strictly under 5% of the cap is left, and the traveler is
 * not already over it. Exactly 5% left is not near.
 */
export function capProgress(finalCents: number, capCents: number): {
  percent: number;
  nearCap: boolean;
  /** Exactly at the cap: nothing left, not over. */
  atCap: boolean;
  overCap: boolean;
} {
  const remaining = capCents - finalCents;
  const ratio = capCents > 0 ? finalCents / capCents : 1;
  return {
    percent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    nearCap: capCents > 0 && remaining >= 0 && remaining * 100 < capCents * 5,
    atCap: remaining === 0,
    overCap: remaining < 0,
  };
}

export function enteredPercentTotal(shares: Record<string, string>): number | null {
  let total = 0;
  let any = false;
  for (const raw of Object.values(shares)) {
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    any = true;
    total += value;
  }
  return any ? total : null;
}

/**
 * Cents the new traveler would absorb if added now, without changing saved
 * expense splits. Includes manual overage's even fallback when no eligible
 * traveler has a positive custom share.
 */
export function newTravelerOverageCents(trip: Pick<Trip, 'participants' | 'expenses' | 'payments' | 'spendCaps' | 'overageSplit'>): number {
  let id = 'new-traveler-preview';
  while (trip.participants.some((person) => person.id === id)) id += '-x';
  const added: TripParticipant = { id, name: 'New traveler', isRegistered: false, addedBy: '' };
  const hypothetical = buildLedger({
    ...trip,
    participants: [...trip.participants, added],
  });
  return hypothetical.caps.adjustments[id] ?? 0;
}

export function newTravelerNotice(
  trip: Pick<Trip, 'participants' | 'expenses' | 'payments' | 'spendCaps' | 'overageSplit'>,
  name: string,
): { resplit: string; overage: string | null } {
  const label = name.trim();
  const cents = newTravelerOverageCents(trip);
  return {
    resplit: `Existing expenses are not resplit. Add ${label} to earlier expenses by editing them.`,
    overage: cents > 0
      ? `${label} will start absorbing over-cap costs: currently +${formatMoney(cents)}.`
      : null,
  };
}
