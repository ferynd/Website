# Security & Privacy

This site is a **client-first** Next.js app with static sub-sites. Selected Edge API routes use environment secrets for external AI/media APIs. Do not expose those secrets client-side.
Persistence is provided via **Firebase (Auth + Firestore)** for selected tools.

## Secrets & Keys
- **Firebase web config** (`app/tools/trip-cost/firebaseConfig.ts` and `/public/tools/CalorieTracker/firebaseConfig.js`) contains **public identifiers**. 
  - These MUST NOT be treated as secrets; access is controlled by **Firestore Security Rules**.
  - Do **not** commit any private server keys, service account JSON, or API tokens.
- Never log PII, tokens, or auth data to the console. Avoid printing document contents that could include personal information.
- **`GEMINI_API_KEY`** and **`GPT_API_KEY`** are Cloudflare Secrets read via `process.env` inside Edge-runtime API routes only (never in client bundles). `GEMINI_API_KEY` powers Movie/TV Show Tracker classification/recommendations and the Transcriber correction pass; `GPT_API_KEY` powers Transcriber's OpenAI audio transcription calls.

## Authentication
- Email/password via Firebase Auth on Trip Cost, Trip Planner, Date Night Roulette, Conflict Tracker, Movie/TV Show Tracker, Calorie Tracker, and Transcriber.
- The admin user is `arkkahdarkkahd@gmail.com` (see `ADMIN_EMAIL` in the Trip Cost config). Use this only for approvals and privileged actions.
- **Transcriber is admin-only, not shared.** Every other tool above allows any signed-in Firebase user (scoped by Firestore rules); Transcriber additionally rejects any signed-in user whose email isn't exactly `ADMIN_EMAIL`, both client-side (UI hides the tool) and server-side (see below — the server-side check is what actually matters).
- **Server-side ID token verification:** `app/lib/verifyFirebaseAuth.ts` independently verifies the Firebase ID token on every `/api/transcriber/*` request — this is the only real access control on those routes, since Edge API routes have no other session mechanism. It hand-rolls RS256 signature verification against Google's public JWKS (`crypto.subtle`) instead of using `firebase-admin`, because `firebase-admin` requires Node APIs unavailable on this app's Edge runtime. Client-side checks in the tool's UI are convenience/UX only and must never be treated as the security boundary.

## Firestore Structure
Trip Cost data lives under `artifacts/trip-cost/**` (see **ARCHITECTURE.md**). Calorie Tracker uses `artifacts/<appId>/users/{uid}/**` scoped to a user. Trip Planner persists under `artifacts/trip-planner/**` with the following collections:

- `planners/{plannerId}` — metadata, participant IDs, linked Trip Cost ID, settings, and start/end dates.
- `planners/{plannerId}/events/{eventId}` — itinerary blocks, travel segments, and activities.
- `planners/{plannerId}/activityIdeas/{ideaId}` — curated suggestions visible to planner participants.
- `planners/{plannerId}/changelog/{logId}` — admin-only audit log entries.

### Trip Planner

- **Participants**: Only authenticated participants listed in `participantUids` (plus the admin account) can read or modify a planner, its events, and activity ideas.
- **Changelog**: Audit entries under `planners/{plannerId}/changelog/{logId}` are **readable by admin only**. Participants may append entries that reference their own UID; no edits or deletions are allowed client-side.
- **Linked data**: `costTrackerId` maintains the 1:1 link to Trip Cost trips. All participant mutations must keep the two tools synchronized.
- **Uploads**: Images land in Storage under `artifacts/trip-planner/uploads/{plannerId}/**` and should be compressed client-side (see `PlanContext` image helpers) before upload.

## Firestore Security Rules (authoritative)
The canonical Firestore rules are maintained in `firestore.rules` at the repository root.

To keep one source of truth, do not duplicate or partially copy rules in docs; reference `firestore.rules` directly whenever rules are discussed.

## Supply-chain & XSS Considerations
- Static sub-sites under `/public` may include third-party scripts (Firebase, Chart.js). Prefer **pinned versions** and integrity attributes where feasible.
- Avoid `innerHTML` with untrusted data in static apps. Use DOM APIs and escape user input before rendering.
- Do not include untrusted external scripts/styles in production without review.

