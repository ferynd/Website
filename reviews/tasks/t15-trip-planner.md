# T15: Trip Planner Deep Dive

Completed: 2026-07-11  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the Trip Planner’s complete source-level workflow, including:

- authentication, planner selection, creation, ownership, participants, and linked Trip Cost trackers;
- day generation, timeline layout, drag, resize, keyboard movement, snapping, visible-hour clipping, and timezone handling;
- blocks, travel, activities, activity ideas, recurrence creation and series editing;
- real-time Firestore synchronization, participant mutations, audit entries, and failure handling;
- image compression, upload, replacement, deletion, storage paths, and cleanup behavior;
- planner settings, date-range changes, active-day state, admin workflows, and existing unit coverage.

Representative browser, timezone, concurrent-user, Firebase Storage, and deployed-rule tests remain required for runtime thresholds.

## Workflow trace

1. A signed-in user selects or creates a planner.
2. The client subscribes independently to the planner document, events, and activity ideas.
3. Planner dates and stored `dayOrder`/`days` define timeline columns; event records provide fallback day metadata.
4. Users add blocks, travel, activities, or convert ideas through `AddItemModal`.
5. Local date/time form values are converted to ISO strings and written to Firestore.
6. Daily recurrence creates grouped event records. Existing grouped events can be edited or deleted individually or as a series.
7. Drag and keyboard operations update event timestamps using deterministic snapping.
8. Images are compressed and uploaded before the event or idea form is submitted.
9. Every primary mutation is followed by a separate changelog write.
10. Owners/admins can manage participants and link or create Trip Cost trackers.

## Strong design decisions

- Event types are explicit and retain travel/activity-specific metadata.
- Timeline drag work is throttled through `requestAnimationFrame` and has pointer-capture cleanup.
- Keyboard movement exists in addition to pointer movement.
- Event updates strip protected identifiers and normalize paired `start`/`startISO` and `end`/`endISO` fields.
- Series writes use Firestore batches, preventing partial mutation inside the selected event set.
- Planner participants and linked-tool operations have owner/admin checks in the client and corresponding rule restrictions.
- Image compression, normalized names, content hashes, metadata inspection, and old-image compression utilities show deliberate storage-cost management.
- Changelog records actor identity and operation context.
- Existing scheduling tests cover important pure slot-placement behavior.

## Revalidated prior findings

### F-018: Timeline day headers are not aligned with the time axis

The previously recorded finding remains applicable. The layout uses a fixed time sidebar and separate day-column/header structures without a single shared grid contract, producing an offset between day labels and event columns. Runtime screenshots remain useful for exact breakpoint severity, but the structural mismatch is source-validated.

### F-019: Long planner modals can exceed mobile viewports

The Add Item modal remains a fixed centered panel with a long form and no containing `max-height`/scroll region. Image, travel, activity, recurrence, and edit controls can extend beyond smaller viewport heights.

### F-034/F-039: Multi-step mutations and image lifecycle are not atomic

Event/idea writes, planner timestamp updates, changelog writes, and Storage cleanup are separate operations. Image records can outlive deleted or abandoned application records.

### F-037/F-038: Participant/storage authorization requires stronger invariant enforcement

Rules allow all participants to mutate event and idea records, while repository-controlled Storage rules remain incomplete for all planner paths. T15 does not supersede the T09 findings.

## New findings

### F-075: “Apply to all events in this series” can collapse every occurrence onto one absolute time

- Status: validated
- Category: scheduling correctness / recurrence
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: editing a recurring event with “Apply to all events in this series” enabled
- Evidence:
  - the edit form submits the selected occurrence’s absolute `start` and `end` timestamps;
  - `buildEventPatch` converts those timestamps directly to `start`, `startISO`, `end`, and `endISO`;
  - series update queries all records with the same `groupId` and applies the identical payload to every document;
  - no per-occurrence date offset is preserved or recomputed.
- User impact:
  - changing the time, day, or duration of one recurring event for the full series can place all occurrences on the exact same date and time;
  - the itinerary can appear to lose later occurrences because they overlap perfectly;
  - travel/activity metadata can become attached to misleading dates.
