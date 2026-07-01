export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import { sanitizeUpstreamError } from '@/app/tools/transcriber/lib/sanitizeUpstreamError';

const GEMINI_FILES_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/files';

/** `name` must look like "files/xyz" — validated before it's interpolated into the upstream URL. */
const FILE_NAME_PATTERN = /^files\/[A-Za-z0-9_-]+$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

function requireAuth(req: NextRequest) {
  return requireAdminUser(req);
}

function getValidatedFileName(req: NextRequest): string | null {
  const name = req.nextUrl.searchParams.get('name') ?? '';
  return FILE_NAME_PATTERN.test(name) ? name : null;
}

/**
 * GET polls a previously-uploaded Gemini file's activation state (client
 * polls this every GEMINI_FILE_POLL_INTERVAL_MS until `state` is 'ACTIVE',
 * or GEMINI_FILE_POLL_TIMEOUT_MS elapses — see lib/providers/geminiProvider.ts).
 */
export async function GET(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAuth(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  const name = getValidatedFileName(req);
  if (!name) {
    return NextResponse.json({ error: 'Invalid or missing file name.' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GEMINI_FILES_BASE_URL}/${name.slice('files/'.length)}`, {
      headers: { 'x-goog-api-key': key },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const sanitized = sanitizeUpstreamError(errText);
      return NextResponse.json(
        { state: 'FAILED', error: sanitized || `Gemini file lookup failed (${res.status}).` },
        { status: res.status },
      );
    }

    const data: JsonRecord = await res.json();
    return NextResponse.json({
      state: typeof data.state === 'string' ? data.state : 'UNKNOWN',
      fileUri: typeof data.uri === 'string' ? data.uri : undefined,
    });
  } catch {
    return NextResponse.json({ state: 'FAILED', error: 'Network error checking the Gemini file status.' }, { status: 502 });
  }
}

/**
 * DELETE is best-effort post-run cleanup for a Gemini-uploaded file. Always
 * responds 200 with `{deleted: boolean}` — a failed upstream delete is a
 * warning to surface to the user, never a hard pipeline failure, since the
 * transcription run itself already succeeded or failed independently of
 * this cleanup step.
 */
export async function DELETE(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAuth(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ deleted: false, detail: 'GEMINI_API_KEY not configured.' });
  }

  const name = getValidatedFileName(req);
  if (!name) {
    return NextResponse.json({ deleted: false, detail: 'Invalid or missing file name.' });
  }

  try {
    const res = await fetch(`${GEMINI_FILES_BASE_URL}/${name.slice('files/'.length)}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': key },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const sanitized = sanitizeUpstreamError(errText);
      return NextResponse.json({ deleted: false, detail: sanitized || `Gemini delete failed (${res.status}).` });
    }

    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ deleted: false, detail: 'Network error deleting the Gemini file.' });
  }
}
