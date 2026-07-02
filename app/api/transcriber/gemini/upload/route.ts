export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import { MAX_GEMINI_UPLOAD_BYTES } from '@/app/tools/transcriber/lib/constants';
import { sanitizeUpstreamError } from '@/app/tools/transcriber/lib/sanitizeUpstreamError';
import type { TranscribeErrorInfo } from '@/app/tools/transcriber/lib/types';

// Step 1 of the documented Gemini Files API resumable-upload protocol —
// starts the session and returns an upload URL via the x-goog-upload-url
// response header (read below; there is no URL in the JSON body).
const GEMINI_FILES_UPLOAD_START_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

/* ------------------------------------------------------------ */
/* CONFIGURATION: extension -> normalized MIME map               */
/* ------------------------------------------------------------ */

/** Used only when the browser reports an empty/generic file.type — mirrors ACCEPTED_FILE_EXTENSIONS in lib/constants.ts. */
const EXTENSION_MIME_MAP: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream']);

/** This route's "model" is really the Files API, not a generateContent model — used only as a label in structured error responses. */
const GEMINI_FILES_API_LABEL = 'gemini-files-api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

function normalizeMimeType(fileName: string, browserMime: string): string {
  if (!GENERIC_MIME_TYPES.has(browserMime)) return browserMime;
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
}

function uploadErrorResponse(params: {
  error: string;
  stage: TranscribeErrorInfo['stage'];
  upstreamStatus: number | null;
  /** Sanitized upstream response text, when there was an actual upstream response to sanitize. Falls back to `error` when omitted/empty — the client (geminiProvider.ts) prefers errorInfo.upstreamBody over the plain `error` string, so this must never be silently blanked out for a failure that has no real upstream body (e.g. a local validation or shape check). */
  upstreamBody?: string;
  httpStatus: number;
}) {
  const { error, stage, upstreamStatus, upstreamBody, httpStatus } = params;
  return NextResponse.json(
    {
      error,
      errorInfo: {
        provider: 'gemini',
        model: GEMINI_FILES_API_LABEL,
        stage,
        upstreamStatus,
        upstreamBody: upstreamBody || error,
      } satisfies TranscribeErrorInfo,
    },
    { status: httpStatus },
  );
}

export async function POST(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAdminUser(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No audio file provided.' }, { status: 400 });
  }

  // Re-validate the 95 MB Gemini limit server-side — never trust client-side checks alone.
  if (file.size > MAX_GEMINI_UPLOAD_BYTES) {
    return uploadErrorResponse({
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB, which exceeds Gemini's ${(MAX_GEMINI_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB upload limit. Compress or split the audio first.`,
      stage: 'upload',
      upstreamStatus: 413,
      httpStatus: 413,
    });
  }

  const browserMime = file.type || '';
  const normalizedMime = normalizeMimeType(file.name, browserMime);

  // Step 1: start the resumable upload session — the upload URL for step 2
  // comes back in the x-goog-upload-url response header, not the JSON body.
  // NEVER log the audio file itself or the API key.
  let uploadUrl: string | null;
  try {
    const startRes = await fetch(GEMINI_FILES_UPLOAD_START_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': normalizedMime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    });

    if (!startRes.ok) {
      const errText = await startRes.text().catch(() => '');
      return uploadErrorResponse({
        error: `Gemini file upload failed to start (${startRes.status}).`,
        stage: 'upload',
        upstreamStatus: startRes.status,
        upstreamBody: sanitizeUpstreamError(errText),
        httpStatus: 502,
      });
    }

    uploadUrl = startRes.headers.get('x-goog-upload-url');
  } catch (err) {
    return uploadErrorResponse({
      error: 'Network error starting the Gemini file upload.',
      stage: 'upload',
      upstreamStatus: null,
      upstreamBody: sanitizeUpstreamError(err instanceof Error ? err.message : ''),
      httpStatus: 502,
    });
  }

  if (!uploadUrl) {
    return uploadErrorResponse({
      error: 'Gemini did not return an upload URL.',
      stage: 'upload',
      upstreamStatus: null,
      httpStatus: 502,
    });
  }

  // Step 2: upload the file bytes and finalize in one call.
  let uploadJson: JsonRecord;
  try {
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(file.size),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      return uploadErrorResponse({
        error: `Gemini file upload failed (${uploadRes.status}).`,
        stage: 'upload',
        upstreamStatus: uploadRes.status,
        upstreamBody: sanitizeUpstreamError(errText),
        httpStatus: 502,
      });
    }

    uploadJson = await uploadRes.json();
  } catch (err) {
    return uploadErrorResponse({
      error: 'Network error uploading the file bytes to Gemini.',
      stage: 'upload',
      upstreamStatus: null,
      upstreamBody: sanitizeUpstreamError(err instanceof Error ? err.message : ''),
      httpStatus: 502,
    });
  }

  const uploadedFile = uploadJson?.file;
  if (!uploadedFile || typeof uploadedFile.name !== 'string' || typeof uploadedFile.uri !== 'string') {
    return uploadErrorResponse({
      error: 'Gemini upload response was missing the expected file fields.',
      stage: 'upload',
      upstreamStatus: null,
      httpStatus: 502,
    });
  }

  return NextResponse.json({
    fileName: uploadedFile.name,
    fileUri: uploadedFile.uri,
    mimeType: uploadedFile.mimeType ?? normalizedMime,
    state: uploadedFile.state ?? 'PROCESSING',
    // Diagnostics only — not used for the actual generateContent call, which uses `mimeType` above.
    browserMime: browserMime || 'unknown',
    normalizedMime,
  });
}
