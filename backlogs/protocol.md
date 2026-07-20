# Backlog Session Protocol

Applies to every active backlog under `backlogs/`. Each backlog supplies its own Parameters block. Root `BACKLOG.md` selects the workstream; `backlogs/AGENTS.md` defines hierarchy creation and maintenance.

## Session start

1. Fetch `origin/main` and inspect the selected backlog’s branch/PR strategy.
2. Read the selected backlog end-to-end. Do not load unrelated backlogs or archives.
3. Reconcile every `[p]` item in that backlog:
   - if its recorded commit is an ancestor of `main`, verify acceptance criteria/checks, change it to `[x]`, and move it to the matching archive;
   - if pushed but unmerged, leave it `[p] pushed`;
   - if review requested changes, replace the note with `[p] needs follow-up`;
   - if no valid commit SHA is recorded, it cannot be auto-completed.
4. Resume `[p] needs follow-up` first. Otherwise choose the first unblocked `[ ]` item in backlog order whose dependencies are met.
5. Default batch size is one phase/initiative or one to three tightly coupled small items. Avoid concurrent PRs that edit the same subsystem.

## Implement, validate, publish

6. Work from current `main` unless the selected backlog explicitly requires another base. Use one focused branch/PR per phase or initiative by default.
7. Implement the smallest complete change that satisfies the item’s acceptance criteria. Preserve unrelated user changes.
8. Add or update regression coverage for behavior that can silently corrupt data, authorization, calculations, timestamps, or AI output.
9. Run the selected backlog’s required checks plus the relevant commands from `AGENTS.md`.
10. Mark touched items `[p]` with exactly one current status line.
11. Commit using a descriptive Conventional Commit containing the backlog item ID, for example:
    - `feat(recipe-standardizer): P1 add confirmed food links and gram basis`
    - `fix(audit): AR-04 conserve Trip Cost settlements`
12. Push the branch and record the short commit SHA and PR number on each touched item.
13. Open or update one PR for that phase/initiative. The PR body must include scope, item IDs, rationale/root cause, checks, docs/migrations, manual verification, known follow-ups, and residual risk.
14. Keep the PR draft until its intended scope and required checks are complete unless the user asks otherwise.

## Status legend

| Mark | Meaning |
|---|---|
| `[ ]` | Not started and unblocked unless `Depends` says otherwise. |
| `[p]` | In progress, pushed, awaiting merge, blocked, or needs follow-up. |
| `[x]` | Merged to `main`, acceptance verified, and ready to archive. |

Use one of these note forms:

- `> in progress — <remaining work>`
- `> pushed — <outcome>; checks: <summary>; commit: <sha>; PR: #<n>`
- `> blocked — <reason and required decision/dependency>`
- `> needs follow-up — <review request>; commit: <sha>; PR: #<n>`

When archived:

- `> Resolved: <outcome>; checks: <summary>; merged: <sha>; residual risk: <none or concise note>`

## Completion and archive rules

- Never mark `[x]` for code that is only pushed.
- Merge to `main` is necessary but not sufficient: verify item acceptance criteria, required deployment/migration steps, and regression coverage.
- Manual production/Firebase steps remain open until the user or automation confirms them.
- Move completed items out of the active file during reconciliation. Do not retain duplicated narratives.
- Never reuse item IDs.
- If a merged implementation only partially addresses an item, split or rewrite the remaining acceptance criteria and archive only the verified portion.
- Any fundamental behavior change ships the relevant `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, agent, and backlog updates in the same PR.

## Branch and PR strategy

- Respect the selected backlog’s Parameters block. It may use a long-lived branch or one fresh branch per phase/initiative.
- Fresh phase/initiative branches should start from current `origin/main`.
- Remote harnesses may force an ephemeral branch; completion still derives from the recorded commit merging to `main`.
- After a PR merges, start the next phase from the new `main`; do not carry stale branch state forward.