- Root cause: series editing treats event timestamps as scalar shared fields rather than occurrence-relative values.
- Recommendation:
  1. classify series-editable fields into shared metadata and temporal fields;
  2. for time-only edits, calculate the selected occurrence’s local time/duration delta and apply it to each occurrence’s own date;
  3. require an explicit recurrence-series operation for date-pattern changes;
  4. preview affected occurrences before commit;
  5. add DST, cross-midnight, mixed-duration, detached-occurrence, and rollback tests.
- Acceptance criteria:
  - a daily series retains one occurrence per intended day after a series time edit;
  - duration and local wall-clock time change consistently in the planner timezone;
  - detached occurrences are not silently reattached;
  - no two occurrences receive identical timestamps unless that is explicitly requested;
  - tests cover spring-forward and fall-back transitions.
- Backlog destination: urgent Trip Planner correctness candidate

### F-076: Form-entered event times are interpreted in the browser timezone, not the planner timezone

- Status: validated
- Category: date/time correctness
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: adding or editing itinerary items when browser timezone differs from planner timezone
- Evidence:
  - `buildIsoFromDateTime` constructs `new Date(`${day.date}T${time}`)` with no offset or timezone conversion;
  - JavaScript interprets that string in the browser’s local timezone;
  - the resulting UTC ISO string is stored while the separate planner timezone label is merely copied into the event;
  - timeline snapping has custom timezone logic, but initial form creation bypasses it.
- User impact:
  - planning a trip in Tokyo from Chicago, for example, can store a 09:00 Tokyo activity as 09:00 Chicago converted to UTC;
  - display, drag behavior, recurrence, ordering, and exported details can shift by many hours or a calendar day;
  - collaborators in different home timezones can create inconsistent timestamps from identical form input.
- Root cause: wall-clock date/time input and timezone identity are stored through separate code paths rather than converted together.
- Recommendation: use one tested zoned-date conversion utility for creation, editing, recurrence, drag, display, and schedule calculations. Reject nonexistent DST times and explicitly resolve ambiguous times.
- Acceptance criteria:
  - entered wall-clock time represents the selected planner timezone regardless of browser timezone;
  - two browsers in different zones generate the same instant for the same planner input;
  - DST gaps/overlaps receive deterministic validation or user choice;
  - existing events migrate or are clearly interpreted without silent shifts;
  - tests run with multiple simulated browser/planner timezone combinations.
- Backlog destination: urgent Trip Planner correctness candidate

### F-077: Active-day state can remain pointed at a day from the previous planner

- Status: validated
- Category: state isolation / workflow correctness
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: switching between planners in one mounted session
- Evidence:
  - the active-day effect resets only when `planner` is null;
  - once `activeDayId` is non-null, the effect returns without checking whether that ID exists in the new planner;
  - planner selection changes the subscribed planner but does not explicitly clear `activeDayId`, edit state, or modal targeting state.
- User impact:
  - day-specific controls can target a stale or missing day;
  - the first day of the new planner may not become active;
  - open edit/add state can carry context across planner boundaries.
- Root cause: route-level planner identity and local selection state do not share a reset boundary.
- Recommendation: key or reset all planner-local interaction state on planner ID changes and validate active selections against the new data set.
- Acceptance criteria:
  - switching planners closes edit/add dialogs and clears selected event/idea state;
  - active day becomes the corresponding valid day or the new planner’s first day;
  - no write after a switch can target the previous planner/day implicitly;
  - a component test covers switching between planners with disjoint date ranges.
- Backlog destination: Trip Planner state-management candidate

### F-078: Image uploads can be orphaned before an event or idea is saved

- Status: validated
- Category: storage lifecycle / cost / privacy
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: Add Item image workflow
- Evidence:
  - files are compressed and uploaded immediately when selected;
  - download URLs are appended only to local form state;
  - closing/cancelling the modal does not delete newly uploaded objects;
  - failed event submission does not roll back uploads;
  - replacing/removing URLs from an existing record does not reliably delete detached objects.
