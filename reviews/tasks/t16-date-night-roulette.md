# T16: Date Night Roulette Deep Dive

Completed: 2026-07-14  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete current merged implementation, including:

- authentication and participant gating;
- shared couple and participant configuration;
- date and modifier CRUD plus CSV batch import;
- rarity selection, cooldown eligibility, decay weighting, modifier stacking, and distinct selection;
- animated wheel behavior and acceptance/veto workflow;
- pending-date review, review completion, photos, cancellation, and archive behavior;
- history, score summaries, streaks, veto/dormancy statistics, and record deletion;
- Firestore and Storage authorization;
- concurrency, multi-document consistency, retention, accessibility, and unit-test coverage.

## Current workflow trace

1. Any authenticated Firebase user passes the page-level auth gate.
2. On sign-in, the client attempts to create shared Date Night couple/settings defaults if they do not exist.
3. The client opens real-time listeners for the shared couple, settings, date ideas, modifiers, and rolls collections.
4. A spin first selects a rarity, then a weighted eligible date within the resolved rarity.
5. Optional modifier count and distinct modifiers are selected using configured stacking and rarity weights.
6. Vetoing increments veto counters immediately and starts another spin.
7. Accepting increments accepted/picked counters and cooldown timestamps, then creates a pending-review roll.
8. The pending card exposes both named review slots to every participant, supports photo uploads, and marks the roll completed after both slots exist.
9. Starting another spin while a pending roll exists can archive the pending roll without review.
10. History and statistics are derived from roll documents plus current date/modifier counters.

## Strong design decisions

- Pure rarity, weighted-choice, decay, frequency, and stacking functions are separated from UI code.
- Random selection accepts injectable RNG functions and has deterministic unit tests.
- Frequency cooldown can be explicitly overridden rather than silently ignored.
- Modifier selections are deduplicated within a spin.
- Pool-item counter updates use Firestore atomic increments rather than client-side read/replace writes.
- Pool-item creation clamps base weight to a defined range.
- CSV parsing supports quoted values and escaped double quotes.
- Batch import validates required columns, enum values, numbers, and duplicates before writes.
- Roll history snapshots selected item names and rarities, so deleting a pool item does not erase the basic historical label.
- Images are compressed and stored with content metadata before their URLs are recorded.
- Storage access is limited to the site administrator or configured Date Night participants in the repository rules file.
- The roller blocks an ordinary new spin while a pending review exists and requires an explicit archive confirmation.

## Findings

### F-080: Review slots are not bound to participant identity

- Status: validated
- Category: collaboration integrity / authorship
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: pending-date reviews and completed history
- Evidence:
  - the pending card renders editable controls for both review slots to every participant;
  - `upsertReview` accepts a caller-selected `a` or `b` slot and does not derive the slot from `user.uid`;
  - review slot names are assigned from the first two entries in `participantUids`, not from an ownership map stored on each review;
  - Firestore rules permit any Date Night participant to update the entire roll document;
  - there is no `authorUid` in `DateNightReview` and no rule that protects one participant's review key from another participant.
- User impact:
  - either participant can create, edit, or replace either person's review;
  - one participant can complete both review slots and mark the date completed without the other person's participation;
  - displayed review attribution is conventional rather than authoritative;
  - participant ordering changes can relabel historical slot A/B content.
- Root cause: reviews are modeled as anonymous fixed slots inside a shared document instead of actor-owned records or UID-keyed map entries.
- Recommendation:
  1. Store reviews keyed by participant UID, including immutable `authorUid`.
  2. Derive the writable key exclusively from the authenticated user.
  3. Enforce per-key ownership in Firestore rules, or use per-user review subdocuments.
  4. Define completion using the required participant UID set rather than existence of `a` and `b`.
  5. Migrate existing slot reviews with an explicit participant mapping and preserve uncertainty where authorship cannot be established.
- Acceptance criteria:
  - a participant can write only their own review;
  - a participant cannot overwrite or submit another participant's review through the SDK or REST API;
  - completion requires distinct required participants;
  - changing participant display order does not change historical authorship;
  - emulator tests cover own-write, cross-write, and completion cases.
- Backlog destination: urgent Date Night collaboration-integrity candidate

### F-081: Roll creation and counter updates are not atomic or retry-idempotent

- Status: validated
- Category: data integrity / concurrency
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: accept and veto workflows
- Evidence:
  - accepting sequentially increments the date, then each modifier, then creates the roll document;
  - vetoing sequentially increments the date and then each modifier;
  - no transaction, batch, operation ID, or idempotency record connects these writes;
  - a retry after a timeout can repeat increments even if an earlier write actually succeeded;
  - an intermediate failure can leave only some counters updated and no corresponding roll.
