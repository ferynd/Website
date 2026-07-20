# Backlog Index

Backlogs live under `backlogs/`. Use `backlogs/AGENTS.md` to create and maintain backlog hierarchies and `backlogs/protocol.md` for reconcile, status, commit, PR, and archive rules.

## Dispatch

- **“Continue,” “continue working on backlog,” or “continue feature rollout” in a feature context:** reconcile the feature list below, then take its first actionable item.
- **“Continue implementing fixes,” “continue audit remediation,” or “continue Wave N”:** use `backlogs/audit-remediation.md`.
- **Named tool, backlog, phase, item, or wave:** use that target.
- **New feature/deployment/rollout:** inspect current `main`, create or update the feature backlog hierarchy under `backlogs/`, add it at the requested priority, and implement the first approved/unblocked phase. Do not silently displace an approved rollout.
- **Security/privacy exposure or materially misleading output:** Wave 0 containment may override feature order; explain why.

## Active feature backlogs — default order

1. `backlogs/recipe-standardizer.md` — Recipe Standardizer → Nutrition Tracker rollout. P0 is a user-assisted, non-blocking deployment check; default coding continues with P1, then P2–P5. P6/P7 require explicit approval.

`backlogs/calorie-tracker.md` currently has no actionable items and is dormant until new work is added.

## Active remediation backlog

- `backlogs/audit-remediation.md` — initiatives AR-00 onward, ordered by wave and dependency.

## Completed archives

- `backlogs/recipe-standardizer-completed.md`
- `backlogs/calorie-tracker-completed.md`
- `backlogs/audit-remediation-completed.md`

## Selection algorithm

1. Select the workstream from the user’s wording and current conversation context.
2. Read `backlogs/AGENTS.md`, `backlogs/protocol.md`, and only the selected active backlog.
3. Reconcile that backlog’s `[p]` items against `main`.
4. Resume `[p] needs follow-up` first; otherwise take the first unblocked `[ ]` item whose dependencies are met. `[p] blocked` user-assisted items remain visible but do not block unrelated dependency-ready coding work.
5. Do not read unrelated backlogs, completed archives, or full audit reports.
