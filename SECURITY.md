# Security & Privacy

This site is a **client-first** Next.js app with static sub-sites. Selected Edge API routes use environment secrets for external AI/media APIs. Do not expose those secrets client-side.
Persistence is provided via **Firebase (Auth + Firestore)** for selected tools.

## Secrets & Keys
- **Firebase web config** (`app/tools/trip-cost/firebaseConfig.ts` and `/public/tools/CalorieTracker/firebaseConfig.js`) contains **public identifiers**. 
  - These MUST NOT be treated as secrets; access is controlled by **Firestore Security Rules**.
  - Do **not** commit any private server keys, service account JSON, or API tokens.
- Never log PII, tokens, or auth data to the console. Avoid printing document contents that could include personal information.
- **`GEMINI_API_KEY`** and **`GPT_API_KEY`** are Cloudflare Secrets read via `process.env` inside Edge-runtime API routes only (never in client bundles). `GEMINI_API_KEY` powers Movie/TV Show Tracker classification/recommendations and Transcriber's cleanup pass, Gemini direct-transcription provider, and Gemini Files API uploads (`app/api/transcriber/gemini/**`); `GPT_API_KEY` powers Transcriber's OpenAI audio transcription calls.

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

### Recipe Standardizer

- Firestore path: `artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}` — recipes are private to the authenticated user (owner-only read/write; see `firestore.rules`).
- Reads the same user's CalorieTracker saved foods (`artifacts/default-app-id/users/{uid}/foodItems`) for optional nutrition-link matching; it never reads another user's data and never writes to CalorieTracker paths.
- No AI/API calls: recipe conversion happens in ChatGPT outside the site; only user-pasted JSON is processed client-side.

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

