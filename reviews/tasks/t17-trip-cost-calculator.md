# T17: Trip Cost Calculator Deep Dive

Completed: 2026-07-14  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed authentication, trip discovery and creation, participants, expenses, payments, spend caps, overage allocation, balances, settlement suggestions, audit behavior, Firestore authorization, Trip Planner linking, concurrency, and test coverage.

## Strong design decisions

- Core balance, cap, settlement, and category calculations are separated into pure helpers.
- Expense entry validates payer totals and manual split totals.
- Historical expenses snapshot payer and participant IDs instead of depending on live names alone.
- Spend-cap behavior is documented and isolated from the uncapped balance calculation.
- Trip discovery is scoped by participant UID for nonadministrators.
- The UI distinguishes raw and capped obligations and exposes the pre-cap amount.

## Findings

### F-087: Infeasible spend caps can destroy balance conservation and produce invalid settlement advice

- Status: validated
- Priority: critical
- Category: financial correctness
- Evidence: `applySpendCaps` locks an over-cap participant, discards overage when no eligible recipient remains, and returns balances whose obligations may no longer sum to spending. `calculateSettlements` assumes net-zero balances and classifies the smallest sorted balance as a debtor even when it is positive.
- Impact: the UI can recommend that one creditor pay another creditor while describing the result as optimal settlement advice.
- Recommendation: validate cap feasibility and conservation before returning capped balances; surface unallocated overage; reject settlement generation unless balances sum to approximately zero and debtors are negative while creditors are positive.
- Acceptance criteria: infeasible caps produce an explicit blocking error; obligations conserve the trip total; settlements contain only positive amounts from negative balances to positive balances; adversarial tests cover all-capped and cascading-cap cases.

### F-088: Any participant can record a payment on behalf of any payer and payee

- Status: validated
- Priority: high
- Category: payment authorization
- Evidence: the client accepts arbitrary participant IDs for payer and payee and stores only the caller as `createdBy`; top-level trip updates permit participants to replace the payments array without enforcing payer identity.
- Impact: a participant can falsely record another person's payment and change everyone’s balances.
- Recommendation: bind ordinary payment creation to the authenticated participant, require explicit elevated correction rights for third-party entries, and store immutable actor metadata.

### F-089: Removing a participant leaves orphaned financial references

- Status: validated
- Priority: high
- Category: financial data integrity
- Evidence: participant deletion removes membership, caps, and default split entries but does not rewrite or block expenses/payments referencing that participant. Balance calculation ignores unknown IDs.
- Impact: paid amounts and obligations can silently disappear from totals and settlement results.
- Recommendation: block deletion while references exist, archive participants instead, or transactionally migrate every reference with a reviewed financial reconciliation.

### F-090: Blank payer input can attribute payment to the wrong participant

- Status: validated
- Priority: high
- Category: payer attribution
- Evidence: the default payer is found using `p.userId === userProfile.uid || p.addedBy === userProfile.uid`; the first manually created participant added by the caller may match before the caller's own participant record.
- Impact: a newly entered expense can credit the wrong person for paying.
- Recommendation: default only from a uniquely linked `userId`; otherwise require explicit payer selection and block save.

### F-091: The displayed audit log is not populated by Trip Cost mutations

- Status: validated
- Priority: medium
- Category: auditability
- Evidence: the context subscribes to the audit subcollection for administrators, but participant, expense, payment, and settings mutations never create audit documents.
- Impact: high-stakes financial changes lack the provenance the UI implies exists.
- Recommendation: append immutable audit entries transactionally with every mutation and include before/after summaries and actor identity.

### F-092: Trip Planner’s cost-tracker deep link is not consumed

- Status: validated
- Priority: medium
- Category: cross-tool integration
- Evidence: Trip Planner opens `/tools/trip-cost?tripId=...`; Trip Cost does not parse `tripId` and initializes with no selected trip.
- Impact: the user lands on the trip list instead of the linked tracker, weakening the integration and allowing selection mistakes.
- Recommendation: validate and consume the query parameter after authentication, confirm access, open the target trip, and show a precise unavailable/unauthorized state when needed.

## Revalidated cross-cutting finding

### F-031: Shared financial arrays use nontransactional whole-document rewrites

Participant, expense, and payment operations build complete arrays from the client snapshot and replace the stored array. Concurrent tabs or participants can silently lose one another’s additions, edits, or deletions. Move mutable records to subcollections or use transactions/revision preconditions.

## Test and runtime gaps

High-value missing coverage includes:

- cap conservation and infeasible-cap rejection;
- settlement sign and net-zero invariants;
- participant deletion with existing references;
- actor-bound payment authorization and Firestore emulator tests;
- blank-payer identity resolution;
- simultaneous expense/payment edits;
- audit-event creation and immutability;
- Trip Planner deep-link opening.

## Outcome

Trip Cost has a useful pure calculation foundation, but its settlement output cannot be considered financially authoritative while infeasible caps can violate conservation. Participant lifecycle, payment authorship, and concurrent whole-array writes also require correction before shared use.