- User impact: abandoned private travel images remain in Storage, consume quota, and may remain accessible through retained download URLs despite never appearing in a saved itinerary.
- Root cause: uploads are committed independently of the owning document and no staging/finalization protocol exists.
- Recommendation: stage uploads under a session token, finalize ownership only after document commit, and delete abandoned/replaced assets through explicit cleanup or a scheduled retention job.
- Acceptance criteria:
  - cancelling or failing a form removes newly staged images;
  - removing an image from a record removes the object when no other record references it;
  - deletion is retry-idempotent and reconciled by periodic orphan cleanup;
  - ownership metadata supports audit and retention enforcement.
- Backlog destination: shared storage-lifecycle candidate linked to F-039

### F-079: Participant management uses stale whole-array rewrites and can lose concurrent changes

- Status: validated
- Category: data integrity / concurrency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: participant add, rename, and removal
- Evidence:
  - participant mutations derive a full replacement `participants` array from the current client snapshot;
  - separate participant UID operations are written in the same update, but the object array is not transactionally compared;
  - two owner/admin sessions can compute from the same stale array and overwrite each other;
  - audit writes occur afterward and cannot restore the lost participant state.
- User impact: simultaneous invites, renames, or removals can disappear or restore deleted participants, creating access-list mismatch between `participants` and `participantUids`.
- Root cause: mutable membership is embedded in a shared array rather than transactionally updated or represented as actor-addressable documents/map keys.
- Recommendation: use a transaction with invariant checks or move participants into keyed subdocuments/maps with field-level rules and atomic actor-specific operations.
- Acceptance criteria:
  - concurrent participant additions both persist;
  - rename and removal conflicts resolve predictably;
  - `participants`, `participantUids`, owner identity, and linked permissions cannot diverge;
  - emulator concurrency and authorization tests cover every membership transition.
- Backlog destination: Trip Planner data-integrity candidate linked to F-037

## Additional observations

- Planner date-range updates do not visibly reconcile events outside the new range or regenerate stored day structures in the reviewed context path. This should be exercised during live validation before assigning a separate defect.
- Mutation and changelog writes are not atomic. A primary change may succeed and its audit append fail, causing incomplete audit history or a surfaced error after the user-visible mutation already occurred.
- Series Firestore batches remain subject to the platform’s batch-size ceiling; large recurrence groups need bounded behavior.
- The timeline uses local `Date` setters in several calculations while also implementing explicit timezone snapping. Consolidating all temporal operations would reduce inconsistent DST behavior.
- Storage compression is useful, but content type, object size, ownership, and planner membership must also be enforced server-side.

## Testing assessment

Existing scheduling tests provide a good base for idea-slot placement. Missing high-value coverage includes:

- browser timezone versus planner timezone creation/editing;
- DST boundaries and ambiguous/nonexistent local times;
- recurring-series edit/delete behavior;
- planner switch state isolation;
- drag/resize across visible boundaries and days;
- concurrent participant and event edits;
- owner/member/admin rule matrices;
- upload cancellation, failed-save rollback, replacement, record deletion, and orphan cleanup;
- linked Trip Cost creation/link failure and partial-state recovery;
- mobile modal and horizontal timeline behavior.

## Runtime validation still required

- Verify header/column offsets and drag geometry at representative desktop/mobile widths.
- Create identical events from browsers configured in Chicago, UTC, and the destination timezone.
- Test recurring edits across a DST transition in the selected planner timezone.
- Test two simultaneous editors moving the same event and changing participants.
- Inspect Firebase Storage after cancel, failed save, image replacement, idea deletion, event deletion, and planner deletion.
- Verify the deployed Storage rules and Cloudflare/Firebase request limits.

## Overall assessment

The Trip Planner has a relatively sophisticated timeline and a stronger interaction model than a basic itinerary CRUD tool. Its primary risk is temporal correctness: timezone identity, recurrence semantics, and local browser `Date` behavior are not unified. The second major risk is distributed state consistency across Firestore documents, arrays, audit records, and Storage objects. F-075 and F-076 should be fixed before relying on the planner for time-critical travel reservations.