## Local-only Tool Data
- **CIFI - Research Estimator** stores only user-entered estimator settings and logged rate history in browser `localStorage` under the namespaced `website:tools:cifi-research-estimator:v1:*` keys. It does not send this data to Firebase or any external service.

## Data Minimization & Retention
- Store only what is necessary for features (e.g., trip participants/emails, expenses, payments). 
- If you add analytics or additional PII, document the fields and update this SECURITY.md.

## When to Update this Document
- Any change to auth flows, Firestore structure, **rules**, data retention, or external scripts.
- Any new tool that persists user data or reads sensitive data.



### Date Night Roulette

- Firestore paths: `artifacts/date-night/**` for `couples/main`, `settings/global`, `dates`, `modifiers`, and `rolls`.
- Access model: only `participantUids` from `couples/main` plus admin email may read/write tool data.
- Uploads: Storage path `artifacts/date-night/uploads/**` is participant/admin scoped (see `storage.date-night.rules`).
- Firestore rules for Date Night and Trip Planner are now consolidated into the single root `firestore.rules` file.

- State-machine note: vetoes increment source counters without creating roll docs; only accepted outcomes create `rolls` entries.

### Transcriber

- **No persistence.** This tool has no Firestore collections and stores nothing server-side beyond the lifetime of a single HTTP request. The uploaded audio file is streamed from the browser to `/api/transcriber/transcribe`, forwarded to OpenAI, and discarded; nothing is written to disk (the Edge runtime has none) or to any bucket.
- **No transcript contents in logs.** Neither API route (`app/api/transcriber/transcribe/route.ts`, `app/api/transcriber/correct/route.ts`) logs request bodies, prompts, or model responses — only generic, sanitized error strings are ever returned to the client (API key fragments are stripped from any upstream error text before it's surfaced).
- **Access:** restricted to the admin account only (see Authentication above). All transcript/audio data that ever exists only exists in that one authenticated user's browser session and the two upstream API calls (OpenAI, Gemini) made on their behalf.
- **Email verification is enforced server-side, not just at sign-in.** `requireAdminUser` checks the ID token's `email_verified` claim on *every* request, not just at login — so a session that was valid before the account's verification state changed doesn't get grandfathered in. `RequirementsPanel.tsx` forces a fresh token (`user.reload()` then `getIdToken(true)`) before checking status, since a cached client-side `user.emailVerified` or a not-yet-refreshed ID token can otherwise appear stale even right after clicking a verification link.
- **Status route (`app/api/transcriber/status/route.ts`)** is read-only and never touches transcript/audio data or the OpenAI/Gemini APIs. It reveals whether `GPT_API_KEY`/`GEMINI_API_KEY` are configured (booleans only, never the values) but only once the caller already passes both the email-match and email-verified checks `requireAdminUser` itself enforces — an unauthenticated, wrong-account, or unverified caller gets `null` for both key-configured fields, so this route can't be used to probe deployment config.
- **Large files:** uploads over OpenAI's 25 MB limit are rejected with a clear message (client- and server-side) rather than silently failing or being truncated. There is no Gemini Files API fallback for oversized files in the current implementation — this is a known, documented limitation, not a silent gap.
- **Settings pop-up model choices:** the admin's per-stage model selection (`app/tools/transcriber/components/SettingsModal.tsx`) is stored only in that browser's `localStorage` — never in Firestore, never sent anywhere except as a `model` field on the admin's own already-authenticated `/api/transcriber/*` requests. Both API routes independently validate the incoming model id against a fixed allowlist (`resolveTranscribeModelId` / `resolveGeminiModelId`) and silently fall back to the site default on anything unrecognized, so this input never reaches the OpenAI/Gemini calls unvalidated.
- **Skip cleanup pass:** when enabled, the Gemini correction pass (and its `/api/transcriber/correct` calls) never runs — the raw transcript is returned directly to the browser with a manual-cleanup prompt attached, intended for the admin to paste into a browser AI chat themselves. No new data leaves the app as a result; this only removes a step, it doesn't add a new destination for transcript contents.
