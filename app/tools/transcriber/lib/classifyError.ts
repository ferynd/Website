// Pure error classifier for the Transcriber pipeline. Turns a raw
// (httpStatus, bodyText, provider, stage) tuple into a stable category plus
// short user-facing copy and retry hints, so the ErrorRecoveryPanel never has
// to eyeball a raw upstream error string. See the plan's "Error
// classification & recovery" section for the source heuristics.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { TranscriptionProviderId } from './providers/types';

export type ErrorCategory =
  | 'openai-quota'
  | 'openai-file-too-large'
  | 'openai-unsupported-format'
  | 'openai-auth'
  | 'gemini-upload'
  | 'gemini-parse'
  | 'gemini-quota'
  | 'platform-limit'
  | 'network'
  | 'auth-config'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  likelyCause: string;
  recommendedAction: string;
  /** Providers worth offering as a manual (or auto-fallback) retry, in preference order. */
  retryProviders: TranscriptionProviderId[];
  /** True ONLY for openai-unsupported-format — never inferred from file size alone. */
  suggestsConversion: boolean;
}

export interface ClassifyTranscriptionErrorInput {
  httpStatus: number | null;
  bodyText: string;
  provider: TranscriptionProviderId | null;
  stage: 'upload' | 'transcribe' | 'poll' | 'cleanup' | 'auth';
  fileName?: string;
  fileSizeBytes?: number;
  browserMime?: string;
}

/* ------------------------------------------------------------ */
/* CONFIGURATION: classification keyword patterns                */
/* ------------------------------------------------------------ */

const QUOTA_PATTERN = /insufficient_quota|billing|quota[_ ]?exceeded|resource_exhausted|rate[_ ]?limit/i;
/** Cloudflare/edge platform error pages for an oversized body rarely come back as our own JSON. */
const PLATFORM_TOO_LARGE_PATTERN = /request entity too large|payload too large|body (exceeded|too large)/i;
const UNSUPPORTED_FORMAT_PATTERN = /format|decode|corrupt|unsupported|invalid[_ -]?file/i;
/** Phrases unique to this app's own admin-gate rejections (see verifyFirebaseAuth.ts's AuthError messages). */
const OWN_ROUTE_AUTH_PATTERN = /bearer token|site owner|verified its email|invalid or expired token|authentication failed/i;
const GEMINI_PARSE_PATTERN = /invalid json|json array|schema|missing \d+ of \d+|incomplete/i;

const OPENAI_PROVIDERS = new Set<TranscriptionProviderId>(['openai-diarized', 'openai-whisper']);

/** Extensions OpenAI's transcription endpoint documents as supported, with
 * the browser MIME types plausibly reported for each. A rejection of one of
 * these must never be phrased as the file *type* being unsupported — OpenAI
 * refused this specific file's container/encoding. A browser MIME outside
 * the expected set (e.g. "audio/mpeg" for .m4a) is called out as a hint the
 * contents may not match the extension. */
const OPENAI_SUPPORTED_EXTENSION_MIMES: Record<string, string[]> = {
  '.aac': ['audio/aac', 'audio/x-aac'],
  '.flac': ['audio/flac', 'audio/x-flac'],
  '.m4a': ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.mp4': ['audio/mp4', 'video/mp4'],
  '.mpeg': ['audio/mpeg', 'video/mpeg'],
  '.mpga': ['audio/mpeg'],
  '.oga': ['audio/ogg'],
  '.ogg': ['audio/ogg', 'application/ogg'],
  '.wav': ['audio/wav', 'audio/x-wav', 'audio/wave'],
  '.webm': ['audio/webm', 'video/webm'],
};

/** File-specific copy for openai-unsupported-format when the extension is
 * one OpenAI supports — the generic default copy would otherwise read as
 * ".m4a isn't supported", which is wrong and misleading. */
