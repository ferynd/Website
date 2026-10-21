# Trip Cost Tracker Redesign

Active feature backlog for the ledger-first Trip Cost Tracker (`app/tools/trip-cost/`). Goals: correct, cents-exact totals; an expense matrix (Expense | Total | one column per traveler) with labelled budget-cap adjustment rows; a Participants & Settings tab; one shared add/edit expense dialog; settlements below the ledger; usable at 390px without page-wide sideways scrolling.

**Non-goals:** schema changes, Firestore rules changes, data migration, subcollection storage (AR-09), email invites, bulk reallocation tools, expense-by-expense or chronological cap attribution, trip ID in the URL, and site-wide UI rewrites.

## Parameters

- **Branch/PR:** one fresh branch and PR per phase from current `main`: `working/trip-cost-p<N>`.
- **Commit scope:** `trip-cost`; phase IDs TC-P1–TC-P6 (named so they don't collide with Recipe Standardizer P-numbers); next new ID TC-P7; never reuse IDs.
- **Archive:** `backlogs/trip-cost-completed.md`.
- **Checks:** root `npm test`; UI phases also `npm run lint` and `npm run build`.
- **Manual verification (UI phases):** open a real trip at 1280px and 390px; at 390px the page `scrollWidth` must equal the viewport width.

## Approved decisions (James, 2026-10-21)

- **D1 — Who absorbs over-cap costs:** keep today's rule: everyone not at their cap, including $0-share and later-added travelers. Make the effect explicit (adjustment rows, eligibility preview, add-traveler notice).
- **D2 — Trip default split:** when a default exists, new expenses start on "Trip default", saved as a percent snapshot; excluded travelers are rescaled in the preview; travelers missing from the default get an explicit 0% plus a Settings warning.
- **D3 — Account linking:** admin-only, to an existing registered account; keeps the participant `id`.
- **D4 — Recording payments:** non-admins may record only payments where they are payer or payee; admins any. Client-side only; rules enforcement (F-088) stays with AR-09.
- **D5 — Priority:** listed first in `BACKLOG.md`.
- **Infeasible caps — warn, don't block:** saving caps that can't be covered shows a warning but is allowed (a later expense can make caps infeasible anyway). The ledger shows a persistent "Not covered by anyone" amount and pauses settlement suggestions. This is how AR-04's "Reject infeasible caps" criterion is met for Trip Cost.

## Current state and invariants

- One Firestore document per trip at `artifacts/trip-cost/trips/{tripId}` with `participants[]`, `participantIds[]`, `expenses[]`, `payments[]`, `spendCaps?`, `overageSplit?`, `defaultSplit?`. Every mutation rewrites the whole array (AR-09 owns that risk; keep the `TripContext` mutation API stable for it).
- Settings (`spendCaps`, `overageSplit`, `defaultSplit`) are admin-only by rules; expense/payment ownership checks are client-only (AR-09).
- All money math is integer cents (`utils/money.ts`). Each expense is split exactly with largest remainder, ties by `splitParticipants` order.
- Total spending is the sum of expense totals. Caps act on expense allocations only. Reimbursements never change spending, final responsibility, or caps.
- Remaining = final responsibility − paid for purchases − reimbursements sent + reimbursements received (positive = owes).
- Unknown travelers, empty splits, payer gaps, and split gaps are explicit ledger problems; settlement suggestions pause while any cost is unallocated or balances don't net to zero.
- Adding a traveler never resplits saved expense rows (`splitParticipants` is stored per expense).
- New expense writes add up exactly (payers and Custom $ to the cent, Custom % to exactly 100%); money fields left unedited on an existing expense are saved back verbatim, so legacy rows within the old tolerance stay editable. Payments must be > $0 in whole cents between two different travelers on the trip.
- Linking an account keeps the participant `id`; a uid may be linked to at most one traveler per trip; `participantIds` is always recomputed from `participants`.

## Active phases

### TC-P2 — Draft, payment, and participant logic

- [p] **Pure draft/validation helpers wired into `TripContext`; no layout change.** Depends: TC-P1.
  > pushed — `utils/expenseDraft.ts`, `utils/payment.ts`, `utils/participants.ts` wired into `TripContext` (exact-cent new writes per C5, payment validation per C10, id-preserving account linking per D3; unedited legacy money fields saved verbatim); no layout, rules, schema, or data changes; checks: npm test (1963), lint, tsc, build pass; commit: 1aeb666; PR: #170
  - `utils/expenseDraft.ts` (`expenseToDraft`, `validateDraft` → errors + preview, `draftToExpenseFields`, trip-default application/renormalization per D2), `utils/payment.ts` (`validatePayment`), `utils/participants.ts` (`linkParticipantAccount`, `participantIdsFor`).
  - New writes require exact cent sums (C5) and valid payments (C10: amount > 0 in whole cents, payer ≠ payee, both known).
  - **Accept:** every split method; explicit zero vs excluded; $↔% conversion; exact-cent validation; legacy round-trip leaves stored values unchanged; payment validation cases (negative, zero, fractional cent, self, unknown); linking keeps the id, refuses a uid already linked elsewhere in the trip, recomputes `participantIds`.

### TC-P3 — Layout and ledger table

- [ ] **Header, tabs, `LedgerTable`, detail sheets, local `Dialog`.** Depends: TC-P1.
  - Expenses tab: header (name, total spending, Add expense, balance strip, problem banner) and a real `<table>` with category groups, expense subtotal, labelled cap-adjustment rows, "Not covered by anyone", and final responsibility. Participants, settings, and audit log move unchanged to the Participants & Settings tab. The old `ExpenseForm` is hosted temporarily in the dialog; `ExpensesList` is removed.
  - Fixes F-019, F-020, F-023 for Trip Cost only.
  - **Accept:** at 390px page `scrollWidth` equals viewport width; the ledger scrolls inside its card with the Expense column pinned; no hover-only actions; adjustment and final rows have text labels; rows open `ExpenseDetailSheet` by keyboard and touch.

### TC-P4 — Shared expense editor

- [ ] **`ExpenseEditor` for add and edit; remove `ExpenseForm`.** Depends: TC-P2, TC-P3.
  - Payer picker (single, or several on demand), traveler chips, Equal / Trip default / Custom $ / Custom %, explicit zero, live cents-exact preview, inline reasons for disabled Save, stale-edit warning.
  - **Accept:** payers and splits on historical expenses are editable; all split methods work; trip default behaves per D2; legacy mixed types load as Custom $.

### TC-P5 — Settlements

- [ ] **`SettlementsSection`, `RecordPaymentDialog`, balance strip; remove `BalanceSummary`, per-person payment forms, and the old `calc.ts` balance/cap/settlement functions.** Depends: TC-P2, TC-P3.
  - Balance breakdown rows (final, paid, reimbursements sent/received, remaining), Record buttons on suggestions, one Record payment entry point with "logs a reimbursement; does not send money" copy, overpay warning, payment history; D4 gating.
  - **Accept:** one way to record a payment; Owes / Is owed / Settled copy everywhere; reimbursements leave spending and caps unchanged (tested in TC-P1, checked by hand here).

### TC-P6 — Participants & Settings sections

- [ ] **Sectioned settings tab, account linking, one-write settings save.** Depends: TC-P2, TC-P3.
  - Travelers (link account per D3, removal guard lists blocking records), budget caps with progress against final responsibility and near-cap marker, overage redistribution with eligibility preview, default split (blank inputs, missing-traveler warning), audit log. Validate first, then one `setDoc`; warn when the trip changed since the form loaded (C13). Infeasible caps warn but save. Add-traveler notice about resplitting and overage effect (C8). README blurb.
  - **Accept:** linking a name-only participant keeps its id and history; partial saves are impossible; the new-traveler overage effect is shown.
