import { parseScaledInput } from './money';

/* ------------------------------------------------------------------ */
/*  Reimbursement (payment) validation — C10                           */
/* ------------------------------------------------------------------ */

export type PaymentErrorCode =
  | 'amount-invalid'
  | 'amount-not-positive'
  | 'amount-fractional-cent'
  | 'payer-required'
  | 'payee-required'
  | 'payer-unknown'
  | 'payee-unknown'
  | 'same-person';

export interface PaymentError {
  code: PaymentErrorCode;
  message: string;
}

export interface PaymentInput {
  payerId: string;
  payeeId: string;
  /** Dollars, as typed or as a number. */
  amount: number | string;
}

export interface PaymentValidation {
  errors: PaymentError[];
  /** Integer cents when the amount is valid, otherwise null. */
  cents: number | null;
}

/**
 * A payment is valid when the amount is greater than $0 in whole cents and
 * the payer and payee are two different travelers on the trip.
 */
export function validatePayment(input: PaymentInput, travelerIds: string[]): PaymentValidation {
  const known = new Set(travelerIds);
  const errors: PaymentError[] = [];

  let cents: number | null = null;
  const parsed = parseScaledInput(input.amount, 100);
  if (parsed.kind === 'fractional') {
    errors.push({ code: 'amount-fractional-cent', message: 'Enter the payment amount in whole cents.' });
  } else if (parsed.kind === 'negative' || (parsed.kind === 'ok' && parsed.units === 0)) {
    errors.push({ code: 'amount-not-positive', message: 'Enter a payment amount greater than $0.' });
  } else if (parsed.kind !== 'ok') {
    errors.push({ code: 'amount-invalid', message: 'Enter a valid payment amount.' });
  } else {
    cents = parsed.units;
  }

  const { payerId, payeeId } = input;
  if (!payerId) {
    errors.push({ code: 'payer-required', message: 'Choose who paid.' });
  } else if (!known.has(payerId)) {
    errors.push({ code: 'payer-unknown', message: "The payer isn't on this trip." });
  }
  if (!payeeId) {
    errors.push({ code: 'payee-required', message: 'Choose who was paid.' });
  } else if (!known.has(payeeId)) {
    errors.push({ code: 'payee-unknown', message: "The person paid isn't on this trip." });
  }
  if (payerId && payerId === payeeId) {
    errors.push({ code: 'same-person', message: "Payer and payee can't be the same person." });
  }

  return { errors, cents: errors.length ? null : cents };
}
