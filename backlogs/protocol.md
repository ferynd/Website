# Backlog Session Protocol (shared)

Applies to every backlog under `backlogs/`. Each backlog file defines a **Parameters**
block (working branch, commit scope, item id format, archive file, test commands) that
fills the placeholders below. Follow this protocol exactly; do not improvise a different
workflow. Which backlog to work on is decided by the dispatch rule in root `BACKLOG.md`.

## Session start

1. `git fetch origin`.
2. Switch to the backlog's working branch (see its Parameters). If it doesn't exist
   locally or on origin, create it from `origin/main`:
   `git switch -c <branch> origin/main`. In web/remote sessions the harness may pin you
   to an auto-generated `claude/<adjective>-<noun>-<id>` branch you cannot switch off —
   that is fine to work on; completion is detected from commits merged to `main`, not
   the branch name.
3. `git pull --ff-only origin <branch>` (skip if just created).
4. **Reconcile completed items (auto-mark `[x]`).** `git fetch origin main`. For every
   `[p]` item whose note records a commit SHA, test whether it has merged to main:
   `git merge-base --is-ancestor <sha> origin/main` (exit 0 = merged). Cross-check the
   backlog PR via the GitHub MCP (`mcp__github__pull_request_read`) when available. For
   each `[p]` item whose commit is on `origin/main`, flip it to `[x]`, rewrite its note
   to `> Resolved: <summary>; merged <short-sha>`, and move it to the backlog's archive
   file in the appropriate priority section. Leave pushed-but-unmerged items `[p]`.
   **This is the only way items reach `[x]`** — hands-off, but never before the user has
   actually merged the PR.
5. Read the backlog file end-to-end. Identify (a) any `[p]` items needing follow-up from
   review or a prior session, then (b) the highest-priority `[ ]` items, in section
   order (CRITICAL → HIGH → MEDIUM → LOW), respecting any `Depends:` lines.
6. Pick the next reasonable batch — usually one to three related items.

## Implement, test, push

7. Implement. Mark each touched item `[p]` with a one-line note (status legend below).
8. Run the backlog's test commands (see its Parameters). Code changes must keep the
   relevant suite green.
9. Commit with a **descriptive** Conventional-Commit message. Format:
   `type(<scope>): <id> short description of the change`
   The message must include: (a) the Conventional Commit type (`feat`, `fix`,
   `refactor`, etc.), (b) the backlog's scope so it's clear which part of the site
   changed, (c) the backlog item id(s), and (d) a plain-English summary of what the
   commit does — not just the item title. Examples:
   - `feat(calorie-tracker): #47 add weekly meal-prep summary view`
   - `feat(recipe-standardizer): R2 export unlinked ingredients as tracker food items`
   One commit per logical change. Multi-item commits list all ids: `#47 #48 ...`.
10. Push: `git push -u origin <branch>` (or the pinned `claude/*` branch in a web
    session). On network failure retry up to 4 times with exponential backoff.
11. **Record the commit SHA** on every item you pushed (`commit: <short-sha>` in its
    `[p]` note, plus the PR number when known). The next session's reconcile step keys
    off this SHA — an item with no recorded SHA can never be auto-completed.
12. **PR title and body must be descriptive.** If no open PR exists for the branch,
    create one via the GitHub MCP tools. Format:
    - **Title:** `<Scope>: <short summary of batch> (<ids>)`
      Example: `Recipe Standardizer: schema v2 nutrition data, ingredient export (R1, R2)`
    - **Body:** list every item addressed with its id and one-line summary, plus a
      pointer to the backlog file. Update the body on subsequent pushes when new items
      are added to the batch.
    All subsequent pushes auto-update the same PR.

## Status legend

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started. |
| `[p]` | In progress / pushed / awaiting merge / blocked / needs follow-up. **Default state once code has been touched.** Records a `commit: <short-sha>` once pushed. |
| `[x]` | Complete — the item's commit has merged to `main` (the user accepted the PR). Set automatically by the reconcile step (step 4); never set for merely-pushed code. Completed items move to the backlog's archive file. |

The note line under a `[p]` item begins with one of these sub-labels so the state is
scannable:

- `> pushed — <one-line summary>; tests: <pass/notes>; commit: <short-sha>` (awaiting merge)
- `> in progress — <what's left>`
- `> blocked — <reason>`
- `> needs follow-up — <what the reviewer said>; commit: <short-sha>`

When the item's commit merges to `main`, the next session's reconcile step moves it to
the archive with a single line:

- `> Resolved: <one-line summary>; merged <short-sha>`

## Editing rules

- **Mark `[p]` when you push; let the reconcile step (step 4) flip `[p]`→`[x]` and move
  to the archive once the commit is merged to `main`.** Never mark `[x]` for code that
  is only pushed, and never flip it manually mid-session — merge to `main` is the single
  signal that an item is done.
- Keep notes to **one line** per item. No pasted diffs, no multi-paragraph rationale —
  reference the commit hash and let the diff speak.
- If the same item is revised after review, **replace** the existing note line (don't
  append) so the file doesn't grow.
- New items the user asks to add get slotted into the most appropriate existing priority
  section (CRITICAL → HIGH → MEDIUM → LOW) based on severity, dependencies, and impact —
  not appended at the bottom.
- Item ids are never reused; numbering continues from the backlog's stated next id.
- Any fundamental change ships its doc updates (`ARCHITECTURE.md`, `SECURITY.md`, etc.
  per `AGENTS.md`) in the same PR as the code.

## Branch and PR strategy

- **Working branch:** each backlog names a long-lived working branch, branched from
  `main`. One PR is open against `main` at any time and is updated by every push.
  Preferred over the ephemeral `claude/*` per-session branches when the environment
  lets you switch.
- **Web/remote sessions:** the harness may pin a per-session `claude/*` branch you
  cannot switch off. That is fine — open or append to a PR against `main` from it.
  Because completion is detected from commits merged to `main` (step 4), the workflow
  does not depend on the branch name being stable.
- **Merging:** The user merges the PR when they want to lock in a batch of items. On the
  next session, the reconcile step auto-marks the merged items `[x]` and moves them to
  the archive. After merge, the working branch is reset/rebased onto the new `main` (or
  deleted and recreated) for the next round.
