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

## Trip Cost & Trip Planner specifics
- Firebase config at `app/tools/trip-cost/firebaseConfig.ts` (admin email: `arkkahdarkkahd@gmail.com`).
- Firestore collections rooted at `artifacts/trip-cost/**` (see `db.ts` helpers).
- Authentication: Firebase Auth email/password; UI in `components/AuthForm.tsx` (reused by Trip Planner scaffold).
- Trip Planner now persists to Firestore under `artifacts/trip-planner/**`. Client helpers live in `app/tools/trip-planner/lib/{firebase,db,image}.ts` and real-time state comes from `PlanContext.tsx`.
- Real-time reads via Firestore listeners in `TripContext.tsx` and screens under `components/TripDetail/**`.

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