- User impact:
  - acceptance, veto, cooldown, and dormancy statistics can diverge from actual roll history;
  - partial failures can make some modifiers appear accepted/vetoed more often than the associated date;
  - retrying an ambiguous failure can double-count a decision;
  - cooldowns can activate even when the accepted roll was never created.
- Root cause: one logical decision is represented by multiple independent client writes.
- Recommendation: write the roll and all counter mutations through one trusted transactional operation, with a client-generated decision ID that makes retries idempotent. A server function or Firestore transaction over roll plus item documents is preferable.
- Acceptance criteria:
  - acceptance or veto is committed wholly or not at all;
  - repeating the same decision ID does not change counters twice;
  - failure injection after each internal step leaves no partial state;
  - counters can be reconciled against immutable decision history;
  - concurrent decisions produce mathematically correct totals.
- Backlog destination: Date Night data-integrity candidate

### F-082: Concurrent acceptance can create multiple pending rolls while the UI models only one

- Status: validated source defect; occurrence frequency requires multi-client validation
- Category: workflow state / concurrency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: accepted-roll singleton and pending card
- Evidence:
  - `acceptCandidate` creates a new pending roll without checking or transactionally reserving a singleton pending state;
  - `pendingRoll` is derived with `find` from rolls ordered by creation time and exposes only one matching document;
  - two clients can accept candidates before either observes the other's new roll;
  - archive-before-spin operates only on the currently selected pending roll.
- User impact:
  - multiple accepted dates can remain pending simultaneously even though the primary UI presents one pinned pending card;
  - an older pending roll can be effectively hidden until the newer one changes status;
  - reviews, cancellation, and spin-blocking behavior become inconsistent.
- Root cause: “one pending date” is a UI assumption, not a database invariant.
- Recommendation: either model and display a real queue of pending dates or enforce a single pending roll transactionally through a canonical pending pointer/state document.
- Acceptance criteria:
  - simultaneous accepts have a deterministic result;
  - the database cannot contain hidden pending state if singleton behavior is chosen;
  - all pending rolls are visible and actionable if queue behavior is chosen;
  - emulator/integration tests cover two concurrent clients.
- Backlog destination: Date Night workflow candidate

### F-083: The displayed accept rate is not an acceptance rate

- Status: validated
- Category: analytics correctness
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: History and Stats KPI
- Evidence:
  - veto attempts are represented only by pool-item counters and are never stored as roll records;
  - every roll document represents an accepted candidate;
  - the displayed `acceptRate` is `completedRolls / allRolls`;
  - archived-no-review accepted rolls reduce the KPI, while vetoes do not enter its denominator.
- User impact: the label implies the percentage of offered candidates that were accepted, but the value is actually closer to accepted-roll review-completion rate.
- Root cause: the analytical label and denominator do not match the persisted event model.
- Recommendation: rename the current KPI to a precise completion metric, and add an actual acceptance rate only after immutable accepted/vetoed decision events are persisted.
- Acceptance criteria:
  - every KPI documents its numerator and denominator;
  - “accept rate” includes accepted and vetoed candidate decisions;
  - archived and pending rolls are classified intentionally;
  - fixtures demonstrate expected values for mixed accepted, vetoed, pending, archived, and completed histories.
- Backlog destination: Date Night analytics candidate

### F-084: The page authenticates users but does not gate or explain Date Night participation

- Status: validated
- Category: authorization UX / resilience
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: page entry, initial data load, and nonparticipant experience
- Evidence:
  - `DateNightAuthGate` renders the full tool for any signed-in user;
  - all shared listeners are opened whenever `user` is non-null;
  - listener error callbacks are not supplied;
  - most mutating actions rely on Firestore rules rather than a consistent client participant guard;
  - `ensureDateNightDefaults` is invoked without awaiting or surfacing failures.
- User impact:
  - a valid site account that is not a Date Night participant can enter the tool but receive empty, stalled, or permission-denied behavior without an explanation;
  - initialization/listener failures can look like a legitimate empty pool;
  - support and incident diagnosis become harder because permission errors are discarded.
- Root cause: authentication and participation are treated as equivalent in the page shell, while authorization is deferred to backend rules.
- Recommendation: resolve the shared couple membership first, render an explicit no-access state for nonparticipants, and surface listener/default-initialization errors distinctly from empty data.
- Acceptance criteria:
  - authenticated nonparticipants see a stable access-denied/invitation-needed state;
  - no protected collection listeners start until membership is established where technically feasible;
  - permission and network failures are visible and logged distinctly;
  - controls are not rendered as usable when writes will be rejected.
