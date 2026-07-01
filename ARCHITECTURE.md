# Architecture Overview

## Runtime & Rendering
- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS with CSS variables (HSL tokens) in `app/globals.css`
- **Theme:** Dark by default (`<html data-theme="dark">`); light tokens defined but not default
- **Static sub-sites:** Served directly from `/public`, linked by Next.js pages

## Directory Responsibilities
```
app/
  layout.tsx         # Sets HTML, theme, global font
  loading.tsx        # Fullscreen animated progress bar during route transitions
  page.tsx           # Home hub with cards for Games, Tools, Trips
  games/page.tsx     # Reads a hardcoded list -> links to /public/games/**/index.html
  tools/page.tsx     # Lists React Trip Cost and /public/tools/* static tools
  trips/page.tsx     # Lists /public/trips/** itineraries
  style-guide/page.tsx # Shows tokens (colors, spacing) and base components
  tools/cifi-research-estimator/page.tsx # Client-only CIFI research payout estimator with localStorage and SVG charts
  tools/trip-cost/   # Firebase-backed app (Auth + Firestore + context + screens)
  tools/date-night/  # Date Night Roulette (Auth + Firestore + weighted roller + reviews)
    lib/decay.ts, lib/stacking.ts, lib/roller.ts # Pure roll math modules
    __tests__/ # Vitest coverage for decay/stacking/rarity behavior
  tools/shows/       # Movie/TV tracker (Auth + Firestore + Gemini classify/recommend routes)
  tools/transcriber/ # Private audio transcriber (Auth-gated to admin only; OpenAI transcribe + Gemini correction routes; no persistence)
    lib/ # Pure segment/chunk/stitch/prompt helpers; api/transcriber/** Edge routes call the same lib
    __tests__/ # Vitest coverage for formatting, chunking, stitching, speaker mapping, correction parsing
components/
  Button.tsx, Input.tsx, Select.tsx, Nav.tsx, ProjectCard.tsx
public/
  games/**            # Noir Detective Idea; Emeril: A World Divided
  tools/**            # Trip Cost link lives in /app; CalorieTracker; Social Security tools
  trips/**            # ChicagoTripItinerary
```

## UI System
- **Tokens:** Defined in `globals.css` as CSS variables: background/surfaces, border, text levels, accent scale, semantic colors (success, warning, error, info), radii, and shadows.
- **Utilities:** Custom utilities under `@layer utilities` (e.g., `.container-tight`, `.section`).
- **Components:** Button uses **class-variance-authority (CVA)** for size/variant; inputs and selects follow the same tokenized system.
- **Icons:** `lucide-react` throughout.

## Games, Tools, Trips
- **Games** (static):  
- **Noir Detective Idea** — An interactive detective story concept (Static HTML).  
  Path: `/games/noir_detective_idea/index.html`
- **Emeril: A World Divided** — An interactive lore page for a world of lost magic and warring factions.  
  Path: `/games/Emeril_A_World_Divided/index.html`

- **Tools**:  
- **CIFI - Research Estimator** — Estimate CIFI research payout timing using local history, curve fits, and interactive SVG charts.
  Path: `/tools/cifi-research-estimator`
- **Trip Cost Calculator** — Split expenses and calculate balances for a group trip.
  Path: `/tools/trip-cost`
- **Trip Planner** — Firebase-backed itinerary planner with Auth + Firestore, timeline UI, idea library, and shared settings/map panels.
  Path: `/tools/trip-planner`
- **Date Night Roulette** — Firebase-backed picker for date ideas/modifiers with veto/accept flow, batch CSV uploads for pool items, and photo/review history.
  Path: `/tools/date-night`
- **Movie/TV Show Tracker** — Firebase-backed shared watchlist with ratings, notes, Gemini title classification, local model settings, and mood recommendations that can include rewatchable completed shows.
  Path: `/tools/shows`
- **Transcriber** — Private, admin-only tool that turns a long `.m4a` recording into a cleaned, speaker-labeled, timestamped `.txt` transcript via OpenAI transcription + a chunked Gemini correction pass.
  Path: `/tools/transcriber`
- **Calorie Tracker** — A simple tool to track daily calorie intake (Static HTML).
  Path: `/tools/CalorieTracker/index.html`
- **Social Security (interactive guide)** — Learn how benefits and earnings interact through simulations.  
  Path: `/tools/social-security/index.html`
- **Social Security (calculator)** — Visualize the financial impact of different claiming strategies.  
  Path: `/tools/social-security-calculator/index.html`

