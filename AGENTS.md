# Agent Instructions

Canonical instruction entry point for Claude Code, Codex, GitHub Copilot, and other coding agents working in this repository.

## Context loading order

1. Read `AGENTS.md` first.
2. For backlog, rollout, remediation, or vague continuation requests, read `BACKLOG.md` to select exactly one workstream.
3. When a workstream is selected, read `backlogs/AGENTS.md`, `backlogs/protocol.md`, and only that active backlog.
4. Read `ARCHITECTURE.md` only when the selected work changes structure, routing, data flow, major state management, shared UI, or tool architecture.
5. Read `SECURITY.md` only when the selected work changes auth, Firestore, Storage, secrets, PII, external services/scripts, retention, or API/model routes.
6. Read tool-specific code and docs only for the selected work.
7. Read completed archives or `reviews/tasks/**` only for reconciliation, regression investigation, or when the selected item links to them.

Never load all backlogs, archives, or audit reports by default.

## Repository map

- `/app` — Next.js App Router pages, APIs, and React tools.
- `/components` — reusable React UI.
- `/public` — standalone static games, tools, trips, and assets.
- `/backlogs` — active execution queues, shared protocol, and completed archives.
- `/reviews` — historical investigation evidence; not a normal session-start dependency.
- `firestore.rules` — canonical Firestore Security Rules source.

## Workstream rules

- **New feature or rollout:** follow `BACKLOG.md` and `backlogs/AGENTS.md`. Create an active backlog plus matching completed archive when none exists, place it explicitly in the feature priority list, then implement the first approved and unblocked phase.
- **Feature continuation:** use the highest-priority actionable feature backlog unless the user names another.
- **Fixes/audit remediation:** use `backlogs/audit-remediation.md` in wave/dependency order.
- **Named tool/item/wave:** use the named target.
- Keep feature and remediation PRs separate unless a finding directly blocks or is necessarily touched by the feature.
- An exposed security/privacy issue or materially misleading output in Wave 0 may override feature order; explain the override.
- Derive current work from merged commits and active backlog state. Do not create a manually maintained `CURRENT_WORK.md`.

## Implementation rules

- TypeScript for React/Next.js code.
- Tailwind with tokens from `app/globals.css`; icons via `lucide-react`.
- Prefer small, focused, reversible changes and one phase/initiative per PR.
- Preserve ownership, authorization, financial conservation, date/time, and schema invariants at the server/rules/data boundary, not only in UI code.
- For multi-step writes, use transactions/batches/idempotency or expose partial success explicitly.
- For settings, prefer one versioned localStorage object with a pure defensive parser and SSR-safe read/save wrappers.
- Static sub-sites must include a return path and render untrusted values as text, not HTML.
- Firebase web keys are public identifiers; never commit private keys or API tokens.

## Testing policy

Use the smallest scope that provides meaningful confidence, then run every command required by the selected backlog.

- Docs/workflow-only changes: validate paths, links, dispatch rules, stale references, and source-of-truth consistency; app tests are not required.
- Pure logic: nearest focused test, then the relevant suite.
- CalorieTracker behavior: `cd public/tools/CalorieTracker && npm test`.
- Recipe Standardizer logic: root `npm test`; component/page changes also `npm run lint` and `npm run build`.
- React page/component changes: `npm run lint` and `npm run build`.
- Shared config/dependencies/routing: `npm run lint`, `npm run build`, and `npm test`.
- Auth/rules/data-model changes: relevant tests plus Firestore/Storage emulator coverage when available; clearly identify any manual deployment validation.
- Critical/high fixes require a regression test or a documented reason automation is not feasible.

Report checks concisely; do not paste successful logs.

## Documentation ownership

Update affected sources in the same PR:

- `README.md` — stable project overview and quick start.
- `ARCHITECTURE.md` — current structure/data flow.
- `SECURITY.md` — enforced security/privacy behavior and known limitations.
- `AGENTS.md` — repository-wide agent rules.
- `BACKLOG.md` — workstream routing and priority only.
- `backlogs/AGENTS.md` — backlog hierarchy creation/maintenance.
- `backlogs/protocol.md` — status, reconcile, commit, PR, and archive workflow.
- `backlogs/<name>.md` — active items and invariants.
- `backlogs/<name>-completed.md` — merged outcomes.

Do not describe intended client behavior as an enforced security guarantee unless rules/server tests prove it.

## Commit and PR rules

- Conventional Commits, with useful scopes and item IDs for backlog work.
- Record pushed commit SHA and PR number on every `[p]` item.
- An item reaches `[x]` only after its commit is merged to `main` and acceptance criteria are verified.
- Move completed detail out of active files into the matching archive during reconciliation.
- PR body: scope, rationale/root cause, item IDs, checks, docs/migrations, known follow-ups, and residual risk.
