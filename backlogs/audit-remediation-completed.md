# Audit Remediation — Completed Archive

Read only for reconciliation, regression investigation, or historical review. Active priority and implementation instructions live in `backlogs/audit-remediation.md`.

## Archive format

Move an initiative here only after its implementation is merged to `main`, acceptance criteria and required deployment are verified, and regression coverage exists:

`- [x] **AR-NN Title** — Resolved: <outcome>; findings: <ids>; checks: <summary>; merged: <sha>; residual risk: <none or concise note>.`

Detailed rationale remains in the implementation PR and linked audit reports.

## Completed initiatives

_None yet._

## Findings closed by work merged after the audit baseline

These are not AR initiative completions; they are upstream feature PRs that fully superseded specific source findings and were reconciled before this backlog was published.

- [x] **PR #152 Transcriber quality pipeline** — deterministic cross-chunk overlap/reconciliation, conservative speaker identity, separate range classification, and SHA-256 clip cache identity closed F-057, F-058, F-062, and F-063; checks reported: root tests, TypeScript, lint, Next build, Cloudflare build, diff check; merged `a4bd351`.
- [x] **PR #153 Recipe workflow schema v2** — exact prompt/schema contract and structural workflow chronology/cycle validation closed F-094 and F-095; checks and focused workflow/schema coverage reported in the PR; merged `8912876`.
