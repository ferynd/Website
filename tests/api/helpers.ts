import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { firebaseConfig } from '../../app/tools/trip-cost/firebaseConfig';

export const FAKE_KEYS = {
  GPT_API_KEY: 'sk-FAKE_contract_openai_12345678901234567890',
  GEMINI_API_KEY: 'AIzaFAKE_contract_google_12345678901234567890',
  TMDB_API_KEY: 'FAKE_contract_tmdb_1234567890123456',
  TMDB_READ_ACCESS_TOKEN: 'FAKE_contract_tmdb_bearer_1234567890123456',
};
export const GOOGLE_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export function stubKeys() {
  for (const [name, value] of Object.entries(FAKE_KEYS)) vi.stubEnv(name, value);
}

export function makeRequest(path: string, { method = 'POST', body = '{}', authorization }: {
  method?: string; body?: string; authorization?: string;
} = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
}

export function fakeJwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: 'RS256', kid: 'FAKE_unknown_contract_key' }),
    encode({ sub: 'synthetic-contract-user', aud: firebaseConfig.projectId,
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      exp: now + 3600, iat: now, email: 'contract@example.com', email_verified: true }),
    Buffer.from('FAKE_unsigned_signature').toString('base64url'),
  ].join('.');
}

// Even requests caught by route error handling remain recorded and fail assertions.
export function installFetchGuard() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === GOOGLE_KEYS_URL) return Response.json({ keys: [] });
    throw new Error('Contract test blocked an unexpected network request.');
  }));
  return calls;
}

const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Enumerate the module namespace rather than scanning source text, so export
// lists (`export { POST }`), aliases and `export *` re-exports are all registered.
export async function exportedRouteHandlers(root: string): Promise<string[]> {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /^route\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  const handlers: string[] = [];
  for (const file of walk(path.resolve(root))) {
    const route = path.relative(path.resolve(root), path.dirname(file)).split(path.sep).join('/');
    const module = await import(/* @vite-ignore */ file);
    for (const method of HTTP_METHODS) if (method in module) handlers.push(`${method} ${route}`);
  }
  return handlers.sort();
}
