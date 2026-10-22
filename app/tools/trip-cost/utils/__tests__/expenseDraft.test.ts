import { describe, expect, it } from 'vitest';
import {
  applyTripDefault,
  convertManualSplit,
  draftToExpenseFields,
  expenseToDraft,
  hasTripDefault,
  travelersMissingFromDefault,
  validateDraft,
  type DraftContext,
  type ExpenseFields,
} from '../expenseDraft';
import { allocateExpense } from '../ledger';
import type { Expense, ExpenseDraft } from '../../pageTypes';

const TRAVELERS = ['kait', 'james', 'bob'];
const ctx: DraftContext = { travelerIds: TRAVELERS };

const draft = (fields: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  category: 'Food',
  description: 'Dinner',
  totalAmount: '100',
  paidBy: { james: '100' },
  splitType: 'even',
  splitParticipants: [...TRAVELERS],
  manualSplit: {},
  manualSplitMode: 'amount',
  ...fields,
});

const manual = (mode: 'amount' | 'percent', values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { type: mode, value }]));

const stored = (fields: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  category: 'Food',
  description: 'Dinner',
  totalAmount: 100,
  paidBy: { james: 100 },
  splitType: 'even',
  splitParticipants: [...TRAVELERS],
  manualSplit: {},
  createdBy: 'uid-james',
  ...fields,
});

const fieldsOf = (e: Expense): ExpenseFields => ({
  category: e.category,
  description: e.description,
  totalAmount: e.totalAmount,
  paidBy: e.paidBy,
  splitType: e.splitType,
  splitParticipants: e.splitParticipants,
  manualSplit: e.manualSplit,
});

const codes = (d: ExpenseDraft, c: DraftContext = ctx) => validateDraft(d, c).errors.map((e) => e.code);

const save = (d: ExpenseDraft, c: DraftContext = ctx): ExpenseFields => {
  const result = draftToExpenseFields(d, c);
  if (!result.fields) throw new Error(result.errors.map((e) => e.message).join(' '));
  return result.fields;
};

/* ------------------------------------------------------------------ */
/*  Split methods                                                      */
/* ------------------------------------------------------------------ */

describe('split methods', () => {
  it('Equal: stores an even split and previews cents-exact shares', () => {
    const { errors, preview } = validateDraft(draft(), ctx);
    expect(errors).toEqual([]);
    expect(preview?.shares).toEqual({ kait: 3334, james: 3333, bob: 3333 });
    expect(preview?.totalCents).toBe(10000);
    expect(save(draft())).toEqual({
      category: 'Food',
      description: 'Dinner',
      totalAmount: 100,
      paidBy: { james: 100 },
      splitType: 'even',
      splitParticipants: TRAVELERS,
      manualSplit: {},
    });
  });

  it('Custom $: stores amounts that sum exactly to the total', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '20', james: '30.5', bob: '49.50' }) });
    expect(validateDraft(d, ctx).preview?.shares).toEqual({ kait: 2000, james: 3050, bob: 4950 });
    expect(save(d).manualSplit).toEqual({
      kait: { type: 'amount', value: 20 },
      james: { type: 'amount', value: 30.5 },
      bob: { type: 'amount', value: 49.5 },
    });
  });

  it('Custom %: stores percentages that sum to exactly 100', () => {
    const d = draft({
      splitType: 'manual',
      manualSplitMode: 'percent',
      manualSplit: manual('percent', { kait: '33.33', james: '33.33', bob: '33.34' }),
    });
    expect(validateDraft(d, ctx).preview?.shares).toEqual({ kait: 3333, james: 3333, bob: 3334 });
    expect(save(d).manualSplit).toEqual({
      kait: { type: 'percent', value: 33.33 },
      james: { type: 'percent', value: 33.33 },
      bob: { type: 'percent', value: 33.34 },
    });
  });

  it('Trip default: saves a percent snapshot that previews like the ledger', () => {
    const { draft: d } = applyTripDefault(draft(), { kait: 50, james: 25, bob: 25 }, TRAVELERS);
    const fields = save(d);
    expect(fields.splitType).toBe('manual');
    expect(fields.manualSplit).toEqual({
      kait: { type: 'percent', value: 50 },
      james: { type: 'percent', value: 25 },
      bob: { type: 'percent', value: 25 },
    });
    expect(validateDraft(d, ctx).preview?.shares).toEqual({ kait: 5000, james: 2500, bob: 2500 });
  });

  it('several payers must cover the total exactly', () => {
    expect(codes(draft({ paidBy: { james: '60', bob: '40' } }))).toEqual([]);
    expect(save(draft({ paidBy: { james: '60', bob: '40', kait: '' } })).paidBy).toEqual({ james: 60, bob: 40 });
  });

  it('preview always matches what the ledger allocates for the saved expense', () => {
    const drafts = [
      draft({ totalAmount: '0.01', paidBy: { james: '0.01' } }),
      draft({ totalAmount: '1000.03', paidBy: { james: '1000.03' }, splitParticipants: ['bob', 'kait'] }),
      draft({ splitType: 'manual', manualSplitMode: 'percent', manualSplit: manual('percent', { kait: '12.3456', james: '87.6544', bob: '0' }) }),
    ];
    for (const d of drafts) {
      const preview = validateDraft(d, ctx).preview;
      const allocation = allocateExpense({ ...save(d), id: 'x', createdBy: 'u' }, TRAVELERS);
      expect(preview?.shares).toEqual(allocation.shares);
      expect(Object.values(allocation.shares).reduce((s, n) => s + n, 0)).toBe(allocation.totalCents);
      expect(allocation.problems).toEqual([]);
    }
  });

  it('stores split participants in trip order', () => {
    expect(save(draft({ splitParticipants: ['bob', 'kait', 'bob'] })).splitParticipants).toEqual(['kait', 'bob']);
  });
});

