import type { DefaultSplit, Expense, ExpenseDraft } from '../pageTypes';
import { allocateExpense, type LedgerProblem } from './ledger';
import { allocateCents, formatMoney, fromCents, parseScaledInput } from './money';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** The stored expense fields a draft produces (id and creator are kept by the caller). */
export type ExpenseFields = Pick<
  Expense,
  'category' | 'description' | 'totalAmount' | 'paidBy' | 'splitType' | 'splitParticipants' | 'manualSplit'
>;

export interface DraftContext {
  /** Trip participant ids, in trip order. */
  travelerIds: string[];
  /** Payer used when the draft names none: the caller's uniquely linked participant. */
  defaultPayerId?: string;
  /** The stored expense being edited. Unedited legacy values are saved back verbatim. */
  original?: Expense;
}

export type DraftErrorField = 'description' | 'total' | 'payers' | 'split';

export type DraftErrorCode =
  | 'description-required'
  | 'total-invalid'
  | 'total-fractional-cent'
  | 'payer-invalid'
  | 'payer-unknown'
  | 'payer-required'
  | 'payer-sum'
  | 'split-empty'
  | 'split-unknown'
  | 'share-invalid'
  | 'split-sum';

export interface DraftError {
  field: DraftErrorField;
  code: DraftErrorCode;
  message: string;
  travelerId?: string;
}

/** What the ledger would allocate for the draft, in integer cents. */
export interface DraftPreview {
  totalCents: number;
  payers: Record<string, number>;
  /** Share of each included traveler, explicit zeros kept. */
  shares: Record<string, number>;
  /** Travelers left out of the split ("Not included"). */
  excluded: string[];
  /** Included travelers whose share is $0.00. */
  zeroShare: string[];
  unassignedCents: number;
  problems: LedgerProblem[];
}

export interface DraftValidation {
  errors: DraftError[];
  /** Null until the total is a valid amount. */
  preview: DraftPreview | null;
}

export type DraftConversion =
  | { fields: ExpenseFields; errors: [] }
  | { fields: null; errors: DraftError[] };

/** Percentages are kept to 4 decimal places: 100% = 1,000,000 units. */
const PERCENT_SCALE = 10_000;
const PERCENT_TOTAL = 100 * PERCENT_SCALE;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const unique = (ids: string[] | undefined): string[] => Array.from(new Set(ids || []));

const sumValues = (record: Record<string, number>): number =>
  Object.values(record).reduce((s, n) => s + n, 0);

/** Included travelers in trip order (ties in rounding follow this order). */
const includedInTripOrder = (draft: ExpenseDraft, travelerIds: string[]): string[] => {
  const included = new Set(draft.splitParticipants || []);
  return travelerIds.filter((id) => included.has(id));
};

const centsInput = (cents: number): string => (cents / 100).toFixed(2);

const percentInput = (units: number): string => String(units / PERCENT_SCALE);

const formatPercentUnits = (units: number): string => `${percentInput(units)}%`;

const manualMode = (draft: ExpenseDraft): 'amount' | 'percent' =>
  draft.manualSplitMode === 'percent' ? 'percent' : 'amount';

const isBlank = (value: unknown): boolean => String(value ?? '').trim() === '';

/* ------------------------------------------------------------------ */
/*  Stored expense → draft                                             */
/* ------------------------------------------------------------------ */

/**
 * Loads a stored expense into form state exactly as saved. Legacy manual
 * splits that mix $ and % entries load as Custom $ using the cents the
 * ledger already allocates for them.
 */
export function expenseToDraft(e: Expense): ExpenseDraft {
  const entries = Object.entries(e.manualSplit || {});
  const types = new Set(entries.map(([, v]) => v?.type));
  const mixed = e.splitType === 'manual' && types.has('amount') && types.has('percent');

  let manualSplit: ExpenseDraft['manualSplit'];
  if (mixed) {
    const splitOrder = unique(e.splitParticipants);
    const { shares } = allocateExpense(e, splitOrder);
    manualSplit = Object.fromEntries(
      splitOrder.map((id) => [id, { type: 'amount' as const, value: centsInput(shares[id] ?? 0) }]),
    );
  } else {
    manualSplit = Object.fromEntries(
      entries.map(([k, v]) => [k, { type: v.type, value: String(v.value) }]),
    );
  }

  return {
    category: e.category,
    description: e.description,
    totalAmount: String(e.totalAmount),
    paidBy: Object.fromEntries(
      Object.entries(e.paidBy || {}).map(([k, v]) => [k, String(v)]),
    ),
    splitType: e.splitType,
    splitParticipants: [...(e.splitParticipants || [])],
    manualSplit,
    manualSplitMode: mixed ? 'amount' : entries[0]?.[1]?.type || 'amount',
  };
}

