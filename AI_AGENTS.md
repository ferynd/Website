# AI Agents: Rules of Engagement

This document is the **single source of truth** for automated assistants (Claude, GPT, Gemini, Cursor, Aider, Cody, etc.) and for human contributors who use them.

## Goals
- Keep the site coherent, fast, and easy to extend.
- Respect the split between **React pages in `/app`** and **static sub-sites in `/public`**.
- Prevent undocumented, cross-cutting refactors.

## Repo Map (authoritative)
- **/app** — Next.js App Router pages
  - `layout.tsx` global HTML and dark theme
  - `page.tsx` home hub with section cards
  - `games/page.tsx`, `tools/page.tsx`, `trips/page.tsx` list content from `/public`
  - `style-guide/page.tsx` showcases UI tokens and basic components
  - `tools/trip-cost/**` Firebase-backed Trip Cost React app
  - `tools/trip-planner/**` Trip Planner scaffold (Firebase Auth + UI timeline)
  - `tools/date-night/**` Date Night Roulette (Firebase Auth + Firestore roller + reviews + batch CSV imports; split math in `lib/{decay,stacking,roller}.ts` with Vitest tests)
  - `tools/cifi-research-estimator/page.tsx` CIFI research payout estimator with localStorage-backed inputs/history and hand-built SVG charts
  - `tools/conflict-tracker/**` Conflict Tracker (Firebase Auth + Firestore; two-person tracker groups, per-conflict reflections, shared section, trend dashboard; helpers in `lib/{firebase,db,types,tags}.ts`)
  - `tools/shows/**` Movie/TV Show Tracker (Firebase Auth + Firestore; Gemini title classification and mood recommendations via Edge API routes; model metadata in `app/lib/aiModels.ts`)
- **/components** — Reusable UI (Button via CVA, Input, Select, Nav, ProjectCard)
- **/public** — Static HTML/CSS/JS sub-sites and assets
  - `/games/**`, `/tools/**`, `/trips/**` each with their own `index.html`
- **/lib** — Utilities (currently minimal, reserved for shared logic)
- **/content** — Markdown/MDX (placeholder for future)
- **/tailwind.config.ts**, **/app/globals.css** — Design tokens, theme, utilities
- **/next.config.ts**, **/tsconfig.json**, **/eslint.config.mjs** — Tooling
- **/package.json** — Scripts and dependencies

## What you may do (safe, encouraged)
- **Add a static game/tool/trip** under `/public/<section>/<Name>/index.html` and add a card entry to `app/<section>/page.tsx`.
- **Add a React tool** under `app/tools/<name>/page.tsx` with colocated components.
- **Small refactors** for clarity or reuse that do not cross layers (e.g., extracting a UI subcomponent).
- **Docs**: Update README, this file, and ARCHITECTURE/SECURITY when fundamentals change.

## What you must avoid
- Moving functionality between `/public` and `/app` without explicit requirement.
- Large, cross-cutting refactors of routing, styling tokens, or component structure without an ADR or owner sign-off.
- Introducing server-side secrets or privileged operations in this static/client-first repo.

## Style and conventions
- **TypeScript** for React code.
- **Tailwind** with tokens from `globals.css` and config; keep UI consistent with existing utilities.
- **Icons** via `lucide-react` as in current pages.
- Prefer **small, focused commits** following **Conventional Commits** (see CONTRIBUTING.md).

## Additions: exact steps
### Add a static Game/Tool/Trip
1. Create folder: `/public/(games|tools|trips)/<Name>/index.html` (+ assets).
2. Add a card object to `app/(games|tools|trips)/page.tsx` (`name`, `description`, `href`).
3. Ensure the static page includes a link back to `/` or its section.
4. Run `npm run dev`, verify link and layout.

### Add a React Tool
1. Scaffold `app/tools/<name>/page.tsx` (client component if interactive).
2. Add any subcomponents under `app/tools/<name>/components/**`.
3. Follow Trip Cost patterns for context/state when needed.
4. Update `app/tools/page.tsx` list so it appears in the Tools hub.

## Trip Cost, Trip Planner & Conflict Tracker specifics
- Firebase config at `app/tools/trip-cost/firebaseConfig.ts` (admin email: `arkkahdarkkahd@gmail.com`).
- Firestore collections rooted at `artifacts/trip-cost/**` (see `db.ts` helpers).
- Authentication: Firebase Auth email/password; UI in `components/AuthForm.tsx` (reused by Trip Planner and Conflict Tracker).
- Trip Planner now persists to Firestore under `artifacts/trip-planner/**`. Client helpers live in `app/tools/trip-planner/lib/{firebase,db,image}.ts` and real-time state comes from `PlanContext.tsx`.
- Real-time reads via Firestore listeners in `TripContext.tsx` and screens under `components/TripDetail/**`.
- Conflict Tracker persists to Firestore under `artifacts/conflict-tracker/trackers/{trackerId}/conflicts/{conflictId}/reflections/{personA|personB}`. Typed helpers in `app/tools/conflict-tracker/lib/`. Real-time state from `ConflictContext.tsx`. The tracker groups all conflicts for a two-person pair; each conflict has independent per-person reflections that are hidden until both sides submit.