function unsupportedFormatOverrides(input: ClassifyTranscriptionErrorInput): Partial<Omit<ClassifiedError, 'category'>> {
  const fileName = input.fileName ?? '';
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  const expectedMimes = OPENAI_SUPPORTED_EXTENSION_MIMES[ext];
  if (!expectedMimes) return {};

  let likelyCause =
    `OpenAI rejected this specific file's container/encoding — ${ext} itself is a supported format, ` +
    'so the problem is how this particular file is encoded (or corruption), not the file type.';
  const browserMime = input.browserMime?.toLowerCase() ?? '';
  if (browserMime && browserMime !== 'unknown' && !expectedMimes.includes(browserMime)) {
    likelyCause += ` The browser reported its type as "${input.browserMime}", which is unusual for ${ext} — the file's contents may not match its extension.`;
  }

  return {
    likelyCause,
    recommendedAction: `Try Gemini (it tolerates more encodings), or re-export the audio (e.g. to WAV or MP3) to rebuild the container and retry.`,
  };
}

function build(
  category: ErrorCategory,
  overrides: Partial<Omit<ClassifiedError, 'category'>> = {},
): ClassifiedError {
  const defaults: Record<ErrorCategory, Omit<ClassifiedError, 'category'>> = {
    'openai-quota': {
      likelyCause: "OpenAI's transcription quota or billing limit was hit for this account.",
      recommendedAction: 'Check billing/usage on the OpenAI account, or try Gemini instead.',
      retryProviders: ['gemini'],
      suggestsConversion: false,
    },
    'openai-file-too-large': {
      likelyCause: "The file is larger than OpenAI's per-request upload limit.",
      recommendedAction: 'Try Gemini (higher size limit), or compress/split the audio first.',
      retryProviders: ['gemini'],
      suggestsConversion: false,
    },
    'openai-unsupported-format': {
      likelyCause: 'OpenAI could not decode this audio file — it rejected the container/encoding, or the file is corrupted.',
      recommendedAction: 'Try Gemini (it tolerates more encodings), or re-export the audio (e.g. to WAV or MP3) and retry.',
      retryProviders: ['gemini'],
      suggestsConversion: true,
    },
    'openai-auth': {
      likelyCause: "OpenAI rejected the request's API key or authorization.",
      recommendedAction: 'Verify GPT_API_KEY is set and valid on the server. Gemini uses a separate key and may still work.',
      retryProviders: ['gemini'],
      suggestsConversion: false,
    },
    'gemini-upload': {
      likelyCause: 'Uploading or activating the file with the Gemini Files API failed.',
      recommendedAction: 'Try again, or use an OpenAI provider instead.',
      retryProviders: ['openai-diarized', 'openai-whisper'],
      suggestsConversion: false,
    },
    'gemini-parse': {
      likelyCause: "Gemini's response could not be parsed as the expected structured output.",
      recommendedAction: 'Retry the cleanup pass, or complete with the raw (uncleaned) transcript.',
      retryProviders: [],
      suggestsConversion: false,
    },
    'gemini-quota': {
      likelyCause: "Gemini's quota or billing limit was hit for this account.",
      recommendedAction: 'Check billing/usage on the Gemini account, or try an OpenAI provider instead.',
      retryProviders: ['openai-diarized', 'openai-whisper'],
      suggestsConversion: false,
    },
    'platform-limit': {
      likelyCause: 'The hosting platform rejected the request before it reached the transcription provider (commonly a request-body size cap).',
      recommendedAction: 'Try a smaller file, or a provider with a higher size limit.',
      retryProviders: ['gemini'],
      suggestsConversion: false,
    },
    network: {
      likelyCause: 'The request never reached the server — likely a network interruption.',
      recommendedAction: 'Check your connection and retry the same provider.',
      retryProviders: [],
      suggestsConversion: false,
    },
    'auth-config': {
      likelyCause: "This tool's own admin sign-in check rejected the request.",
      recommendedAction: 'Sign in with the site owner account and make sure its email is verified.',
      retryProviders: [],
      suggestsConversion: false,
    },
    unknown: {
      likelyCause: 'An unexpected error occurred and could not be classified more precisely.',
      recommendedAction: 'Check the diagnostics below, or retry.',
      retryProviders: [],
      suggestsConversion: false,
    },
  };

  return { category, ...defaults[category], ...overrides };
}

