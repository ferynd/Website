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

### P2 — Paste-back nutrition intake and safe food creation

- [x] **Generate one external-ChatGPT prompt, parse strict nutrition JSON, review, and create per-100g foods.**
  > Resolved: versioned nutrition prompt (24 canonical nutrients), strict per-100g parser with exact-path errors and bounds, review table (create/skip/reassign/rename/link-existing), collision-checked create-only tracker food transaction with in-transaction guard reads, auto-confirmed 100 g links; checks: npm test (1491), test:rules (104), lint, tsc, build pass; Codex review 14 findings over 6 rounds all fixed, final round reviewed clean by Claude Opus + Grok; merged: e3ba33d (commit edf0700, PR #164); residual risk: P2 UI live since 2026-10-20 deploy e099df19, manual tracker-side verification of created foods not yet recorded by user.
