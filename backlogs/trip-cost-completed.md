# Trip Cost Tracker Redesign — Completed Items Archive

Completed items are moved here from `backlogs/trip-cost.md` by the reconcile
step in `backlogs/protocol.md` (only after their commits merge to `main`).

## Completed phases (TC-P1–TC-P6, in order)

### TC-P1 — Calculation core

- [x] **Cents-exact ledger with explicit problems, cap transfers, and corrected balances.**
  > Resolved: cents-exact ledger (`utils/money.ts`, `utils/ledger.ts`, `utils/ledgerLabels.ts`) with explicit problems and cap transfer rows; C1/C2/C4/C5/C6/C7/C9 fixed; Balances/Settlement Suggestions read `TripContext.ledger` with a problem banner; Ohio golden matches with no 1¢ drift; docs; no rules/schema/data changes; checks: npm test (1898), lint, tsc, build pass; merged: 2eee2c5 (commit 3f420e6, PR #169); pre-merge check: all 6 production trips had 0 payments (admin view, 2026-10-21 17:19 CDT), so C1 changed no live balances; residual risk: `calc.ts` legacy helpers remain until TC-P5.

### TC-P2 — Draft, payment, and participant logic

- [x] **Pure draft/validation helpers wired into `TripContext`; no layout change.**
  > Resolved: `utils/expenseDraft.ts`, `utils/payment.ts`, and `utils/participants.ts` wired into `TripContext` for exact-cent new writes, payment validation, id-preserving account linking, and legacy round-trip preservation; checks: npm test (1963), lint, tsc, build pass; merged: 2e52cd7 (commit 1aeb666, PR #170); residual risk: the current form's on-screen ±$0.01 check remains until TC-P4.

### TC-P3 — Layout and ledger table

- [x] **Header, tabs, `LedgerTable`, detail sheets, local `Dialog`.**
  > Resolved: ledger-first header/tabs, contained ledger matrix with pinned Expense column and labelled adjustments/final rows, keyboard/touch expense and traveler sheets, local responsive focus-trapping Dialog, temporary ExpenseForm dialog, ExpensesList removed; F-019/F-020/F-023 fixed for Trip Cost only; checks: npm test (1986), lint, tsc, build pass; merged: 42f312b (head f09e814, PR #171); residual risk: five 390px follow-ups (trip-list title/Create Trip overflow, participant Add overflow, balance-strip overflow cue, empty Reimbursements body, and traveler-header hit-target overlap), fixed in TC-P4.

### TC-P4 — Shared expense editor

- [x] **`ExpenseEditor` for add and edit; remove `ExpenseForm`.**
  > Resolved: shared add/edit dialog with payer picker, traveler selection, Equal / Trip default / Custom $ / Custom %, explicit zeros, live cents-exact preview, stale-edit confirmation, and legacy round-trip preservation; ExpenseForm removed; checks: npm test (2084), lint, tsc, build pass; merged: 7c71be8 (head 852eb19, PR #172); residual risk: TC-P4 visual follow-ups (a)–(c) and #172 P3 leftovers (d)–(e), fixed in TC-P5; accepted: legacy sub-cent precision after a total edit, large-total equal-with-zeros drift.

### TC-P5 — Settlements

- [x] **`SettlementsSection`, `RecordPaymentDialog`, balance strip; remove `BalanceSummary`, per-person payment forms, and the old `calc.ts` balance/cap/settlement functions.**
  > Resolved: settlements below the ledger with one Record payment dialog, Owes / Is owed / Settled copy, D4 client gating, and balance breakdown; BalanceSummary, per-person payment forms, and legacy calc.ts removed; checks: npm test (2150), lint, tsc, build pass; merged: 51f954f (head a93a45b, PR #173); residual risk: accepted — a new traveler added while the editor is open with an invalid percentage gets a blank share; trip-list loading flash and overpay wording follow-ups (a) and (b) are fixed in TC-P6.
