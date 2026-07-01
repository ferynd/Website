'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { sendEmailVerification, type User } from 'firebase/auth';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import Button from '@/components/Button';
import { ADMIN_EMAIL } from '../../trip-cost/firebaseConfig';
import { ACCEPTED_FILE_EXTENSIONS, MAX_GEMINI_UPLOAD_BYTES, MAX_OPENAI_UPLOAD_BYTES } from '../lib/constants';

interface StatusResponse {
  signedIn: boolean;
  emailMatches: boolean;
  emailVerified: boolean;
  email: string | null;
  transcribeKeyConfigured: boolean | null;
  correctionKeyConfigured: boolean | null;
}

const OPENAI_MAX_MB = (MAX_OPENAI_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
const GEMINI_MAX_MB = (MAX_GEMINI_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);

function Row({ ok, label, detail }: { ok: boolean | null; label: string; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      {ok === null ? (
        <Loader2 size={16} className="animate-spin text-text-3 flex-shrink-0 mt-0.5" />
      ) : ok ? (
        <Check size={16} className="text-success flex-shrink-0 mt-0.5" />
      ) : (
        <X size={16} className="text-error flex-shrink-0 mt-0.5" />
      )}
      <div className="space-y-2 min-w-0">
        <span className={ok === false ? 'text-error' : 'text-text'}>{label}</span>
        {detail && <div className="text-text-3 text-xs">{detail}</div>}
      </div>
    </li>
  );
}

/**
 * Self-checking requirements panel for the Transcriber page. Every check
 * here is convenience/explanation only — `requireAdminUser` on each API
 * route is what actually enforces access (see verifyFirebaseAuth.ts). This
 * exists so a failure (most commonly: the account's email isn't verified)
 * is visible and explained *before* the admin uploads a file, instead of
 * surfacing only as a generic 401 mid-run.
 */
export default function RequirementsPanel({ user }: { user: User }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(!user.emailVerified);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // Reload the account first, then force a fresh ID token — otherwise
      // both the local `user.emailVerified` flag and the token's
      // `email_verified` claim can keep reflecting stale state from before
      // a verification link was clicked, even across sign-out/sign-in.
      await user.reload();
      const idToken = await user.getIdToken(true);
      const res = await fetch('/api/transcriber/status', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      if (!data.emailMatches || !data.emailVerified || data.transcribeKeyConfigured === false || data.correctionKeyConfigured === false) {
        setOpen(true);
      }
    } catch (err) {
      setStatus(null);
      setLoadError(err instanceof Error ? err.message : 'Could not check status.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
    // Only re-run when the signed-in account changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  const handleResend = async () => {
    setSendState('sending');
    setSendError('');
    try {
      await sendEmailVerification(user);
      setSendState('sent');
    } catch (err) {
      setSendState('error');
      setSendError(err instanceof Error ? err.message : 'Could not send verification email.');
    }
  };

  const allGood =
    !!status &&
    status.emailMatches &&
    status.emailVerified &&
    status.transcribeKeyConfigured !== false &&
    status.correctionKeyConfigured !== false;

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 sm:p-6 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left focus-ring rounded"
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          Requirements
          {loading && !status ? (
            <Loader2 size={14} className="animate-spin text-text-3" />
          ) : allGood ? (
            <span className="text-success text-xs font-normal">All checks passed</span>
          ) : (
            <span className="text-error text-xs font-normal">Action needed</span>
          )}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <ul className="space-y-3 pt-1">
          <Row ok={!!status?.signedIn} label={`Signed in${status?.email ? ` as ${status.email}` : ''}`} />
          <Row
            ok={status ? status.emailMatches : null}
            label="Using the site owner's account"
            detail={
              status && !status.emailMatches
                ? `This tool only works for ${ADMIN_EMAIL}. Sign out and sign back in with that account.`
                : undefined
            }
          />
          <Row
            ok={status ? status.emailVerified : null}
            label="Email verified"
            detail={
              status && !status.emailVerified ? (
                <div className="space-y-2">
                  <p>
                    Every API request independently checks Firebase&apos;s <code>email_verified</code> claim on this
                    account, so if the address was never actually verified, signing out and back in won&apos;t clear
                    this — it re-fetches the same unverified state. Send a verification email, click the link it
                    contains, then recheck.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleResend}
                      disabled={sendState === 'sending'}
                    >
                      {sendState === 'sending' ? 'Sending…' : 'Resend verification email'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={refresh} disabled={loading}>
                      I clicked the link — recheck
                    </Button>
                  </div>
                  {sendState === 'sent' && (
                    <p className="text-success">
                      Sent to {user.email}. Open the email (check spam too), click the verify link, then click
                      &quot;recheck&quot; above.
                    </p>
                  )}
                  {sendState === 'error' && <p className="text-error">{sendError}</p>}
                </div>
              ) : undefined
            }
          />
          <Row
            ok={status?.transcribeKeyConfigured ?? null}
            label="OpenAI transcription key configured on the server"
            detail={
              status?.transcribeKeyConfigured === false
                ? 'GPT_API_KEY is not set in this deployment. Transcription requests will fail until it is.'
                : status && !status.emailVerified
                  ? 'Rechecked automatically once your email is verified.'
                  : undefined
            }
          />
          <Row
            ok={status?.correctionKeyConfigured ?? null}
            label="Gemini key configured on the server (cleanup pass + Gemini direct transcription)"
            detail={
              status?.correctionKeyConfigured === false
                ? 'GEMINI_API_KEY is not set in this deployment. The cleanup pass and the Gemini transcription provider will both fail until it is — use an OpenAI provider and "Skip cleanup" below to bypass it entirely.'
                : status && !status.emailVerified
                  ? 'Rechecked automatically once your email is verified.'
                  : undefined
            }
          />
          <Row
            ok={true}
            label={`Audio file: ${ACCEPTED_FILE_EXTENSIONS.join(', ')} — up to ${OPENAI_MAX_MB} MB (OpenAI) or ${GEMINI_MAX_MB} MB (Gemini)`}
            detail="Larger files need to be compressed (lower bitrate) or split before uploading."
          />

          {loadError && (
            <li className="text-sm text-error flex items-center gap-2">
              {loadError}
              <Button type="button" size="sm" variant="ghost" onClick={refresh}>
                Retry
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