function isOwnRouteAuthFailure(bodyText: string): boolean {
  return OWN_ROUTE_AUTH_PATTERN.test(bodyText);
}

/**
 * Classifies a transcription/cleanup failure into a stable category with
 * user-facing copy and retry hints. Pure and never throws.
 *
 * Order of checks matters — quota/size/format/auth are all identified by
 * distinct signals that don't overlap in practice, but `network` (no
 * response at all) and the "cleanup/gemini parse" stage check are handled
 * first/specially since they aren't httpStatus-driven the same way.
 */
export function classifyTranscriptionError(input: ClassifyTranscriptionErrorInput): ClassifiedError {
  const { httpStatus, provider, stage } = input;
  const bodyText = typeof input.bodyText === 'string' ? input.bodyText : '';

  // No response reached the client at all — a network/timeout failure, not
  // an upstream rejection of any kind.
  if (httpStatus === null) {
    return build('network', { retryProviders: provider ? [provider] : [] });
  }

  // Quota/billing exhaustion — commonly 429, but some providers wrap it in a 400.
  if (httpStatus === 429 || QUOTA_PATTERN.test(bodyText)) {
    return build(provider === 'gemini' ? 'gemini-quota' : 'openai-quota');
  }

  // Body too large for a single request — either the provider's own 413, or
  // a platform/edge HTML error page mentioning the same thing before the
  // request ever reached the provider.
  if (httpStatus === 413 || PLATFORM_TOO_LARGE_PATTERN.test(bodyText)) {
    if (provider !== null && OPENAI_PROVIDERS.has(provider) && stage === 'transcribe') {
      return build('openai-file-too-large');
    }
    return build('platform-limit');
  }

  // Gemini cleanup-pass responses that violate the strict-JSON contract —
  // never a size/format problem, so this must be checked before the generic
  // 400 → unsupported-format heuristic below.
  if (stage === 'cleanup' && GEMINI_PARSE_PATTERN.test(bodyText)) {
    return build('gemini-parse');
  }

  // Our own admin-gate rejection (requireAdminUser's AuthError wording) must
  // be recognized before the gemini-upload/poll branch below — a Gemini
  // upload or poll call that never got past our own auth gate (e.g. an
  // expired ID token) is a 401/403 from THIS route, not from the Gemini
  // Files API, so it must not be classified as gemini-upload (which would
  // steer the recovery panel toward a provider retry instead of
  // re-authentication). Checked regardless of provider/stage.
  if ((httpStatus === 401 || httpStatus === 403) && isOwnRouteAuthFailure(bodyText)) {
    return build('auth-config');
  }

  // Gemini Files API upload/activation failures (Phase 3).
  if (provider === 'gemini' && (stage === 'upload' || stage === 'poll')) {
    return build('gemini-upload');
  }

  // Unsupported/corrupted audio — the ONLY category that suggests conversion.
  // Deliberately gated on wording, never on file size, so a large-but-valid
  // file with a plain 500 is never mislabeled as a format/size problem.
  if (httpStatus === 400 && UNSUPPORTED_FORMAT_PATTERN.test(bodyText)) {
    return build('openai-unsupported-format', unsupportedFormatOverrides(input));
  }

  // Any remaining 401/403 here is an upstream provider auth failure — our
  // own admin-gate rejection was already handled above.
  if (httpStatus === 401 || httpStatus === 403) {
    return build('openai-auth');
  }

  // An otherwise-unclassified failure of the diarized model specifically
  // (e.g. it's momentarily unavailable for this account/request) is exactly
  // the case the old unconditional server-side silent retry used to paper
  // over — offer Whisper as a manual retry instead of leaving no path forward.
  if (provider === 'openai-diarized' && stage === 'transcribe') {
    return build('unknown', { retryProviders: ['openai-whisper'] });
  }

  return build('unknown');
}