/* ------------------------------------------------------------------ */
/*  Explicit zero vs excluded                                          */
/* ------------------------------------------------------------------ */

describe('explicit zero vs excluded', () => {
  it('an excluded traveler is left out of splitParticipants and shown as not included', () => {
    const d = draft({ splitParticipants: ['kait', 'james'] });
    const { preview } = validateDraft(d, ctx);
    expect(preview?.excluded).toEqual(['bob']);
    expect(preview?.zeroShare).toEqual([]);
    expect(preview?.shares).toEqual({ kait: 5000, james: 5000 });
    const fields = save(d);
    expect(fields.splitParticipants).toEqual(['kait', 'james']);
    expect(fields.manualSplit).toEqual({});
  });

  it('an explicit zero stays included with a stored $0 share', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '0', james: '50', bob: '50' }) });
    const { preview } = validateDraft(d, ctx);
    expect(preview?.excluded).toEqual([]);
    expect(preview?.zeroShare).toEqual(['kait']);
    expect(preview?.shares.kait).toBe(0);
    const fields = save(d);
    expect(fields.splitParticipants).toContain('kait');
    expect(fields.manualSplit.kait).toEqual({ type: 'amount', value: 0 });
  });

  it('a blank share for an included traveler is saved as an explicit zero', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { james: '50', bob: '50' }) });
    expect(save(d).manualSplit.kait).toEqual({ type: 'amount', value: 0 });
  });

  it('values typed for an excluded traveler are not saved', () => {
    const d = draft({
      splitType: 'manual',
      splitParticipants: ['james', 'bob'],
      manualSplit: manual('amount', { kait: '10', james: '50', bob: '50' }),
    });
    const fields = save(d);
    expect(fields.manualSplit).not.toHaveProperty('kait');
    expect(validateDraft(d, ctx).preview?.excluded).toEqual(['kait']);
  });
});

/* ------------------------------------------------------------------ */
/*  $ ↔ % conversion                                                   */
/* ------------------------------------------------------------------ */

describe('$ ↔ % conversion', () => {
  it('converts dollars to percentages that still total 100%', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '33.33', james: '33.33', bob: '33.34' }) });
    const converted = convertManualSplit(d, 'percent', TRAVELERS);
    expect(converted.manualSplitMode).toBe('percent');
    expect(converted.manualSplit).toEqual(manual('percent', { kait: '33.33', james: '33.33', bob: '33.34' }));
    expect(codes(converted)).toEqual([]);
  });

  it('converts percentages to dollars that still total the amount', () => {
    const d = draft({
      splitType: 'manual',
      manualSplitMode: 'percent',
      manualSplit: manual('percent', { kait: '50', james: '25', bob: '25' }),
      totalAmount: '10.01',
      paidBy: { james: '10.01' },
    });
    const converted = convertManualSplit(d, 'amount', TRAVELERS);
    expect(converted.manualSplit).toEqual(manual('amount', { kait: '5.01', james: '2.50', bob: '2.50' }));
    expect(codes(converted)).toEqual([]);
  });

  it('round-trips $ → % → $ without losing a cent', () => {
    const d = draft({ splitType: 'manual', totalAmount: '100', manualSplit: manual('amount', { kait: '10', james: '20', bob: '70' }) });
    const back = convertManualSplit(convertManualSplit(d, 'percent', TRAVELERS), 'amount', TRAVELERS);
    expect(back.manualSplit).toEqual(manual('amount', { kait: '10.00', james: '20.00', bob: '70.00' }));
  });

  it('keeps blanks blank and converts values that do not yet add up one by one', () => {
    const d = draft({ splitType: 'manual', totalAmount: '200', manualSplit: manual('amount', { kait: '50', james: '' }) });
    const converted = convertManualSplit(d, 'percent', TRAVELERS);
    expect(converted.manualSplit).toEqual(manual('percent', { kait: '25', james: '', bob: '' }));
  });

  it('clears percent → $ values when there is no valid total', () => {
    const d = draft({ splitType: 'manual', manualSplitMode: 'percent', totalAmount: '', manualSplit: manual('percent', { kait: '100' }) });
    expect(convertManualSplit(d, 'amount', TRAVELERS).manualSplit.kait).toEqual({ type: 'amount', value: '' });
  });

  it('switching to the current mode changes nothing', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '100' }) });
    expect(convertManualSplit(d, 'amount', TRAVELERS)).toEqual(d);
  });
});

