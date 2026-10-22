"use client";

import React, { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Dialog from '../ui/Dialog';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { fromCents } from '../../utils/money';
import { validatePayment } from '../../utils/payment';
import { paymentOverpayWarnings, paymentPermission, type PaymentDraft } from '../../utils/settlementView';

interface RecordPaymentDialogProps {
  initial: PaymentDraft;
  userProfile: UserProfile | null;
  onClose: () => void;
}

/** One mounted session per opening; late saves cannot affect a later session. */
export default function RecordPaymentDialog({ initial, userProfile, onClose }: RecordPaymentDialogProps) {
  const { participants, ledger, addPayment } = useTrip();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const busy = useRef(false);
  const formId = useId();
  const reasonId = `${formId}-reason`;
  const warningId = `${formId}-warning`;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const validation = validatePayment(draft, participants.map((person) => person.id));
  const permission = paymentPermission(userProfile, participants, draft);
  const reason = saving ? 'Saving payment…'
    : permission.reason || validation.errors.map((issue) => issue.message).join(' ');
  const warnings = validation.cents === null ? [] : paymentOverpayWarnings(
    draft.payerId, draft.payeeId, validation.cents, ledger.remaining, participants,
  );
  const close = () => {
    active.current = false;
    onClose();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !active.current || !permission.allowed || validation.cents === null || !userProfile) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await addPayment(draft.payerId, draft.payeeId, fromCents(validation.cents), draft.note.trim(), userProfile.uid);
      if (active.current) close();
    } catch (failure) {
      if (active.current) {
        setError(failure instanceof Error ? failure.message : 'Could not record payment. Please try again.');
      }
    } finally {
      if (active.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <Dialog open title="Record payment" onClose={close} footer={
      <div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere]">
        <p id={reasonId} aria-live="polite" className="text-sm text-error">{reason}</p>
        <p id={`${formId}-error`} role={error ? 'alert' : undefined} className="text-sm text-error">{error}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          <Button
            type="submit"
            form={formId}
            variant="success"
            loading={saving}
            disabled={saving || !permission.allowed || validation.cents === null}
            aria-describedby={`${reasonId} ${warningId} ${formId}-error`}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    }>
      <form id={formId} onSubmit={(event) => void save(event)} noValidate className="min-w-0 space-y-4">
        <p className="text-sm text-text-2">Logs a reimbursement that already happened (cash, Venmo…). This does not send money.</p>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          {(['payerId', 'payeeId'] as const).map((field) => (
            <label key={field} className="block min-w-0 text-sm text-text-2">
              {field === 'payerId' ? 'From' : 'To'}
              <Select
                value={draft[field]}
                className="mt-1 w-full min-w-0 max-w-full"
                aria-describedby={reasonId}
                aria-invalid={validation.errors.some((issue) => issue.code.startsWith(field === 'payerId' ? 'payer' : 'payee') || issue.code === 'same-person')}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              >
                <option value="">{field === 'payerId' ? 'Choose who paid' : 'Choose who was paid'}</option>
                {participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </Select>
            </label>
          ))}
          <label className="block text-sm text-text-2">
            Amount ($)
            <Input
              type="text"
              inputMode="decimal"
              value={draft.amount}
              className="mt-1 w-full min-w-0"
              aria-describedby={`${reasonId} ${warningId}`}
              aria-invalid={validation.errors.some((issue) => issue.code.startsWith('amount'))}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </label>
          <label className="block text-sm text-text-2">
            Note (optional)
            <Input
              value={draft.note}
              className="mt-1 w-full min-w-0"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </fieldset>
        <div id={warningId} aria-live="polite" className="space-y-1 break-words text-sm text-warning [overflow-wrap:anywhere]">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      </form>
    </Dialog>
  );
}