- **Trips** (static):  
- **Chicago Trip Itinerary** — An itinerary for a trip to Chicago (Static HTML).  
  Path: `/trips/ChicagoTripItinerary/index.html`

## Movie/TV Show Tracker: AI Model Selection
- **Shared model metadata:** `app/lib/aiModels.ts` is client-safe and holds available Gemini model IDs, display labels, defaults, validation helpers, and localStorage keys.
- **Gemini request utility:** `app/lib/aiConfig.ts` builds plain JSON Gemini requests for Edge routes without tools, grounding, URL context, code execution, file search, or function calling.
- **Defaults:** Classification/title expansion defaults to `gemini-3.1-flash-lite`; recommendations default to `gemini-2.5-flash`.
- **Recommendation eligibility:** `candidateShows` includes Watching, Planned, On Hold, and Completed shows only when relevant viewers marked `wouldRewatch` as `yes` or `maybe`, before applying watcher preference tiers.
- **Recommendation quick toggles:** `mood/page.tsx` applies client-side filters (No rewatches / Watching only / Animation only / Exclude animation) on top of `candidateShows` before building the prompt — deliberately kept to the highest-value filters rather than a full facet UI.

## Movie/TV Show Tracker: List/Row Views, Batch Update, Review Queue, Season Checks
- **View modes:** `page.tsx` toggles between the original card list and a dense `ShowRow` list (persisted to `localStorage` under `shows-view-mode`). `FilterBar` collapses status/type/vibe/watcher chips behind a "Filters" disclosure by default and always shows a sort row (`updated` / `score` / `alpha` / `seasons` / `incomplete`) — mirroring the same collapsible-disclosure pattern already used elsewhere in this tool (e.g. `ShowForm`'s watcher section).
- **Selection + batch AI update:** `page.tsx` owns select-mode state; `ShowCard`/`ShowRow` render a checkbox when active. `SelectionToolbar` provides select-all-visible and "AI update". `BatchUpdateModal` reuses the single-show classify call (extracted into `lib/classifyShow.ts`, also used by `ShowForm`) sequentially per selected show, updating title/type/vibes/description and tracking per-show success/failure so partial failures don't block the batch.
- **Review-missing workflow:** `lib/reviewCompleteness.ts` defines a review as complete when `story`/`characters`/`vibes`/`wouldRewatch` are all set (brain power is explicitly excluded — it's context-only per `compositeScore.ts`). `ReviewQueueModal` walks a per-user snapshot of incomplete ratable (completed/dropped/on_hold) shows one at a time with "Save & next".
- **Check for new seasons:** Show docs optionally persist `metadataSource`/`metadataSourceId` (the provider + ID the classify pipeline resolved) once a show has been classified. `POST /api/seasons` compares each eligible show's recorded season count against TMDb's `number_of_seasons`, falling back to a live high-confidence TMDb title search when no stored ID exists. **Limitation:** only `tv`/`cartoon` shows are covered — AniList/Jikan (the anime metadata sources) model each cour/season as a separate title, so there's no reliable single "season count" to diff for anime.

## Transcriber: Pipeline & Modules
- **Access:** Firebase Auth gated to the single admin account (`ADMIN_EMAIL` in `app/tools/trip-cost/firebaseConfig.ts`, reused via `app/tools/transcriber/lib/firebase.ts`). No Firestore — this tool has no persisted state at all; everything lives in page-local React state for the duration of one run. The sign-in screen is login-only (`AuthForm`'s `allowSignUp={false}`) — account creation isn't exposed here, since anyone other than the admin would just be signed up and immediately blocked.
- **Server-side auth:** `app/lib/verifyFirebaseAuth.ts` is a minimal, hand-rolled Firebase ID token verifier (RS256 signature check against Google's public JWKS via Web Crypto, plus iss/aud/exp claim checks) used because `firebase-admin` is Node-only and this app's API routes run on the Edge runtime. Every `/api/transcriber/*` route calls `requireAdminUser()` before doing any work — that call, not the client-side UI gating, is what actually protects the routes.
- **Pipeline:** `useTranscriberPipeline.ts` orchestrates: validate file → upload (with real progress via XHR) → `POST /api/transcriber/transcribe` → chunk the resulting segments with overlap → `POST /api/transcriber/correct` once per chunk → stitch chunk results → build the final `.txt`.
- **Transcribe route (`app/api/transcriber/transcribe/route.ts`):** Re-validates the 25 MB OpenAI upload limit server-side, calls `gpt-4o-transcribe-diarize` with `response_format: diarized_json` and `chunking_strategy: auto`. OpenAI labels distinct speakers sequentially ("A", "B", …) since no voice-sample references are collected in this UI; `lib/mapSpeakerLabels.ts` maps those onto the user-provided speaker names in first-appearance order (extra speakers beyond the provided names become `Unknown`). On any failure of the primary model/endpoint, falls back to `whisper-1` + `verbose_json` (segment-level timestamps, no speaker labels — all segments start `Unknown`).
- **Correct route (`app/api/transcriber/correct/route.ts`):** Runs one Gemini (`gemini-2.5-flash`, low temperature) call per chunk with a strict-JSON-out prompt (`lib/buildCorrectionPrompt.ts`) that forbids summarizing/rewriting and asks only for `{index, speaker, text}` per segment — timestamps are never trusted from the model and are always taken from the original segment.
- **Correction failures are tracked, not swallowed:** by default, a chunk whose correction call fails falls back to its uncorrected segments and the failure is counted; `lib/correctionSummary.ts` builds a "Completed with warnings: N of M correction chunks failed and were left uncorrected" message shown alongside the final transcript. An optional **strict mode** checkbox in the upload panel aborts the entire run on the first correction failure instead of silently falling back, surfacing which chunk (by index and time range) failed and why.
- **Chunking & stitching:** `lib/chunkTranscript.ts` splits the recording into contiguous, non-overlapping "core" windows (default 15 min) padded with overlap (default 90s) on both sides for cross-boundary context. `lib/stitchTranscript.ts` keeps only each window's core-range segments when reassembling, which prevents duplicate lines from the overlap regions by construction (plus a belt-and-braces exact-match de-dup).
- **Large files:** files over OpenAI's 25 MB limit are rejected client- and server-side with a message telling the user to compress or split the audio; there is no Gemini Files API fallback for oversized uploads (a documented known limitation, not silent failure).

## Trip Cost & Trip Planner: Data & Modules
- **Config:** `app/tools/trip-cost/firebaseConfig.ts` (admin email `arkkahdarkkahd@gmail.com`).
- **DB helpers:** `app/tools/trip-cost/db.ts` set constants `APP_COLLECTION = 'artifacts'`, `APP_ID = 'trip-cost'` with helpers for `users`, `trips`, and `trips/<id>/audit`.
- **State:** `TripContext.tsx` subscribes to Firestore with `onSnapshot` to keep trip, expenses, payments, etc. in sync.
- **UI:** `components/AuthForm.tsx`, `TripList.tsx`, and `components/TripDetail/**` (Participants, ExpenseForm, ExpensesList, BalanceSummary, PaymentHistory, SettlementSuggestions, ConfirmDeleteModal, AuditLog).
- **Calculations:** `utils/calc.ts` contains pure helpers for totals, balances, and settlements.
- **Trip Planner:** `app/tools/trip-planner/page.tsx` composes the planner shell while `PlanContext.tsx` wires Firebase Auth + Firestore listeners. Supporting modules under `app/tools/trip-planner/lib/` initialize Firebase, expose typed DB helpers, and compress uploads for Storage. Timeline/ideas/settings/map components consume the context for realtime data and CRUD.

## Data Model (Firestore high-level)
Rooted at `artifacts/trip-cost/`:
```
users/{{uid}}
trips/{{tripId}}
trips/{{tripId}}/participants/{{participantId}}
trips/{{tripId}}/expenses/{{expenseId}}
trips/{{tripId}}/payments/{{paymentId}}
trips/{{tripId}}/audit/{{logId}}
```
Authority is enforced by Firestore Security Rules (see SECURITY.md).

## Build & Tooling
- **Scripts:** `dev`, `build`, `start`, `lint`
- **Tailwind:** plugins `@tailwindcss/forms` and `@tailwindcss/typography`
- **next.config.ts:** default (no custom server handlers)
- **tsconfig/eslint:** standard Next.js base with TypeScript 5

## Extending the Site
- Add static sub-sites under `/public` and link from the relevant page in `/app`.
- For React tools, colocate components under `app/tools/<name>/**`, use client components when interactive.
- Keep styles within the tokenized Tailwind system for consistency.


> Firestore Security Rules source of truth: `firestore.rules` (repo root). Keep docs referencing this file rather than embedding duplicate rule blocks.