/* ------------------------------------------------------------------ */
/*  Exact-cent validation (C5)                                         */
/* ------------------------------------------------------------------ */

describe('exact-cent validation on new writes', () => {
  it('rejects a Custom $ split that misses the total by one cent', () => {
    const d = draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '33.33', james: '33.33', bob: '33.33' }) });
    const { errors } = validateDraft(d, ctx);
    expect(errors.map((e) => e.code)).toEqual(['split-sum']);
    expect(errors[0].message).toBe('Split totals $99.99 of $100.00.');
    expect(draftToExpenseFields(d, ctx).fields).toBeNull();
  });

  it('rejects a Custom % split at 99.99%', () => {
    const d = draft({
      splitType: 'manual',
      manualSplitMode: 'percent',
      manualSplit: manual('percent', { kait: '33.33', james: '33.33', bob: '33.33' }),
    });
    const { errors } = validateDraft(d, ctx);
    expect(errors.map((e) => e.code)).toEqual(['split-sum']);
    expect(errors[0].message).toBe('Percentages total 99.99% of 100%.');
  });

  it('rejects payers that miss the total by one cent', () => {
    const { errors } = validateDraft(draft({ paidBy: { james: '99.99' } }), ctx);
    expect(errors.map((e) => e.code)).toEqual(['payer-sum']);
    expect(errors[0].message).toBe('Payers total $99.99 of $100.00.');
  });

  it('rejects fractional cents in the total, payers and shares', () => {
    expect(codes(draft({ totalAmount: '10.005', paidBy: { james: '10.005' } }))).toEqual(['total-fractional-cent', 'payer-invalid']);
    expect(
      codes(draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '50.005', james: '49.995', bob: '0' }) })),
    ).toEqual(['share-invalid', 'share-invalid']);
    expect(
      codes(draft({ splitType: 'manual', manualSplitMode: 'percent', manualSplit: manual('percent', { kait: '33.33333', james: '66.66667' }) })),
    ).toEqual(['share-invalid', 'share-invalid']);
  });

  it('rejects zero, negative and non-numeric totals and shares', () => {
    expect(codes(draft({ totalAmount: '0', paidBy: {} }), { ...ctx, defaultPayerId: 'james' })).toEqual(['total-invalid']);
    expect(codes(draft({ totalAmount: '-5', paidBy: {} }), { ...ctx, defaultPayerId: 'james' })).toEqual(['total-invalid']);
    expect(codes(draft({ totalAmount: '12abc' }))).toEqual(['total-invalid']);
    expect(codes(draft({ paidBy: { james: '-100' } }))).toEqual(['payer-invalid']);
    expect(
      codes(draft({ splitType: 'manual', manualSplit: manual('amount', { kait: '-10', james: '110', bob: '0' }) })),
    ).toEqual(['share-invalid']);
  });

  it('rejects unknown travelers, unknown payers, and an empty split', () => {
    expect(codes(draft({ splitParticipants: ['kait', 'ghost'] }))).toEqual(['split-unknown']);
    expect(codes(draft({ paidBy: { ghost: '100' } }))).toEqual(['payer-unknown']);
    expect(codes(draft({ splitParticipants: [] }))).toEqual(['split-empty']);
  });

  it('requires a description', () => {
    expect(codes(draft({ description: '   ' }))).toEqual(['description-required']);
    expect(save(draft({ description: '  Dinner  ' })).description).toBe('Dinner');
  });

  it('defaults a blank payer only to the uniquely linked participant', () => {
    expect(codes(draft({ paidBy: {} }))).toEqual(['payer-required']);
    expect(save(draft({ paidBy: { james: '' } }), { ...ctx, defaultPayerId: 'bob' }).paidBy).toEqual({ bob: 100 });
  });

  it('accepts binary-noise decimals that are whole cents', () => {
    const d = draft({ totalAmount: '0.29', paidBy: { james: '0.29' }, splitType: 'manual', manualSplit: manual('amount', { kait: '0.29' }) });
    expect(codes(d)).toEqual([]);
    expect(save(d).totalAmount).toBe(0.29);
  });

  it('has no preview until the total is valid', () => {
    expect(validateDraft(draft({ totalAmount: '' }), ctx).preview).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Trip default (D2)                                                  */
/* ------------------------------------------------------------------ */

describe('trip default split', () => {
  it('rescales the remaining percentages when a traveler is excluded', () => {
    const { draft: d, missing } = applyTripDefault(
      draft({ splitParticipants: ['kait', 'james'] }),
      { kait: 50, james: 25, bob: 25 },
      TRAVELERS,
    );
    expect(missing).toEqual([]);
    expect(d.manualSplit).toEqual(manual('percent', { kait: '66.6667', james: '33.3333' }));
    expect(codes(d)).toEqual([]);
    expect(validateDraft(d, ctx).preview?.shares).toEqual({ kait: 6667, james: 3333 });
  });

  it('gives travelers missing from the default an explicit 0%', () => {
    const { draft: d, missing } = applyTripDefault(draft(), { kait: 60, james: 40 }, TRAVELERS);
    expect(missing).toEqual(['bob']);
    expect(d.manualSplit.bob).toEqual({ type: 'percent', value: '0' });
    const fields = save(d);
    expect(fields.splitParticipants).toContain('bob');
    expect(fields.manualSplit.bob).toEqual({ type: 'percent', value: 0 });
  });

  it('cannot be saved when the default gives everyone selected 0%', () => {
    const { draft: d } = applyTripDefault(draft({ splitParticipants: ['bob'] }), { kait: 100 }, TRAVELERS);
    expect(codes(d)).toEqual(['split-sum']);
  });

  it('reports whether a usable default exists and who is missing from it', () => {
    expect(hasTripDefault(undefined)).toBe(false);
    expect(hasTripDefault({ kait: 0 })).toBe(false);
    expect(hasTripDefault({ kait: 100 })).toBe(true);
    expect(travelersMissingFromDefault({ kait: 100, james: 0 }, TRAVELERS)).toEqual(['bob']);
  });

  it('never changes a saved expense when the default changes', () => {
    const { draft: d } = applyTripDefault(draft(), { kait: 50, james: 25, bob: 25 }, TRAVELERS);
    const fields = save(d);
    applyTripDefault(draft(), { kait: 10, james: 10, bob: 80 }, TRAVELERS);
    expect(fields.manualSplit.kait).toEqual({ type: 'percent', value: 50 });
  });
});

/* ------------------------------------------------------------------ */
/*  Legacy round-trip                                                  */
/* ------------------------------------------------------------------ */

describe('legacy round-trip', () => {
  const legacy: Record<string, Expense> = {
    even: stored(),
    multiPayer: stored({ paidBy: { james: 60.5, bob: 39.5 } }),
    amounts: stored({
      splitType: 'manual',
      manualSplit: { kait: { type: 'amount', value: 20 }, james: { type: 'amount', value: 80 } },
      splitParticipants: ['kait', 'james'],
    }),
    // Allowed by the old ±0.01% tolerance; strict validation would reject it.
    percent9999: stored({
      totalAmount: 10000,
      paidBy: { james: 10000 },
      splitType: 'manual',
      manualSplit: {
        kait: { type: 'percent', value: 33.33 },
        james: { type: 'percent', value: 33.33 },
        bob: { type: 'percent', value: 33.33 },
      },
    }),
    // Payers within the old ±$0.01 tolerance.
    payerOffByCent: stored({ paidBy: { james: 99.99 } }),
    // Old form stored a blank share by omitting it.
    blankShare: stored({
      splitType: 'manual',
      manualSplit: { james: { type: 'amount', value: 50 }, bob: { type: 'amount', value: 50 } },
    }),
    mixedTypes: stored({
      splitType: 'manual',
      manualSplit: { kait: { type: 'amount', value: 50 }, james: { type: 'percent', value: 50 } },
      splitParticipants: ['kait', 'james'],
    }),
    // Out of trip order, an unknown traveler, and an empty description.
    oddOrder: stored({ splitParticipants: ['bob', 'ghost', 'kait'], description: '' }),
    emptySplit: stored({ splitParticipants: [] }),
  };

  for (const [name, e] of Object.entries(legacy)) {
    it(`${name}: loading and saving without edits leaves stored values unchanged`, () => {
      const result = draftToExpenseFields(expenseToDraft(e), { ...ctx, original: e });
      expect(result.errors).toEqual([]);
      expect(result.fields).toStrictEqual(fieldsOf(e));
    });
  }

  it('valid modern records round-trip even without the original', () => {
    for (const e of [legacy.even, legacy.multiPayer, legacy.amounts]) {
      expect(save(expenseToDraft(e))).toEqual(fieldsOf(e));
    }
  });

  it('editing only the description keeps legacy money values verbatim', () => {
    const e = legacy.percent9999;
    const fields = save({ ...expenseToDraft(e), description: 'Hotel' }, { ...ctx, original: e });
    expect(fields).toStrictEqual({ ...fieldsOf(e), description: 'Hotel' });
  });

  it.each(['percent9999', 'mixedTypes', 'blankShare', 'oddOrder'])(
    '%s: changing only the payer preserves the stored split verbatim', (name) => {
      const e = legacy[name];
      const d = { ...expenseToDraft(e), paidBy: { bob: String(e.totalAmount) } };
      const fields = save(d, { ...ctx, original: e });
      expect(fields).toStrictEqual({ ...fieldsOf(e), paidBy: { bob: e.totalAmount } });
      expect(validateDraft(d, { ...ctx, original: e }).preview?.shares)
        .toEqual(allocateExpense({ ...e, ...fields }, TRAVELERS).shares);
    },
  );

  it.each([
    [{ bob: '9999.99' }, 'payer-sum'],
    [{ ghost: '10000' }, 'payer-unknown'],
    [{ bob: '10000.001' }, 'payer-invalid'],
    [{}, 'payer-required'],
  ] as const)('still validates changed payers with an untouched legacy split: %j', (paidBy, code) => {
    const e = legacy.percent9999;
    const d = { ...expenseToDraft(e), paidBy };
    expect(codes(d, { ...ctx, original: e })).toEqual([code]);
    expect(draftToExpenseFields(d, { ...ctx, original: e }).fields).toBeNull();
  });

  it('changing only the split preserves untouched legacy total and payers', () => {
    const e = legacy.payerOffByCent;
    const d = {
      ...expenseToDraft(e),
      splitType: 'manual' as const,
      manualSplit: manual('amount', { kait: '20', james: '30', bob: '50' }),
    };
    expect(save(d, { ...ctx, original: e })).toStrictEqual({
      ...fieldsOf(e), splitType: 'manual',
      manualSplit: {
        kait: { type: 'amount', value: 20 },
        james: { type: 'amount', value: 30 },
        bob: { type: 'amount', value: 50 },
      },
    });
    d.manualSplit.bob.value = '49.99';
    expect(codes(d, { ...ctx, original: e })).toEqual(['split-sum']);
  });

  it('revalidates legacy splits after the total or split mode changes', () => {
    const e = legacy.percent9999;
    expect(codes({ ...expenseToDraft(e), totalAmount: '12000', paidBy: { bob: '12000' } }, { ...ctx, original: e }))
      .toEqual(['split-sum']);
    expect(codes({ ...expenseToDraft(e), manualSplitMode: 'amount' }, { ...ctx, original: e }))
      .toEqual(['split-sum']);
  });

  it('changing a legacy amount requires the split to add up exactly', () => {
    const e = legacy.payerOffByCent;
    expect(codes({ ...expenseToDraft(e), totalAmount: '120' }, { ...ctx, original: e })).toEqual(['payer-sum']);
  });

  it('loads legacy mixed $/% splits as Custom $ using the ledger allocation', () => {
    const d = expenseToDraft(legacy.mixedTypes);
    expect(d.manualSplitMode).toBe('amount');
    expect(d.manualSplit).toEqual(manual('amount', { kait: '50.00', james: '50.00' }));
  });

  it('loads stored values exactly, including payers and split participants', () => {
    const d = expenseToDraft(legacy.multiPayer);
    expect(d.paidBy).toEqual({ james: '60.5', bob: '39.5' });
    expect(d.totalAmount).toBe('100');
    expect(d.splitParticipants).toEqual(TRAVELERS);
  });
});
