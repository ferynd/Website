# Recipe Standardizer — Completed Items Archive

Completed items are moved here from `backlogs/recipe-standardizer.md` by the reconcile
step in `backlogs/protocol.md` (only after their commits merge to `main`).

Pre-backlog context: the v1 tool itself shipped in PR #149 (merge `3dd5bd1`) before this
backlog existed — strict-JSON import, workflow sections, gram-first scaling, Ingredients
hub, per-user Firestore saves, and name-only nutrition links.

## Completed phases (P0–P7, in order)

### P1 — Confirmed links and grams basis

- [x] **Add LinkEditor and revision-ready link state.**
  > Resolved: candidate/confirmed/no-match link states with derived stale (missing/renamed/revised) detection, `gramsPerUnit` basis, full TrackerFood fetch, searchable LinkEditor using the existing save guard; findings F-097, F-143; checks: npm test, lint, tsc, build pass, Codex review clean; merged: 56aa175 (commit ae90b0f, PR #163); residual risk: legacy automatic links re-surface as candidates needing re-confirmation; namespace/source discriminator (F-144) deferred to P5.
