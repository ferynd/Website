# Backlog Agent Instructions

These instructions apply under `backlogs/` and supplement root `AGENTS.md`.

## Context discipline

1. Read root `BACKLOG.md` to select exactly one workstream.
2. Read `backlogs/protocol.md` and only the selected active backlog.
3. Read its completed archive only for reconciliation, regression investigation, or historical review.
4. Read linked audit reports only when implementation evidence is unclear or the selected item explicitly links them.
5. Never load all backlogs, archives, or audit reports by default.

## Creating a new feature backlog

When the user asks to build, deploy, or roll out a new feature and no suitable backlog exists:

1. Inspect the affected code and current `main`; do not invent architecture from memory.
2. Create `backlogs/<feature-slug>.md` and `backlogs/<feature-slug>-completed.md`.
3. Add the active file to root `BACKLOG.md` at the user-requested priority. With no stated priority, place it after approved active rollouts and before optional work.
4. Use stable IDs that are never reused: phases (`P0`, `P1`…) for ordered rollouts, numbered items (`#1`, `#2`…) for independent work, and initiative IDs for architectural programs.
5. Keep the active backlog compact and implementation-ready. Include:
   - purpose, scope, and explicit non-goals;
   - Parameters: branch/PR strategy, commit scope, ID format, archive, required checks;
   - verified current state and invariants/contracts;
   - dependency-ordered active items;
   - goal, affected surfaces, `Depends`, acceptance criteria, tests, and migration/deployment steps for each item.
6. Default to one independently reviewable phase/initiative per PR. Combine only tightly coupled work sharing files, tests, and release boundary.
7. Record unresolved product decisions as blocked items. Ask only when a choice materially changes behavior; otherwise choose the safest reversible option and document it.
8. Include audit findings only when the feature touches that code or the finding blocks safe deployment. Leave unrelated remediation in `audit-remediation.md`.
9. Do not start implementation until the backlog has enough acceptance criteria to determine completion. For a user-approved, unambiguous request, backlog creation and the first phase may occur in the same session.

## Maintaining the hierarchy

- Root `BACKLOG.md` contains routing and priority only, not task detail.
- Active backlog files contain unstarted/in-progress work plus concise invariants.
- After merge and acceptance verification, move completed items to the matching archive under `backlogs/protocol.md`.
- Archive entries contain outcome, merged SHA, checks, closed IDs/findings, and residual risk; detailed rationale remains in the PR or linked review.
- If an active backlog has no actionable items, remove it from the active priority list or mark it dormant.
- Reprioritization must be explicit in `BACKLOG.md`; a new request does not permanently outrank approved work unless the user says so.
- Do not maintain a separate current-work file. Derive state from `main`, PRs, `[p]` entries, and priority order.

## Feature completion

A phase is complete only when its commit is merged to `main`, acceptance criteria and required checks are verified, documentation/migrations are updated, and the item is archived. Deployment-only/manual steps stay open until confirmed; code merge alone does not close them.
