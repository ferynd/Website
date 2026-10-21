# Trip Cost Tracker Redesign — Completed Items Archive

Completed items are moved here from `backlogs/trip-cost.md` by the reconcile
step in `backlogs/protocol.md` (only after their commits merge to `main`).

## Completed phases (TC-P1–TC-P6, in order)

### TC-P1 — Calculation core

- [x] **Cents-exact ledger with explicit problems, cap transfers, and corrected balances.**
  > Resolved: cents-exact ledger (`utils/money.ts`, `utils/ledger.ts`, `utils/ledgerLabels.ts`) with explicit problems and cap transfer rows; C1/C2/C4/C5/C6/C7/C9 fixed; Balances/Settlement Suggestions read `TripContext.ledger` with a problem banner; Ohio golden matches with no 1¢ drift; docs; no rules/schema/data changes; checks: npm test (1898), lint, tsc, build pass; merged: 2eee2c5 (commit 3f420e6, PR #169); pre-merge check: all 6 production trips had 0 payments (admin view, 2026-10-21 17:19 CDT), so C1 changed no live balances; residual risk: `calc.ts` legacy helpers remain until TC-P5.
