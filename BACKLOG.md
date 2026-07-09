# Backlog Index

Backlogs live under `backlogs/`. The shared session protocol — resume steps, reconcile,
status legend, commit/PR format, branch strategy — is `backlogs/protocol.md`; each
backlog file supplies its own Parameters block (branch, scope, ids, tests).

## Active backlogs (priority order)

1. `backlogs/recipe-standardizer.md` — Recipe Standardizer → Nutrition Tracker rollout
   (items `R1`–`R6`: schema v2 nutrition data, ingredient/recipe export to the tracker,
   recipe nutrition computation, link review, real-recipe QA gate).
2. `backlogs/calorie-tracker.md` — CalorieTracker (items `#N`; protocol, invariants,
   and any active items).

## Completed archives

- `backlogs/recipe-standardizer-completed.md`
- `backlogs/calorie-tracker-completed.md` — all 46 original CalorieTracker items plus
  later batches, with resolution summaries and merge SHAs.

## Agent dispatch

When the user asks to start, continue, pick up, or work on a backlog (exact wording not
required — "continue working on backlog" and close paraphrases count):

1. If they named a backlog (or the work clearly belongs to one tool), use that backlog.
2. Otherwise: run the reconcile step (`backlogs/protocol.md` step 4) on **every** active
   backlog, then work the first backlog in the priority list above that has actionable
   items — a `[p]` item needing follow-up, or an unblocked `[ ]` item whose `Depends:`
   are met. Items marked `[p] pushed` and merely awaiting merge are not actionable.
3. Read `backlogs/protocol.md` plus the chosen backlog file end-to-end, then follow the
   protocol exactly. Do not read the other backlogs or archives unless needed.