## CalorieTracker specifics (`public/tools/CalorieTracker/`)
Static client-side app. No React. Firebase Auth + Firestore for persistence (config in `firebaseConfig.js`).

Key engine/target files:
- `analysis/engine.js` — pure analysis engine (no Firebase/DOM). Key exports: `runAnalysis`, `getTrueUpCandidates`, `buildBlankDayEstimateEntry`, `buildVacationDayEntry`, `computeWeekdayAverages`.
- `targets/targetEngine.js` — pure target calculator. Key export: `generateTargets(profile, goals, analysisResults)`.
- `targets/nutritionReferences.js` — DRI/UL tables for micronutrients.

Critical design constraints:
- `getTrueUpCandidates` uses **centered windows** `[D-preDays, D+postDays]` — do not revert to end-anchored windows. Requires `minPostWeights` future weight readings per interval. TDEE reference comes from blocks *outside* the candidate interval (avoid circularity). Pending candidates attach as `results._pending` (non-enumerable-style array property).
- `computeWeekdayAverages` uses `trimmedMean(arr, 0.1)` — do not revert to arithmetic mean.
- `buildBlankDayEstimateEntry` spreads historical micronutrient averages (20 keys) onto both the entry and its `foodItems[0]`, falling back to `baselineTargets`.
- `computeProteinTarget(goalType, weightLb, ffm_kg, goals)` implements proteinBasis: auto fat-loss priority is leanMass → targetWeight → currentWeight. `goalSettings.proteinBasis` is `null` / `'auto'` / `'currentWeight'` / `'targetWeight'` / `'leanMass'` / `'adjustedWeight'`.
- `getBlankDaysForPopulation` and `getPartialDaysForAdjustment` are `@legacy` — not called from any live UI path; kept for backward compat only.

Test suite: 554 tests across 8 files, run with `node_modules/.bin/vitest run` from `public/tools/CalorieTracker/`. All pure-function tests — no Firebase or DOM.

### Backlog workflow
Ongoing CalorieTracker work lives in [`public/tools/CalorieTracker/BACKLOG.md`](public/tools/CalorieTracker/BACKLOG.md). Read it at session start — its header documents the full protocol; the points below are a pointer, not a duplicate.

- **Trigger (auto-fires the protocol):** _"start working on the backlog"_, _"continue working on the CalorieTracker backlog"_, _"work on the calorie tracker backlog"_, _"pick up the backlog"_, or a close paraphrase. On recognizing one, read `BACKLOG.md` and run its protocol unprompted — reconcile, then work the top-priority `[ ]` items.
- **Working branch:** `working/calorie-tracker-backlog`, long-lived, branched from `main`. Switch onto it (create from `origin/main` if missing) when the environment allows. In web/remote sessions the harness may pin a `claude/<adjective>-<noun>-<id>` branch you cannot switch off — that is fine; completion keys off commits merged to `main`, not the branch name.
- **PR:** one long-lived PR → `main`. On first push, create it via the GitHub MCP tools if not already open; subsequent pushes update the same PR.
- **Completion is hands-off but merge-gated:** mark `[p]` and record `commit: <short-sha>` on push. A later session's reconcile step flips `[p]`→`[x]` once that commit is merged to `main` (`git merge-base --is-ancestor <sha> origin/main`). **Never mark `[x]` for merely-pushed code, and never flip it manually** — merge to `main` is the only signal.
- **Status legend:** `[ ]` not started · `[p]` in progress / pushed / awaiting merge / blocked / needs follow-up · `[x]` complete (merged). Notes are one line, reference the commit hash, and replace (don't append).
- **New items:** when the user adds a feature/bug, slot it into the appropriate priority section (CRITICAL → HIGH → MEDIUM → LOW) and pick the next free number (#47, #48, …).

## Documentation requirements (non-negotiable)
Any **fundamental change** (routing, structure, build commands, data model, security rules, theming, component API) must update in the **same PR**:
- `README.md`
- `AI_AGENTS.md`
- `ARCHITECTURE.md` (if structure/data flow changed)
- `SECURITY.md` (if auth/rules or data surfaces changed)

Add a short **“Docs”** section to the PR body summarizing what changed in the docs.

## Commit and PR rules (summary)
- **Commits:** `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `chore: ...`
- **PR checklist:**
  - Build and lint pass locally.
  - Screenshots for UI changes.
  - Docs updated per above.
  - Tested relevant pages (home + affected section).

---

If in doubt, read **README.md** and **ARCHITECTURE.md** first, then ask for owner review before large changes.


> Firestore Security Rules source of truth: `firestore.rules` (repo root). Keep docs referencing this file rather than embedding duplicate rule blocks.
