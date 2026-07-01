// Server-only Firebase ID token verification for Edge API routes.
//
// This is a minimal hand-rolled verifier instead of the `firebase-admin` SDK.
// firebase-admin depends on Node-only APIs (net/tls/gRPC) and does not run on
// the Edge runtime this app deploys to on Cloudflare Pages. Everything here
// uses only Web APIs available at the edge: fetch, atob, crypto.subtle.
//
// SECURITY NOTE: `requireAdminUser` is the ONLY thing that protects the
// Transcriber API routes. Any route that touches OpenAI/Gemini keys or
// transcript data MUST call it before doing any work, and must reject on
// failure. Client-side gating in the tool's UI is convenience only.

import { ADMIN_EMAIL, firebaseConfig } from '@/app/tools/trip-cost/firebaseConfig';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ISSUER = `https://securetoken.google.com/${firebaseConfig.projectId}`;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface FirebaseJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

interface FirebaseTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
}

export class AuthError extends Error {}

let cachedJwks: { keys: FirebaseJwk[]; fetchedAt: number } | null = null;

async function getJwks(): Promise<FirebaseJwk[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new AuthError('Could not fetch Firebase signing keys.');
  const data = (await res.json()) as { keys: FirebaseJwk[] };
  cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verifies a Firebase ID token's RS256 signature against Google's public JWKS
 * and validates iss/aud/exp/iat claims. Returns the decoded payload on
 * success, or null if the token is missing, malformed, expired, or fails
 * signature verification. Never logs token or payload contents.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseTokenPayload | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: FirebaseTokenPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null;
  if (payload.iss !== ISSUER) return null;
  if (payload.aud !== firebaseConfig.projectId) return null;
  if (!payload.sub) return null;

  let jwk: FirebaseJwk | undefined;
  try {
    const keys = await getJwks();
    jwk = keys.find((k) => k.kid === header.kid);
  } catch {
    return null;
  }
  if (!jwk) return null;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);

  const isValid = await crypto.subtle
    .verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData)
    .catch(() => false);
  if (!isValid) return null;

  return payload;
}

/**
 * Extracts the bearer token from an Authorization header, verifies it, and
 * confirms the caller's email matches ADMIN_EMAIL exactly (case-insensitive)
 * AND is verified. Email/password sign-up on this shared Firebase project
 * doesn't require proving ownership of the address up front, so without the
 * email_verified check, anyone could sign up with ADMIN_EMAIL (if not
 * already registered) and pass the email-match check alone. Throws
 * AuthError on any failure — callers must catch this and respond 401.
 */
export async function requireAdminUser(request: Request): Promise<FirebaseTokenPayload> {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) throw new AuthError('Missing bearer token.');

  const payload = await verifyFirebaseIdToken(match[1]);
  if (!payload) throw new AuthError('Invalid or expired token.');

  const email = payload.email?.toLowerCase();
  if (!email || email !== ADMIN_EMAIL.toLowerCase()) {
    throw new AuthError('This tool is restricted to the site owner.');
  }
  if (payload.email_verified !== true) {
    throw new AuthError('This account has not verified its email address.');
  }

  return payload;
}
