# Agent Instructions

Canonical instruction entry point for Claude Code, Codex, and other coding agents working in this repository.

## Context loading order

1. Read `AGENTS.md` first.
2. Read `ARCHITECTURE.md` only when changing structure, routing, data flow, major state management, shared UI patterns, or tool architecture.
3. Read `SECURITY.md` only when changing auth, Firestore, Storage, secrets, PII, external scripts, data retention, model/API routes, or other sensitive data surfaces.
4. Read root `BACKLOG.md` when the user asks about backlog work.
5. Read `backlogs/calorie-tracker.md` only when the user asks to work on the CalorieTracker backlog or a CalorieTracker issue.
6. Read tool-specific files only when editing that tool.

## Repo map

- `/app` — Next.js App Router pages and React tools.
- `/components` — reusable React UI.
- `/public` — static standalone games, tools, trips, and assets.
- `/backlogs` — detailed working backlogs.
- `firestore.rules` — canonical Firestore Security Rules source of truth.

## Safe changes

- Add a static game, tool, or trip under `/public/<section>/<Name>/index.html` and add a card entry to `app/<section>/page.tsx`.
- Add a React tool under `app/tools/<name>/page.tsx` with colocated components.
- Small refactors for clarity or reuse that do not cross layers.
- Update docs when fundamentals change.

## Avoid unless explicitly requested

- Moving functionality between `/public` and `/app`.
- Large cross-cutting refactors of routing, styling tokens, or component structure.
- Introducing server-side secrets or privileged operations.
- Modifying CalorieTracker backlog item numbers, statuses, or commit references outside the backlog protocol.

## Implementation rules

- **TypeScript** for React code.
- **Tailwind** with tokens from `globals.css`; keep UI consistent with existing utilities.
- **Icons** via `lucide-react`.
- Prefer minimal, focused diffs.
- Static sub-sites must include a back link to `/` or their section.
- Firebase web keys are public identifiers. Enforce access through Firestore Security Rules. Never commit private server keys.

## Testing policy

Use the smallest test scope that gives meaningful confidence for the files changed. Do not run broad test or build commands by default when the change is docs-only or isolated to one tool.

### Test selection

- Docs-only changes: do not run app tests. Search for stale links, stale paths, conflicting instructions, and broken references.
- Agent or workflow docs: validate by searching for old instruction paths, outdated test counts, moved backlog paths, and conflicting source-of-truth claims.
- Single pure logic module: run the nearest focused unit test first when useful, then the relevant package or tool test suite if behavior changed.
- CalorieTracker logic, validation, parser, target, analysis, state, or UI behavior changes: run `cd public/tools/CalorieTracker && npm test`.
- CalorieTracker docs, backlog, or pointer-file changes only: do not run CalorieTracker tests unless code, package config, or test files changed.
- React component or page changes: run `npm run lint` and `npm run build`.
- Shared app config, routing, package scripts, TypeScript config, ESLint config, or dependency changes: run `npm run lint`, `npm run build`, and `npm test`.
- Security rules, auth, or data model changes: run relevant tests if available, validate affected docs, and clearly note any rules that require manual Firebase validation.

### Test output

Do not paste full successful test logs into PR bodies or final summaries. Report the command and result only.

Use this format:

Checks:
- `npm run build` — passed
- `cd public/tools/CalorieTracker && npm test` — passed

If a command fails, include the command, the meaningful error excerpt, and whether the failure appears related to the current change.

## Documentation update rules

Any fundamental change must update affected docs in the same PR:

- `README.md` — project-facing overview and setup changes.
- `ARCHITECTURE.md` — structure, routing, data flow, and major tool architecture.
- `SECURITY.md` — auth, Firestore, Storage, secrets, PII, external scripts, data retention, and sensitive data surfaces.
- `AGENTS.md` — agent workflow, test expectations, and repo conventions.
- `BACKLOG.md` — backlog index only.
- `backlogs/calorie-tracker.md` — CalorieTracker backlog protocol and item statuses.

## Backlog workflow

Active backlogs are indexed in root `BACKLOG.md`. When the user asks to start, continue, pick up, or work on the CalorieTracker backlog, read `backlogs/calorie-tracker.md` and follow its protocol exactly.

## Security

Firestore Security Rules live in `firestore.rules` at the repo root. See `SECURITY.md` for auth flows, data model, and data retention. Do not duplicate rules in docs.

## Commit and PR rules

- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Use scopes when helpful: `docs(agents):`, `docs(backlog):`, `fix(calorie-tracker):`.
- Keep commits focused.
- PR body should include summary, checks run, docs changed, and known follow-ups.
- For CalorieTracker backlog work, follow `backlogs/calorie-tracker.md` exactly.
