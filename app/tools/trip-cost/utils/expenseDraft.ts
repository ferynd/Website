import type { DefaultSplit, Expense, ExpenseDraft } from '../pageTypes';
import { allocateExpense, type LedgerProblem } from './ledger';
import { allocateCents, formatMoney, fromCents, parseScaledInput, toCents } from './money';

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
  /** Invalid custom inputs are shown verbatim, never as a final allocation. */
  notFinal?: boolean;
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

const cloneManualSplit = (manualSplit: ExpenseDraft['manualSplit']): ExpenseDraft['manualSplit'] =>
  Object.fromEntries(Object.entries(manualSplit).map(([id, entry]) => [id, { type: entry.type, value: entry.value }]));

/** Split identity for "the user has not edited since this automatic value". */
function splitSnapshot(draft: ExpenseDraft): string {
  const manual = draft.splitType === 'manual';
  return JSON.stringify([
    draft.splitType,
    draft.splitParticipants,
    manual ? manualMode(draft) : null,
    manual
      ? Object.entries(draft.manualSplit || {})
        .filter(([, entry]) => entry && !isBlank(entry.value))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, entry]) => [id, entry.type, entry.value])
      : null,
  ]);
}

const sameList = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const hasPositiveTotal = (draft: ExpenseDraft): boolean => {
  const total = parseScaledInput(draft.totalAmount, 100);
  return total.kind === 'ok' && total.units > 0;
};

/**
 * Positive share used when an automatic split can no longer be rebuilt.
 * An explicit zero is the string "0"; otherwise each included traveler is
 * offered an equal slice and validation asks the user to rebalance.
 */
function fallbackShareValue(draft: ExpenseDraft, travelerIds: string[], zero: boolean): string {
  if (zero) return '0';
  const mode = manualMode(draft);
  const total = parseScaledInput(draft.totalAmount, 100);
  const units = mode === 'percent' ? PERCENT_TOTAL : total.kind === 'ok' ? total.units : 0;
  const count = Math.max(1, includedInTripOrder(draft, travelerIds).length);
  const restored = Math.max(1, Math.floor(units / count));
  return mode === 'percent' ? percentInput(restored) : centsInput(restored);
}

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

