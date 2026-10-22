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
- Settings (`spendCaps`, `overageSplit`, `defaultSplit`) are validated together and written in one `updateDoc`. A dirty form warns before overwriting a trip that changed after editing started; overwrite confirmation expires on another revision. Optimistic snapshots do not discard edits before server acceptance, and rejected saves retain the draft. Default totals omit former travelers and accept the legacy 0.1 percentage-point tolerance. Infeasible caps warn and still save.

## Active phases

### TC-P6 — Participants & Settings sections

- [p] **Sectioned settings tab, account linking, one-write settings save.** Depends: TC-P2, TC-P3.
  > pushed — Participants & Settings tab with travelers (link account, removal blockers listed), budget caps progress, overage preview, default split, audit log; one validated updateDoc with stale-edit warning; add-traveler notice; TC-P5 follow-ups (trip-list loading, overpay wording); checks: npm test (2172), tsc, lint, build pass; commit: 6c30233; PR: #174
  - Travelers (link account per D3, removal guard lists blocking records), budget caps with progress against final responsibility and near-cap marker, overage redistribution with eligibility preview, default split (blank inputs, missing-traveler warning), audit log. Validate first, then one `updateDoc` (replacing the three settings maps; `setDoc` merge would keep removed keys); warn when the trip changed since the form loaded (C13). Infeasible caps warn but save. Add-traveler notice about resplitting and overage effect (C8). README blurb.
  - **Accept:** linking a name-only participant keeps its id and history; partial saves are impossible; the new-traveler overage effect is shown.
