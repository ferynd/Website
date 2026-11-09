# Backlog Index

Backlogs live under `backlogs/`. Use `backlogs/AGENTS.md` to create and maintain backlog hierarchies and `backlogs/protocol.md` for reconcile, status, commit, PR, and archive rules.

## Dispatch

- **“Continue,” “continue working on backlog,” or “continue feature rollout” in a feature context:** reconcile the feature list below, then take its first actionable item.
- **“Continue implementing fixes,” “continue audit remediation,” or “continue Wave N”:** use `backlogs/audit-remediation.md`.
- **Named tool, backlog, phase, item, or wave:** use that target.
- **New feature/deployment/rollout:** inspect current `main`, create or update the feature backlog hierarchy under `backlogs/`, add it at the requested priority, and implement the first approved/unblocked phase. Do not silently displace an approved rollout.
- **Security/privacy exposure or materially misleading output:** Wave 0 containment may override feature order; explain why.

## Active feature backlogs — default order

1. `backlogs/recipe-standardizer.md` — Recipe Standardizer → Nutrition Tracker rollout. P0 and P5-M1 are user-assisted, non-blocking checks; P1–P5 implementation is merged; P6 remains optional. Nutrition enrichment formerly scoped as P7 now routes to CalorieTracker #62 (research packets) and #67/#70 (import workspace).
2. `backlogs/calorie-tracker.md`: ingredient-based nutrition (#59–#80). Follow the 2026-11-09 phase order in that file and [the requirements review](docs/nutrition/REQUIREMENTS_REVIEW_2026-11-09.md). The parent recorded the read-only census: 191 v1 foods and 0 v2 foods. Agents must not query production. The first selectable item is #72. Phase 2 keeps both write flags false: #72, #73, #74, #78, #75, then #69 Part B and #64 Part B. #80 is the census-script fix and does not rerun production. #79 is the later isolated-project gate and blocks #68. Live pulls, catalog import, rules deploys, writer flags, production saves, #68, and #71 stay unapproved. This follows the existing recipe rollout without displacing it.

`backlogs/trip-cost.md` has no actionable items and remains dormant until new work is added.

## Active remediation backlog

- `backlogs/audit-remediation.md` — initiatives AR-00 onward, ordered by wave and dependency.

## Completed archives

- `backlogs/trip-cost-completed.md`
- `backlogs/recipe-standardizer-completed.md`
- `backlogs/calorie-tracker-completed.md`
- `backlogs/audit-remediation-completed.md`

## Selection algorithm

1. Select the workstream from the user’s wording and current conversation context.
2. Read `backlogs/AGENTS.md`, `backlogs/protocol.md`, and only the selected active backlog.
3. Reconcile that backlog’s `[p]` items against `main`.
4. Resume `[p] needs follow-up` first; otherwise take the first unblocked `[ ]` item whose dependencies are met. `[p] blocked` user-assisted items remain visible but do not block unrelated dependency-ready coding work.
5. Do not read unrelated backlogs, completed archives, or full audit reports.