/** Comparable payer state (blank entries ignored). */
function payerKey(draft: ExpenseDraft): string {
  return JSON.stringify(Object.entries(draft.paidBy || {})
    .filter(([, value]) => !isBlank(value))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Split state is independent of payers; participant order controls rounding. */
function splitKey(draft: ExpenseDraft): string {
  const manual = draft.splitType === 'manual';
  return JSON.stringify([
    draft.splitType,
    draft.splitParticipants || [],
    manual ? manualMode(draft) : null,
    manual
      ? Object.entries(draft.manualSplit || {})
        .filter(([, entry]) => !isBlank(entry?.value))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, entry]) => [id, entry.type, entry.value])
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

  /* ---- preserve untouched groups independently (legacy round-trip) ---- */
  const loaded = original ? expenseToDraft(original) : null;
  const totalUnchanged = Boolean(loaded && draft.totalAmount === loaded.totalAmount);
  // A changed total requires both payers and shares to cover the new total exactly.
  const payersUnchanged = totalUnchanged && loaded && payerKey(draft) === payerKey(loaded);
  const splitUnchanged = totalUnchanged && loaded && splitKey(draft) === splitKey(loaded);

  /* ---- total ---- */
  let totalCents: number | null = null;
  const total = parseScaledInput(draft.totalAmount, 100);
  if (totalUnchanged && original) {
    totalCents = toCents(original.totalAmount);
  } else if (total.kind === 'fractional') {
    errors.push({ field: 'total', code: 'total-fractional-cent', message: 'Enter the amount in whole cents.' });
  } else if (total.kind !== 'ok' || total.units <= 0) {
    errors.push({ field: 'total', code: 'total-invalid', message: 'Enter an amount greater than 0.' });
  } else {
    totalCents = total.units;
  }

  /* ---- payers ---- */
  const payerCents: Record<string, number> = {};
  if (!payersUnchanged) {
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
      } else if (!(totalCents === null && Object.keys(draft.paidBy).some((id) => known.has(id)))) {
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
  }

  /* ---- split ---- */
  const splitType = splitUnchanged && original ? original.splitType : draft.splitType === 'manual' ? 'manual' : 'even';
  let splitParticipants = [...(original?.splitParticipants || [])];
  const manualSplit: Expense['manualSplit'] = splitUnchanged && original
    ? Object.fromEntries(Object.entries(original.manualSplit || {}).map(([id, entry]) => [id, { ...entry }]))
    : {};
  if (!splitUnchanged) {
    const requested = unique(draft.splitParticipants);
    for (const id of requested) {
      if (!known.has(id)) {
        errors.push({ field: 'split', code: 'split-unknown', travelerId: id, message: "Someone in the split isn't on this trip." });
      }
    }
    // Stored participant order breaks largest-remainder ties, even on total-only edits.
    splitParticipants = requested.filter((id) => known.has(id));
    if (!requested.length) {
      errors.push({ field: 'split', code: 'split-empty', message: 'Choose at least one traveler to split this expense with.' });
    }

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
  }

  const fields: ExpenseFields = {
    category,
    description,
    totalAmount: totalUnchanged && original ? original.totalAmount : totalCents === null ? 0 : fromCents(totalCents),
    paidBy: payersUnchanged && original
      ? { ...(original.paidBy || {}) }
      : Object.fromEntries(Object.entries(payerCents).map(([id, c]) => [id, fromCents(c)])),
    splitType,
    splitParticipants,
    manualSplit,
  };
  const preview =
    totalCents === null
      ? null
      : toPreview({ ...fields, id: original?.id ?? 'draft', createdBy: original?.createdBy ?? '' }, travelerIds);
  if (preview && errors.some((error) => error.field === 'split')) {
    preview.notFinal = true;
  }
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

export type ExpenseEditorMethod = 'equal' | 'trip-default' | 'amount' | 'percent';

export function expenseMethodOptions(hasDefault: boolean): { value: ExpenseEditorMethod; label: string }[] {
  return [
    { value: 'equal', label: 'Equal' },
    ...(hasDefault ? [{ value: 'trip-default' as const, label: 'Trip default' }] : []),
    { value: 'amount', label: 'Custom $' },
    { value: 'percent', label: 'Custom %' },
  ];
}

export interface ExpenseEditorState {
  draft: ExpenseDraft;
  method: ExpenseEditorMethod;
  /** Zeros produced by conversion/rounding, rather than entered by the user. */
  implicitZeros?: string[];
  /** Retain loaded rounding order when a traveler is deselected and reselected. */
  travelerOrder?: string[];
  /** Editor-only provenance; never included in stored expense fields. */
  zeroOrigin?: {
    method: 'equal' | 'trip-default';
    weights: DefaultSplit;
    zeros: string[];
    expected: Record<string, number>;
  };
  /**
   * Verbatim manual split from a loaded expense. An unedited return to this
   * mode restores these strings so the legacy tolerance still applies.
   */
  loadedManual?: {
    mode: 'amount' | 'percent';
    totalAmount: string;
    participants: string[];
    manualSplit: ExpenseDraft['manualSplit'];
  };
  /**
   * Percent shares kept when Custom $ is chosen before a total exists.
   * Later totals recompute dollar shares from this snapshot until the user
   * edits a dollar share.
   */
  pendingPercents?: ExpenseDraft['manualSplit'];
  /** Invalid percentages wait for a total without locking the dollar inputs. */
  editablePendingPercents?: boolean;
  /** Source weights for rebuilding a pending snapshot after traveler toggles. */
  pendingPercentOrigin?: {
    method: 'equal' | 'trip-default' | 'percent';
    weights: DefaultSplit;
  };
}

/** A pending split still displayed in percentages waits for a total before editing. */
export function expenseSharesAwaitTotal(state: ExpenseEditorState): boolean {
  return state.method === 'amount' && Boolean(state.pendingPercents) && manualMode(state.draft) === 'percent';
}

/**
 * Blank included shares are stored as explicit $0 / 0%. In Custom $ and Custom %
 * the zero checkbox follows that rule; Equal and Trip default do not treat a
 * missing box as a zero the user checked.
 */
export function showsExplicitZero(
  method: ExpenseEditorMethod,
  splitType: ExpenseDraft['splitType'],
  value: string,
): boolean {
  if (splitType !== 'manual') return false;
  if (value.trim() === '') return method === 'amount' || method === 'percent';
  return Number(value) === 0;
}

/** Saved defaults have no provenance field: edit them as their saved Custom % snapshot. */
export function createExpenseEditor(
  travelerIds: string[],
  category: string,
  defaultSplit?: DefaultSplit,
  payerId?: string,
  original?: Expense,
): ExpenseEditorState {
  if (original) {
    const draft = expenseToDraft(original);
    return {
      draft,
      method: draft.splitType === 'even' ? 'equal' : draft.manualSplitMode,
      travelerOrder: unique([...draft.splitParticipants, ...travelerIds]),
      loadedManual: draft.splitType === 'manual' ? {
        mode: draft.manualSplitMode,
        totalAmount: draft.totalAmount,
        participants: [...draft.splitParticipants],
        manualSplit: cloneManualSplit(draft.manualSplit),
      } : undefined,
    };
  }
  const draft: ExpenseDraft = {
    category,
    description: '',
    totalAmount: '',
    paidBy: payerId ? { [payerId]: '' } : {},
    splitType: 'even',
    splitParticipants: [...travelerIds],
    manualSplit: {},
    manualSplitMode: 'amount',
  };
  return hasTripDefault(defaultSplit)
    ? { draft: applyTripDefault(draft, defaultSplit, travelerIds).draft, method: 'trip-default' }
    : { draft, method: 'equal' };
}

/**
 * Rounding order for method changes and explicit zeros.
 * Stored participants keep the cents they already have; known trip members
 * the draft never listed follow them.
 */
function editorSplitOrder(state: ExpenseEditorState, travelerIds: string[]): string[] {
  const known = new Set(travelerIds);
  const preferred = unique([
    ...state.draft.splitParticipants,
    ...(state.travelerOrder ?? []),
  ]).filter((id) => known.has(id));
  return [...preferred, ...travelerIds.filter((id) => !preferred.includes(id))];
}

function finishMethod(
  state: ExpenseEditorState,
  method: ExpenseEditorMethod,
  draft: ExpenseDraft,
): ExpenseEditorState {
  const implicitZeros = method === 'trip-default' ? [] : convertedImplicitZeros(state, draft);
  return {
    ...state,
    implicitZeros,
    zeroOrigin: undefined,
    pendingPercents: undefined,
    editablePendingPercents: undefined,
    pendingPercentOrigin: undefined,
    method,
    draft,
  };
}

function convertedImplicitZeros(state: ExpenseEditorState, draft: ExpenseDraft): string[] {
  return Object.entries(draft.manualSplit).filter(([id, entry]) =>
    entry.value.trim() !== '' && Number(entry.value) === 0 && (
      state.draft.splitType === 'even' || state.implicitZeros?.includes(id) || Number(state.draft.manualSplit[id]?.value) > 0
    )).map(([id]) => id);
}

/** Keep the Custom $ percent snapshot aligned with edits made before a total exists. */
function syncPending(previous: ExpenseEditorState, next: ExpenseEditorState): ExpenseEditorState {
  if (!previous.pendingPercents) return next;
  if (next.method === 'amount' && manualMode(next.draft) === 'percent') {
    return { ...next, pendingPercents: cloneManualSplit(next.draft.manualSplit) };
  }
  return {
    ...next,
    pendingPercents: undefined,
    editablePendingPercents: undefined,
    pendingPercentOrigin: undefined,
  };
}

/**
 * True when the open manual split is still the conversion of the loaded split.
 * Switching back can then restore the original strings instead of rewriting them.
 */
function loadedSplitUnedited(state: ExpenseEditorState, travelerIds: string[]): boolean {
  const loaded = state.loadedManual;
  if (!loaded) return false;
  if (state.draft.totalAmount !== loaded.totalAmount) return false;
  if (!sameList(state.draft.splitParticipants, loaded.participants)) return false;
  const currentMode = state.method === 'amount' || state.method === 'percent' ? state.method : null;
  if (!currentMode || state.draft.splitType !== 'manual' || manualMode(state.draft) !== currentMode) return false;
  if (currentMode === loaded.mode) {
    return splitSnapshot(state.draft) === splitSnapshot({
      ...state.draft,
      manualSplit: loaded.manualSplit,
      splitParticipants: loaded.participants,
    });
  }
  const loadedDraft: ExpenseDraft = {
    ...state.draft,
    splitType: 'manual',
    manualSplitMode: loaded.mode,
    manualSplit: loaded.manualSplit,
    splitParticipants: [...loaded.participants],
    totalAmount: loaded.totalAmount,
  };
  const converted = convertManualSplit(loadedDraft, currentMode, editorSplitOrder(state, travelerIds));
  return splitSnapshot(converted) === splitSnapshot(state.draft);
}

/** Changes modes through the same deterministic allocation used by draft validation. */
export function changeExpenseMethod(
  state: ExpenseEditorState,
  method: ExpenseEditorMethod,
  travelerIds: string[],
  defaultSplit?: DefaultSplit,
): ExpenseEditorState {
  if (method === state.method) return state;
  const order = editorSplitOrder(state, travelerIds);
  if (method === 'equal') {
    return finishMethod(state, method, { ...state.draft, splitType: 'even', manualSplit: {} });
  }
  if (method === 'trip-default') {
    return finishMethod(state, method, applyTripDefault(state.draft, defaultSplit, order).draft);
  }
  if (state.loadedManual && method === state.loadedManual.mode && loadedSplitUnedited(state, travelerIds)) {
    return finishMethod(state, method, {
      ...state.draft,
      splitType: 'manual',
      manualSplitMode: method,
      manualSplit: cloneManualSplit(state.loadedManual.manualSplit),
      splitParticipants: [...state.loadedManual.participants],
    });
  }
  if (
    method === 'percent' && state.editablePendingPercents &&
    state.pendingPercents && !hasPositiveTotal(state.draft)
  ) {
    return finishMethod(state, method, {
      ...state.draft,
      manualSplitMode: 'percent',
      manualSplit: cloneManualSplit(state.pendingPercents),
    });
  }
  // Invalid percentages remain editable. Without a total, retain the source
  // values separately until dollars can be calculated or the user edits them.
  if (method === 'amount' && state.draft.splitType === 'manual' && manualMode(state.draft) === 'percent') {
    const entries = state.draft.splitParticipants.map((id) => parseScaledInput(state.draft.manualSplit[id]?.value, PERCENT_SCALE));
    const sum = entries.reduce((total, entry) => total + (entry.kind === 'ok' ? entry.units : 0), 0);
    const invalid = entries.some((entry) => entry.kind !== 'ok' && entry.kind !== 'blank');
    if (invalid || sum !== PERCENT_TOTAL) {
      const next = finishMethod(state, method, {
        ...convertManualSplit(state.draft, 'amount', order),
        splitType: 'manual',
      });
      return hasPositiveTotal(state.draft) ? next : {
        ...next,
        pendingPercents: cloneManualSplit(state.draft.manualSplit),
        editablePendingPercents: true,
      };
    }
  }
  // Custom $ needs a total to turn percentages into cents. Keep the percent
  // snapshot until that total is entered instead of clearing every share.
  if (method === 'amount' && !hasPositiveTotal(state.draft)) {
    const percentDraft = state.draft.splitType === 'even'
      ? applyTripDefault(state.draft, Object.fromEntries(order.map((id) => [id, 1])), order).draft
      : state.draft;
    const kept = { ...percentDraft, splitType: 'manual' as const };
    return {
      ...finishMethod(state, method, kept),
      pendingPercents: cloneManualSplit(kept.manualSplit),
      pendingPercentOrigin: {
        method: state.method === 'equal' || state.method === 'trip-default' ? state.method : 'percent',
        weights: state.method === 'trip-default' && defaultSplit
          ? { ...defaultSplit }
          : Object.fromEntries(Object.entries(kept.manualSplit).map(([id, entry]) => [id, Number(entry.value)])),
      },
    };
  }
  const draft = state.draft.splitType === 'even'
    ? applyTripDefault(state.draft, Object.fromEntries(order.map((id) => [id, 1])), order).draft
    : state.draft;
  return finishMethod(state, method, { ...convertManualSplit(draft, method, order), splitType: 'manual' });
}

/**
 * Writes the total and, when Custom $ is waiting on one, converts the pending
 * percentages so each share follows the amount the user just entered.
 * The percent snapshot stays in place, so typing 3 and then 30 recomputes
 * against the same shares instead of freezing the first digit.
 */
export function setExpenseTotal(
  state: ExpenseEditorState,
  totalAmount: string,
  travelerIds: string[],
): ExpenseEditorState {
  const draft = { ...state.draft, totalAmount };
  if (!state.pendingPercents) return { ...state, draft };
  const percentDraft: ExpenseDraft = {
    ...draft,
    splitType: 'manual',
    manualSplitMode: 'percent',
    manualSplit: state.pendingPercents,
  };
  if (!hasPositiveTotal(percentDraft)) {
    return { ...state, draft: state.editablePendingPercents ? draft : percentDraft };
  }
  const converted = {
    ...convertManualSplit(percentDraft, 'amount', editorSplitOrder({ ...state, draft: percentDraft }, travelerIds)),
    splitType: 'manual' as const,
  };
  return {
    ...state,
    implicitZeros: convertedImplicitZeros({ ...state, draft: percentDraft }, converted),
    draft: converted,
  };
}

/** Edits displayed shares only; a dollar edit ends pending percent conversion. */
export function setExpenseShare(
  state: ExpenseEditorState,
  travelerId: string,
  value: string,
): ExpenseEditorState {
  if (expenseSharesAwaitTotal(state)) return state;
  const mode = manualMode(state.draft);
  const draft: ExpenseDraft = {
    ...state.draft,
    manualSplit: { ...state.draft.manualSplit, [travelerId]: { type: mode, value } },
  };
  const implicitZeros = state.implicitZeros?.filter((id) => id !== travelerId);
  if (!state.pendingPercents) return { ...state, implicitZeros, draft };
  return {
    ...state,
    implicitZeros,
    draft,
    pendingPercents: undefined,
    editablePendingPercents: undefined,
    pendingPercentOrigin: undefined,
  };
}

function zeroOriginMatches(state: ExpenseEditorState, travelerIds: string[]): boolean {
  const origin = state.zeroOrigin;
  if (!origin) return false;
  if (state.method !== 'percent' || manualMode(state.draft) !== 'percent') return false;
  const ids = includedInTripOrder(state.draft, travelerIds);
  return ids.length === Object.keys(origin.expected).length
    && ids.every((id) => Number(state.draft.manualSplit[id]?.value) === origin.expected[id]);
}

/** A default is rescaled only by an explicit selection change, never a Firestore refresh. */
export function toggleExpenseTraveler(
  state: ExpenseEditorState,
  travelerId: string,
  travelerIds: string[],
  defaultSplit?: DefaultSplit,
): ExpenseEditorState {
  const selected = state.draft.splitParticipants;
  const removing = selected.includes(travelerId);
  const travelerOrder = unique([...(state.travelerOrder ?? travelerIds), ...selected, travelerId]);
  const splitParticipants = removing
    ? selected.filter((id) => id !== travelerId)
    : travelerOrder.filter((id) => id === travelerId || selected.includes(id));
  const draft = { ...state.draft, splitParticipants };
  const next: ExpenseEditorState = { ...state, travelerOrder, draft };
  if (expenseSharesAwaitTotal(state)) {
    const pendingOrigin = state.pendingPercentOrigin;
    const weights: DefaultSplit = pendingOrigin?.method === 'equal'
      ? Object.fromEntries(travelerIds.map((id) => [id, 1]))
      : { ...(pendingOrigin?.weights ?? Object.fromEntries(
        Object.entries(state.pendingPercents ?? {}).map(([id, entry]) => [id, Number(entry.value)]),
      )) };
    if (!removing && !validDefaultValue(weights[travelerId])) {
      // A missing weight gets an equal slice of the new total, preserving
      // the other travelers' ratio regardless of the source weight scale.
      const remainingWeight = splitParticipants.reduce((sum, id) =>
        sum + (validDefaultValue(weights[id]) ? weights[id] : 0), 0);
      weights[travelerId] = remainingWeight / Math.max(1, splitParticipants.length - 1) || 1;
    }
    return syncPending(state, {
      ...next,
      draft: applyTripDefault(draft, weights, editorSplitOrder(next, travelerIds)).draft,
      pendingPercentOrigin: { method: pendingOrigin?.method ?? 'percent', weights },
    });
  }
  const origin = state.zeroOrigin;
  if (origin && zeroOriginMatches(state, travelerIds)) {
    const zeros = origin.zeros.filter((id) => splitParticipants.includes(id));
    if (!zeros.length && origin.method === 'equal') {
      return syncPending(state, {
        ...next,
        method: 'equal',
        zeroOrigin: undefined,
        draft: { ...draft, splitType: 'even', manualSplit: {} },
      });
    }
    // Equal weights cover every traveler, including one this toggle just added.
    const baseWeights: DefaultSplit = origin.method === 'equal'
      ? Object.fromEntries(travelerIds.map((id) => [id, 1]))
      : origin.weights;
    const weights: DefaultSplit = { ...baseWeights, ...Object.fromEntries(zeros.map((id) => [id, 0])) };
    const applied = applyTripDefault(draft, weights, editorSplitOrder(next, travelerIds)).draft;
    if (!zeros.length) {
      return syncPending(state, { ...next, method: origin.method, zeroOrigin: undefined, draft: applied });
    }
    return syncPending(state, {
      ...next,
      method: 'percent',
      draft: applied,
      zeroOrigin: {
        ...origin,
        weights: baseWeights,
        zeros,
        expected: Object.fromEntries(Object.entries(applied.manualSplit).map(([id, entry]) => [id, Number(entry.value)])),
      },
    });
  }
  if (state.method === 'trip-default') {
    return syncPending(state, { ...next, draft: applyTripDefault(draft, defaultSplit, editorSplitOrder(next, travelerIds)).draft });
  }
  // A hand-edited zero snapshot no longer has a share for someone just included.
  // Leave a positive fallback instead of a blank that would save as $0.
  if (origin && !removing && isBlank(draft.manualSplit[travelerId]?.value)) {
    const mode = manualMode(draft);
    return syncPending(state, {
      ...next,
      draft: {
        ...draft,
        manualSplit: {
          ...draft.manualSplit,
          [travelerId]: { type: mode, value: fallbackShareValue(draft, travelerIds, false) },
        },
      },
    });
  }
  return syncPending(state, next);
}

/** Keep automatic split provenance so unedited zero toggles can be reversed. */
export function setExpenseExplicitZero(
  state: ExpenseEditorState,
  travelerId: string,
  zero: boolean,
  travelerIds: string[],
  defaultSplit?: DefaultSplit,
): ExpenseEditorState {
  if (expenseSharesAwaitTotal(state)) return state;
  state = { ...state, implicitZeros: state.implicitZeros?.filter((id) => id !== travelerId) };
  let origin = state.zeroOrigin;
  const automatic = state.method === 'equal' || state.method === 'trip-default';
  if (state.method === 'equal' || state.method === 'trip-default') {
    origin = {
      method: state.method,
      weights: state.method === 'equal'
        ? Object.fromEntries(travelerIds.map((id) => [id, 1]))
        : { ...(defaultSplit ?? Object.fromEntries(
          Object.entries(state.draft.manualSplit).map(([id, entry]) => [id, Number(entry.value)]),
        )) },
      zeros: [],
      expected: {},
    };
  }
  const ids = includedInTripOrder(state.draft, travelerIds);
  const unchanged = origin && (automatic || (
    state.method === 'percent' && state.draft.manualSplitMode === 'percent' &&
    ids.length === Object.keys(origin.expected).length &&
    ids.every((id) => Number(state.draft.manualSplit[id]?.value) === origin.expected[id])
  ));
  // A missing/zero default weight cannot restore a positive share; use the custom fallback.
  if (origin && unchanged && (zero || origin.weights[travelerId] > 0)) {
    const zeros = zero ? unique([...origin.zeros, travelerId]) : origin.zeros.filter((id) => id !== travelerId);
    if (!zeros.length && origin.method === 'equal') {
      return syncPending(state, { ...state, method: 'equal', zeroOrigin: undefined, draft: { ...state.draft, splitType: 'even', manualSplit: {} } });
    }
    const weights = { ...origin.weights, ...Object.fromEntries(zeros.map((id) => [id, 0])) };
    const draft = applyTripDefault(state.draft, weights, editorSplitOrder(state, travelerIds)).draft;
    return syncPending(state, {
      ...state,
      method: zeros.length ? 'percent' : origin.method,
      draft,
      zeroOrigin: zeros.length ? {
        ...origin,
        zeros,
        expected: Object.fromEntries(Object.entries(draft.manualSplit).map(([id, entry]) => [id, Number(entry.value)])),
      } : undefined,
    });
  }
  const mode = manualMode(state.draft);
  // Restore a positive equal share without overwriting other custom entries.
  // If this exceeds the total, normal split validation asks the user to rebalance.
  // Stay on Custom $ when a percent snapshot is only waiting for a total.
  const value = fallbackShareValue(state.draft, travelerIds, zero);
  const method = state.method === 'amount' || state.method === 'percent' ? state.method : mode;
  return syncPending(state, {
    ...state,
    zeroOrigin: undefined,
    method,
    draft: {
      ...state.draft,
      manualSplit: { ...state.draft.manualSplit, [travelerId]: { type: mode, value } },
    },
  });
}

/** A running payer remainder uses integer cents, including overpayment. */
export function expensePayerRemainder(draft: ExpenseDraft): number | null {
  const total = parseScaledInput(draft.totalAmount, 100);
  if (total.kind !== 'ok') return null;
  let paid = 0;
  for (const value of Object.values(draft.paidBy)) {
    const parsed = parseScaledInput(value, 100);
    if (parsed.kind === 'blank') continue;
    if (parsed.kind !== 'ok') return null;
    paid += parsed.units;
  }
  return total.units - paid;
}

/** Short editor copy; validation remains shared with the mutation boundary. */
export function expenseEditorError(error: DraftError): string {
  if (error.code === 'payer-required') return 'Pick who paid.';
  if (error.code === 'split-empty') return 'Include at least one traveler.';
  if (error.code === 'split-sum' && error.message.startsWith('Split totals')) {
    return error.message.replace('Split totals', 'Custom split totals');
  }
  return error.message;
}

/** Invalid custom shares stay in their entered units, clearly marked not final. */
export function expensePreviewLabel(state: ExpenseEditorState, preview: DraftPreview | null, travelerId: string): string {
  const { draft } = state;
  if (!draft.splitParticipants.includes(travelerId)) return 'Not included';
  if (preview?.notFinal && draft.splitType === 'manual') {
    const raw = draft.manualSplit[travelerId]?.value ?? '';
    const mode = manualMode(draft);
    const parsed = parseScaledInput(raw, mode === 'percent' ? PERCENT_SCALE : 100);
    if (parsed.kind !== 'ok' && parsed.kind !== 'blank') return 'Invalid share (not final)';
    const units = parsed.kind === 'ok' ? parsed.units : 0;
    return `${mode === 'percent' ? formatPercentUnits(units) : formatMoney(units)} (not final)`;
  }
  const share = preview?.shares[travelerId];
  if (share === undefined) return preview ? 'Unassigned' : 'Enter an amount';
  return share === 0 && expenseExplicitZero(state, travelerId) ? '$0.00 (explicit)' : formatMoney(share);
}

/** Keep the checkbox and label in agreement about automatic rounding zeros. */
export function expenseExplicitZero(state: ExpenseEditorState, travelerId: string): boolean {
  // Empty dollar placeholders awaiting conversion are not entered zero shares.
  if (state.editablePendingPercents && !hasPositiveTotal(state.draft)) return false;
  // zeroOrigin tracks reversible method changes, not which custom zeros save.
  return showsExplicitZero(state.method, state.draft.splitType, state.draft.manualSplit[travelerId]?.value ?? '')
    && !state.implicitZeros?.includes(travelerId);
}
