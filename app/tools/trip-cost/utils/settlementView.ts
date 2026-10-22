import type { Payment, TripParticipant, UserProfile } from '../pageTypes';
import { isValidLedgerPayment, type Ledger, type Settlement } from './ledger';
import { balanceStatus, makeNameOf } from './ledgerLabels';
import { formatMoney, fromCents, toCents } from './money';
import { uniqueLinkedParticipant } from './payer';

export interface PaymentDraft {
  payerId: string;
  payeeId: string;
  amount: string;
  note: string;
}

/** D4 is a client convenience gate; Firestore enforcement belongs to AR-09. */
export function paymentPermission(
  profile: UserProfile | null,
  participants: TripParticipant[],
  payment?: Pick<PaymentDraft, 'payerId' | 'payeeId'>,
): { allowed: boolean; reason: string } {
  if (!profile) return { allowed: false, reason: 'Sign in to record a payment.' };
  if (profile.isAdmin) return { allowed: true, reason: '' };
  const linked = uniqueLinkedParticipant(participants, profile.uid);
  if (!linked) {
    return { allowed: false, reason: 'Your account must be linked to exactly one traveler to record payments. Ask an admin to link it.' };
  }
  if (payment && payment.payerId !== linked.id && payment.payeeId !== linked.id) {
    return { allowed: false, reason: 'You can record payments you sent or received.' };
  }
  return { allowed: true, reason: '' };
}

/** Suggestions and the general entry point open the same dialog state. */
export function paymentDraft(
  participants: TripParticipant[],
  profile: UserProfile | null,
  suggestion?: Settlement,
): PaymentDraft {
  return {
    payerId: suggestion?.from ?? uniqueLinkedParticipant(participants, profile?.uid)?.id ?? '',
    payeeId: suggestion?.to ?? '',
    amount: suggestion ? fromCents(suggestion.cents).toFixed(2) : '',
    note: '',
  };
}

/** Display only: a reimbursement can exceed either side's current balance. */
export function paymentOverpayWarnings(
  payerId: string,
  payeeId: string,
  cents: number,
  remaining: Ledger['remaining'],
  participants: TripParticipant[],
): string[] {
  if (!Number.isSafeInteger(cents) || cents <= 0) return [];
  const nameOf = makeNameOf(participants);
  const warnings: string[] = [];
  const owes = Math.max(0, remaining[payerId] ?? 0);
  const isOwed = Math.max(0, -(remaining[payeeId] ?? 0));
  if (cents > owes) {
    warnings.push(`${nameOf(payerId)} owes ${formatMoney(owes)}; this records ${formatMoney(cents)}.`);
  }
  if (cents > isOwed) {
    warnings.push(`${nameOf(payeeId)} is owed ${formatMoney(isOwed)}; this records ${formatMoney(cents)}.`);
  }
  return warnings;
}

/** The table uses exactly the ledger's traveler order and existing cents. */
export function balanceBreakdownRows(ledger: Ledger) {
  const metrics = [
    ['Final responsibility', ledger.final],
    ['Paid for purchases', ledger.paid],
    ['Reimbursements sent', ledger.reimbursementsSent],
    ['Reimbursements received', ledger.reimbursementsReceived],
    ['Remaining', ledger.remaining],
  ] as const;
  return metrics.map(([label, values]) => ({
    label,
    cells: ledger.travelerIds.map((id) => ({
      travelerId: id,
      label: label === 'Remaining' ? balanceStatus(values[id] ?? 0).label : formatMoney(values[id] ?? 0),
    })),
  }));
}

/** Invalid legacy dates sort last; equal dates retain stored order. */
export function paymentHistoryRows(
  payments: Payment[],
  participants: TripParticipant[],
  viewerUid?: string,
  travelerIds = participants.map((person) => person.id),
) {
  const nameOf = makeNameOf(participants);
  const dateValue = (payment: Payment) => {
    const parsed = Date.parse(payment.date);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return [...payments].sort((a, b) => dateValue(b) - dateValue(a)).map((payment) => {
    const recorder = participants.find((person) => person.userId === payment.createdBy);
    const cents = toCents(payment.amount);
    return {
      id: payment.id,
      from: nameOf(payment.payerId),
      to: nameOf(payment.payeeId),
      amount: Number.isFinite(cents) ? formatMoney(cents) : 'Invalid amount',
      status: isValidLedgerPayment(payment, travelerIds) ? null : 'Not counted (invalid)',
      note: payment.description,
      date: Number.isFinite(Date.parse(payment.date)) ? new Date(payment.date).toLocaleDateString() : 'Unknown date',
      dateTime: Number.isFinite(Date.parse(payment.date)) ? payment.date : undefined,
      // Never show a raw account uid; unknown recorders are simply omitted.
      recordedBy: !payment.createdBy ? null
        : payment.createdBy === viewerUid ? 'you'
          : recorder?.name ?? null,
    };
  });
}