- **No Firestore persistence; run data never leaves the browser tab.** This tool still has no Firestore collections and stores nothing server-side beyond the lifetime of a single HTTP request. A transcription run's audio, segments, and text exist only in that tab's React state and the upstream API calls (OpenAI, Gemini) made on the admin's behalf — nothing about a *run* survives closing the tab. Two device-local stores now persist *preferences*, not run data — see the speaker-clips and settings-store bullets below.
- **Speaker reference clips.** Clip **audio** is stored ONLY in the browser's IndexedDB (db `transcriber`, store `speakerClips`); per-profile name/notes metadata lives separately in `localStorage` (`transcriber_speaker_profiles_v1`). A clip is transmitted only as part of the admin's own already-authenticated transcription request: as a multipart file (`speakerClips[]`) to `/api/transcriber/transcribe`, which the route converts to base64 data URLs and forwards to OpenAI's `known_speaker_references[]` field; or — only when the default-OFF experimental `geminiReferenceClips` setting is explicitly enabled — as base64 `inlineData` to Gemini via `/api/transcriber/gemini/window`. Clips are user-deletable per profile in the Speaker Profiles panel. They are never written to Firestore and never logged.
- **Gemini Files API (server-uploaded audio for direct transcription).** When the Gemini provider is used, the browser proxies audio server-side (`POST /api/transcriber/gemini/upload`) to Google's Files API under this deployment's `GEMINI_API_KEY` — the key never reaches the browser. A recording at or under `GEMINI_SINGLE_CALL_MAX_SECONDS` uploads once, as the original file. A longer recording is decoded and sliced client-side (`lib/decodeAudioMono16k.ts`) into per-window WAV clips — never the original file — and each window's slice is uploaded/transcribed/deleted independently, so a windowed run creates and deletes multiple short-lived Files API entries instead of one. Every uploaded file (whole or sliced) is deleted best-effort right after its own use (`DELETE /api/transcriber/gemini/file`); a failed delete is surfaced only as a non-fatal warning, never a hard error, because Google's Files API auto-expires uploaded files after 48 hours regardless of whether this app's own delete call succeeds — that retention window is the backstop.
- **New Gemini routes' auth/transport guarantees.** `app/api/transcriber/gemini/{upload,file,window}/route.ts` are Edge routes gated by `requireAdminUser`, identical to the pre-existing transcribe/correct routes — no request reaches Google without passing that check first. `GEMINI_API_KEY` is sent to Google only via the `x-goog-api-key` request header, never as a URL query parameter. Any non-2xx upstream response body is passed through `lib/sanitizeUpstreamError.ts` before it can appear in a client-facing error — it redacts `sk-`-style OpenAI keys, `AIza`-style Google keys, and `key=`/`&key=` query-param values, and truncates to 500 characters. None of these routes (or the transcribe/correct routes) log the audio file, the request body, or the model's response — only generic, sanitized error strings are ever returned to the client.
- **Debug JSON is browser-memory only.** `lib/runDebug.ts` accumulates a run's debug log (provider attempts, raw segment count, suppression/cleanup counts, speaker-reference attachment status, argument-tag summary, sanitized upstream errors) in a React ref for the lifetime of one run. It only becomes visible/copyable/downloadable on failure, or when the admin has set `debugMode: 'always'` in Settings. It is never sent anywhere and never written to Firestore; by construction it holds only counts, labels, and already-sanitized error strings — never transcript text or raw audio.
- **Access:** restricted to the admin account only (see Authentication above). All transcript/audio/clip data that ever exists only exists in that one authenticated user's browser (state, `localStorage`, IndexedDB) and the upstream API calls made on their behalf.
- **Email verification is enforced server-side, not just at sign-in.** `requireAdminUser` checks the ID token's `email_verified` claim on *every* request, not just at login — so a session that was valid before the account's verification state changed doesn't get grandfathered in. `RequirementsPanel.tsx` forces a fresh token (`user.reload()` then `getIdToken(true)`) before checking status, since a cached client-side `user.emailVerified` or a not-yet-refreshed ID token can otherwise appear stale even right after clicking a verification link.
- **Status route (`app/api/transcriber/status/route.ts`)** is read-only and never touches transcript/audio data or the OpenAI/Gemini APIs. It reveals whether `GPT_API_KEY`/`GEMINI_API_KEY` are configured (booleans only, never the values) but only once the caller already passes both the email-match and email-verified checks `requireAdminUser` itself enforces — an unauthenticated, wrong-account, or unverified caller gets `null` for both key-configured fields. `GEMINI_API_KEY`'s single boolean now covers both the cleanup pass and Gemini direct transcription.
- **Large files:** OpenAI-path uploads over 25 MB (`MAX_OPENAI_UPLOAD_BYTES`) are rejected client- and server-side. Gemini's Files API path (`MAX_GEMINI_UPLOAD_BYTES`) accepts uploads up to 95 MB, kept under this deployment's Cloudflare Pages 100 MB request-body limit — a real, working alternative for oversized files rather than a documented gap. Both caps are re-validated server-side regardless of what client-side checks already enforced.
- **Settings store & speaker profiles:** the admin's provider/model/pipeline preferences (`transcriber_settings_v1`) and speaker-profile name/notes metadata (`transcriber_speaker_profiles_v1`) live only in that browser's `localStorage` — never in Firestore, never sent anywhere except as fields on the admin's own already-authenticated `/api/transcriber/*` requests. Every model/provider id received server-side is independently validated against a fixed allowlist (`resolveTranscribeModelId` / `resolveGeminiModelId` / `isGeminiTranscribeModel`) and falls back to the site default on anything unrecognized, so this input never reaches the OpenAI/Gemini calls unvalidated.
- **Skip cleanup pass:** when enabled (`settings.cleanupEnabled: false`), the Gemini cleanup pass (and its `/api/transcriber/correct` calls) never runs — the raw transcript is returned directly to the browser with a manual-cleanup prompt attached, intended for the admin to paste into a browser AI chat themselves. No new data leaves the app as a result; this only removes a step, it doesn't add a new destination for transcript contents.
- **Transcripts remain non-persisted.** This update adds no Firestore or Storage write path for transcript content, raw or cleaned, anywhere in this tool — consistent with the "no persistence" bullet above.