/** Money-related draft state in a comparable form (blank entries ignored). */
function moneyKey(draft: ExpenseDraft): string {
  const sorted = (record: Record<string, string>) =>
    Object.entries(record)
      .filter(([, v]) => !isBlank(v))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manual = draft.splitType === 'manual';
  return JSON.stringify([
    String(draft.totalAmount ?? ''),
    sorted(draft.paidBy || {}),
    draft.splitType,
    draft.splitParticipants || [],
    manual ? manualMode(draft) : null,
    manual
      ? sorted(Object.fromEntries(Object.entries(draft.manualSplit || {}).map(([k, v]) => [k, v?.value ?? ''])))
      : null,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Validation and conversion                                          */
/* ------------------------------------------------------------------ */

interface Evaluation {
  errors: DraftError[];
  fields: ExpenseFields | null;
  preview: DraftPreview | null;
}

function toPreview(expense: Expense, travelerIds: string[]): DraftPreview {
  const allocation = allocateExpense(expense, travelerIds);
  return {
    totalCents: allocation.totalCents,
    payers: allocation.payers,
    shares: allocation.shares,
    excluded: allocation.excluded,
    zeroShare: Object.keys(allocation.shares).filter((id) => allocation.shares[id] === 0),
    unassignedCents: allocation.unassignedCents,
    problems: allocation.problems,
  };
}

function evaluateDraft(draft: ExpenseDraft, ctx: DraftContext): Evaluation {
  const { travelerIds, original } = ctx;
  const known = new Set(travelerIds);
  const errors: DraftError[] = [];

  /* ---- description and category ---- */
  let description: string;
  if (original && draft.description === original.description) {
    description = original.description;
  } else {
    description = String(draft.description ?? '').trim();
    if (!description) {
      errors.push({ field: 'description', code: 'description-required', message: 'Enter a description.' });
    }
  }
  const category = draft.category;

  /* ---- unedited money fields keep their stored values (legacy round-trip) ---- */
  if (original && moneyKey(draft) === moneyKey(expenseToDraft(original))) {
    const fields: ExpenseFields = {
      category,
      description,
      totalAmount: original.totalAmount,
      paidBy: { ...(original.paidBy || {}) },
      splitType: original.splitType,
      splitParticipants: [...(original.splitParticipants || [])],
      manualSplit: Object.fromEntries(
        Object.entries(original.manualSplit || {}).map(([k, v]) => [k, { ...v }]),
      ),
    };
    const preview = toPreview({ ...original, ...fields }, travelerIds);
    return { errors, fields: errors.length ? null : fields, preview };
  }

  /* ---- total ---- */
  let totalCents: number | null = null;
  const total = parseScaledInput(draft.totalAmount, 100);
  if (total.kind === 'fractional') {
    errors.push({ field: 'total', code: 'total-fractional-cent', message: 'Enter the amount in whole cents.' });
  } else if (total.kind !== 'ok' || total.units <= 0) {
    errors.push({ field: 'total', code: 'total-invalid', message: 'Enter an amount greater than 0.' });
  } else {
    totalCents = total.units;
  }

  /* ---- payers ---- */
  const payerCents: Record<string, number> = {};
  let payerInputError = false;
  for (const [id, raw] of Object.entries(draft.paidBy || {})) {
    const parsed = parseScaledInput(raw, 100);
    // Blank and $0 payer entries mean "didn't pay", as in the old form.
    if (parsed.kind === 'blank' || (parsed.kind === 'ok' && parsed.units === 0)) continue;
    if (parsed.kind !== 'ok') {
      payerInputError = true;
      errors.push({
        field: 'payers',
        code: 'payer-invalid',
        travelerId: id,
        message:
          parsed.kind === 'negative'
            ? "Payer amounts can't be negative."
            : parsed.kind === 'fractional'
              ? 'Enter payer amounts in whole cents.'
              : 'Enter a valid payer amount.',
      });
      continue;
    }
    if (!known.has(id)) {
      payerInputError = true;
      errors.push({ field: 'payers', code: 'payer-unknown', travelerId: id, message: "A payer isn't on this trip." });
      continue;
    }
    payerCents[id] = parsed.units;
  }
  if (!Object.keys(payerCents).length && !payerInputError) {
    if (ctx.defaultPayerId && known.has(ctx.defaultPayerId)) {
      if (totalCents !== null) payerCents[ctx.defaultPayerId] = totalCents;
    } else {
      errors.push({
        field: 'payers',
        code: 'payer-required',
        message:
          'Select who paid — we can only default the payer when exactly one participant record is linked to your account.',
      });
    }
  } else if (totalCents !== null && !payerInputError && sumValues(payerCents) !== totalCents) {
    errors.push({
      field: 'payers',
      code: 'payer-sum',
      message: `Payers total ${formatMoney(sumValues(payerCents))} of ${formatMoney(totalCents)}.`,
    });
  }

  /* ---- split ---- */
  const requested = unique(draft.splitParticipants);
  for (const id of requested) {
    if (!known.has(id)) {
      errors.push({ field: 'split', code: 'split-unknown', travelerId: id, message: "Someone in the split isn't on this trip." });
    }
  }
  const splitParticipants = includedInTripOrder(draft, travelerIds);
  if (!requested.length) {
    errors.push({ field: 'split', code: 'split-empty', message: 'Choose at least one traveler to split this expense with.' });
  }

  const splitType: Expense['splitType'] = draft.splitType === 'manual' ? 'manual' : 'even';
  const manualSplit: Expense['manualSplit'] = {};
  if (splitType === 'manual') {
    const mode = manualMode(draft);
    const scale = mode === 'percent' ? PERCENT_SCALE : 100;
    const units: Record<string, number> = {};
    let shareInputError = false;
    for (const id of splitParticipants) {
      const parsed = parseScaledInput(draft.manualSplit?.[id]?.value, scale);
      if (parsed.kind === 'blank' || parsed.kind === 'ok') {
        // An included traveler with no value is an explicit $0 / 0% share.
        units[id] = parsed.kind === 'ok' ? parsed.units : 0;
        manualSplit[id] = { type: mode, value: mode === 'percent' ? units[id] / PERCENT_SCALE : fromCents(units[id]) };
        continue;
      }
      shareInputError = true;
      errors.push({
        field: 'split',
        code: 'share-invalid',
        travelerId: id,
        message:
          parsed.kind === 'negative'
            ? "Shares can't be negative."
            : parsed.kind === 'fractional'
              ? mode === 'percent'
                ? 'Use at most 4 decimal places for percentages.'
                : 'Enter shares in whole cents.'
              : 'Enter a valid share.',
      });
    }
    const sum = sumValues(units);
    if (!shareInputError && splitParticipants.length) {
      if (mode === 'percent' && sum !== PERCENT_TOTAL) {
        errors.push({
          field: 'split',
          code: 'split-sum',
          message: `Percentages total ${formatPercentUnits(sum)} of 100%.`,
        });
      } else if (mode === 'amount' && totalCents !== null && sum !== totalCents) {
        errors.push({
          field: 'split',
          code: 'split-sum',
          message: `Split totals ${formatMoney(sum)} of ${formatMoney(totalCents)}.`,
        });
      }
    }
  }

  const fields: ExpenseFields = {
    category,
    description,
    totalAmount: totalCents === null ? 0 : fromCents(totalCents),
    paidBy: Object.fromEntries(Object.entries(payerCents).map(([id, c]) => [id, fromCents(c)])),
    splitType,
    splitParticipants,
    manualSplit,
  };
  const preview =
    totalCents === null
      ? null
      : toPreview({ ...fields, id: original?.id ?? 'draft', createdBy: original?.createdBy ?? '' }, travelerIds);
  return { errors, fields: errors.length ? null : fields, preview };
}

/**
 * Validates a draft for saving. New money values must add up exactly: payers
 * and Custom $ shares to the cent, Custom % shares to exactly 100%. Money
 * fields left untouched on an edited expense are exempt and saved verbatim,
 * so legacy rows within the old ±$0.01 / ±0.01% tolerance stay editable.
 */
export function validateDraft(draft: ExpenseDraft, ctx: DraftContext): DraftValidation {
  const { errors, preview } = evaluateDraft(draft, ctx);
  return { errors, preview };
}

/** Converts a valid draft to stored expense fields, or returns why it can't be saved. */
export function draftToExpenseFields(draft: ExpenseDraft, ctx: DraftContext): DraftConversion {
  const { errors, fields } = evaluateDraft(draft, ctx);
  return fields ? { fields, errors: [] } : { fields: null, errors };
}

/* ------------------------------------------------------------------ */
/*  Custom $ ↔ Custom %                                                */
/* ------------------------------------------------------------------ */

/**
 * Switches a manual split between dollars and percentages, converting the
 * entered values instead of wiping them. When the values cover the total
 * exactly, the converted values do too (largest remainder, trip order).
 * Blank entries stay blank. Percent → $ needs a valid total; without one the
 * values are cleared.
 */
export function convertManualSplit(
  draft: ExpenseDraft,
  toMode: 'amount' | 'percent',
  travelerIds: string[],
): ExpenseDraft {
  const fromMode = manualMode(draft);
  if (fromMode === toMode) return { ...draft, manualSplitMode: toMode };

  const ids = includedInTripOrder(draft, travelerIds);
  const fromScale = fromMode === 'percent' ? PERCENT_SCALE : 100;
  const values: Record<string, number> = {};
  for (const id of ids) {
    const parsed = parseScaledInput(draft.manualSplit?.[id]?.value, fromScale);
    if (parsed.kind === 'ok') values[id] = parsed.units;
  }
  const valued = ids.filter((id) => id in values);
  const sum = sumValues(values);
  const total = parseScaledInput(draft.totalAmount, 100);
  const totalCents = total.kind === 'ok' && total.units > 0 ? total.units : null;

  let converted: Record<string, number> | null = null;
  if (toMode === 'percent') {
    const base = totalCents ?? sum;
    if (base > 0) {
      converted =
        sum === base
          ? allocateCents(PERCENT_TOTAL, values, valued)
          : Object.fromEntries(valued.map((id) => [id, Math.round((values[id] / base) * PERCENT_TOTAL)]));
    } else {
      converted = Object.fromEntries(valued.map((id) => [id, 0]));
    }
  } else if (totalCents !== null) {
    converted =
      sum === PERCENT_TOTAL
        ? allocateCents(totalCents, values, valued)
        : Object.fromEntries(valued.map((id) => [id, Math.round((values[id] / PERCENT_TOTAL) * totalCents)]));
  }

  const manualSplit: ExpenseDraft['manualSplit'] = {};
  for (const id of ids) {
    const units = converted?.[id];
    manualSplit[id] = {
      type: toMode,
      value: units === undefined ? '' : toMode === 'percent' ? percentInput(units) : centsInput(units),
    };
  }
  return { ...draft, manualSplitMode: toMode, manualSplit };
}

/* ------------------------------------------------------------------ */
/*  Trip default split (D2)                                            */
/* ------------------------------------------------------------------ */

const validDefaultValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** True when the trip default gives a positive percentage to someone. */
export function hasTripDefault(defaultSplit: DefaultSplit | undefined): boolean {
  return Object.values(defaultSplit || {}).some((v) => validDefaultValue(v) && v > 0);
}

/** Travelers with no entry in the trip default (they get an explicit 0%). */
export function travelersMissingFromDefault(
  defaultSplit: DefaultSplit | undefined,
  travelerIds: string[],
): string[] {
  return travelerIds.filter((id) => !validDefaultValue(defaultSplit?.[id]));
}

/**
 * Applies the trip default to the draft's included travelers as a Custom %
 * snapshot. Excluded travelers' percentages are rescaled across the rest so
 * the snapshot is exactly 100%; included travelers missing from the default
 * get an explicit 0% and are returned in `missing`.
 */
export function applyTripDefault(
  draft: ExpenseDraft,
  defaultSplit: DefaultSplit | undefined,
  travelerIds: string[],
): { draft: ExpenseDraft; missing: string[] } {
  const ids = includedInTripOrder(draft, travelerIds);
  const weights = Object.fromEntries(
    ids.map((id) => {
      const value = defaultSplit?.[id];
      return [id, validDefaultValue(value) ? value : 0];
    }),
  );
  const units =
    sumValues(weights) > 0
      ? allocateCents(PERCENT_TOTAL, weights, ids)
      : Object.fromEntries(ids.map((id) => [id, 0]));
  const manualSplit: ExpenseDraft['manualSplit'] = Object.fromEntries(
    ids.map((id) => [id, { type: 'percent' as const, value: percentInput(units[id]) }]),
  );
  return {
    draft: { ...draft, splitType: 'manual', manualSplitMode: 'percent', manualSplit },
    missing: travelersMissingFromDefault(defaultSplit, ids),
  };
}