- Backlog destination: Date Night access/resilience candidate

### F-085: Participant administration can lose concurrent updates

- Status: validated
- Category: data integrity / administration
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `saveParticipant` and shared couple document
- Evidence:
  - `saveParticipant` builds `participantUids` and `displayNames` from the current client snapshot;
  - it writes the complete merged arrays/maps with `setDoc(..., { merge: true })`;
  - concurrent administrators/tabs can each base writes on stale copies and overwrite another participant addition or display-name change;
  - UID and display name inputs are not rejected when blank before write.
- User impact: simultaneous or stale participant edits can silently remove or revert membership metadata, affecting access and review attribution.
- Root cause: shared membership is updated through client-side read/modify/write rather than actor-scoped atomic fields or transactions.
- Recommendation: use a transaction or UID-keyed membership map with atomic per-key updates, validate nonempty UID/name, and preserve a membership audit trail.
- Acceptance criteria:
  - two concurrent additions both survive;
  - updating one display name cannot revert another;
  - blank identifiers cannot be written;
  - membership changes are emulator-tested and auditable.
- Backlog destination: Date Night administration candidate

### F-086: Roll archival and deletion do not reconcile cooldown or aggregate counters

- Status: validated; desired product semantics need confirmation
- Category: lifecycle consistency / analytics
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: cancel spin, archive-before-new-spin, and delete-record actions
- Evidence:
  - acceptance immediately increments `timesPicked`, `timesAccepted`, and `lastAcceptedAt` before a pending roll is reviewed or completed;
  - archiving a pending roll changes only the roll status;
  - deleting a roll deletes only the roll document;
  - item cooldown and aggregate counters remain unchanged after either action;
  - photos also remain in Storage after roll deletion, as already captured by F-039.
- User impact:
  - a date archived because it was not actually completed can remain on cooldown and count as accepted;
  - deleting erroneous/test history does not repair pool statistics;
  - current aggregate counters cannot reliably be reconstructed from remaining roll documents.
- Root cause: mutable aggregate counters are maintained separately from roll lifecycle state without a defined reconciliation policy.
- Recommendation: define whether acceptance, completion, archival, and deletion are distinct immutable events. Prefer deriving analytics/cooldowns from event history or transactionally maintaining reversible aggregates with explicit reason codes. Avoid destructive history deletion for ordinary correction.
- Acceptance criteria:
  - product semantics for accepted-but-not-completed dates are documented;
  - archive/delete behavior produces intentional, tested counter and cooldown results;
  - aggregate values can be reconciled from canonical history;
  - test/reset records can be corrected without silently corrupting analytics.
- Backlog destination: Date Night lifecycle/analytics candidate

## Revalidated cross-cutting findings

- F-019: the long Date Night management and pending-review surfaces require live narrow-viewport validation.
- F-023/F-024/F-026: modal semantics, custom selection state, and asynchronous feedback remain incomplete.
- F-032: real-time listener failures are not surfaced and can resemble empty state.
- F-034: multi-document operations can leave partial, non-idempotent state.
- F-037: Firestore rules do not enforce actor-specific field ownership on shared documents.
- F-038/F-043: Storage/Firestore authorization requires deployed-rule confirmation and executable emulator coverage.
- F-039: deleting a roll does not delete its uploaded photos.

## Test assessment

Existing tests cover:

- rarity fallback when a tier is empty;
- push-rare weight selection;
- frequency override;
- cooldown and decay math;
- modifier stacking and distinct selection.

Missing high-value coverage includes:

- Firestore rules and review-slot ownership;
- acceptance/veto transactional consistency and retries;
- simultaneous acceptance from two clients;
- pending-roll singleton/queue behavior;
- archive/delete counter semantics;
- nonparticipant entry and listener failures;
- participant update concurrency;
- history KPI calculations;
- photo upload failure and cleanup;
- complete authenticated browser workflow.

## Runtime validation still required

- Two-browser simultaneous accept/veto/review scenarios.
- Deployed Firestore and Storage rules compared with repository rules.
- Nonparticipant account behavior and error presentation.
- Mid-operation network interruption and retry behavior.
- Mobile pending-review, history, and management layouts.
- Storage cleanup after canceled upload, roll deletion, and archive.

## Conclusion

The weighted selection core is reasonably modular and testable. The reliability boundary is the collaborative persistence layer: reviews are not authoritatively attributed, logical decisions span independent writes, and a singleton pending state is not enforced. Date Night should not be treated as authoritative shared history until review ownership and decision atomicity are fixed.
