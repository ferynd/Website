# T14 — Conflict Tracker Deep Dive

Status: complete  
Reviewed main: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`; rechecked for final backlog against `89128768467dc8945ec4bd14f37602dcc0421c1f`

## Scope

Reviewed authentication, tracker creation/invitation/claiming, side ownership, conflict CRUD, drafts/submission/reveal, shared editing, resolution, trends, deletion, Firestore rules, and failure/concurrency behavior.

## Strengths

- User side is derived from tracker UID ownership rather than a caller-supplied form value.
- Reflection writes stamp author/system fields in database helpers.
- UI distinguishes draft versus submitted state and checks actual `submittedAt` for the side-by-side reveal.
- Person A/admin controls are applied to shared editing and conflict edit/delete in the UI.
- Error states are generally surfaced during forms and saves.

## Revalidated cross-cutting finding

**F-036 remains high priority:** Firestore rules allow any tracker member to read both reflection documents directly. The UI reveal gate is not a confidentiality boundary.

## Findings

### F-069 — High — Shared section can unlock from drafts

`saveReflectionDraft` sets the same `hasReflectionA/B` flag used by `SharedSection` as its submission gate. The detailed reflection view checks `submittedAt`, but the shared section checks only the flags. Two saved drafts can therefore open shared fields before mutual submission.

**Accept:** reveal/shared state derives from immutable submitted state or trusted aggregate; drafts never satisfy it; emulator/component tests cover all draft/submit combinations.

### F-070 — Medium — Trends are scoped to the selected conflict

The reviewed trends path consumes the active conflict’s reflections rather than a tracker-wide reflection set, so its pattern labels can appear global while representing one conflict.

**Accept:** queries aggregate all authorized tracker conflicts/reflections, state the time/sample scope, and handle deleted/incomplete records deterministically.

### F-071 — High — Email invitation identity is not strongly verified

Pre-claim membership is granted through a token email matching a mutable invited-email array. The general tracker rules do not require a dedicated invitation token, immutable claim transaction, or `email_verified` for membership.

**Accept:** verified identity and one-time transactional claim are required; revocation/race/account-change tests pass; email alone cannot retain access after UID ownership is established.

### F-072 — High — Resolution and shared-state invariants are not rules-enforced

Rules allow a tracker member to update conflict documents broadly. Client helpers limit which side they intend to change, but another client can alter both resolution flags or shared fields. `setResolved` is also a read-then-write rather than a transaction.

**Accept:** rules permit only actor-owned state changes; aggregate status is derived or transactionally maintained; concurrent toggles cannot overwrite the other side.

### F-073 — Medium — Submission is described as locked but remains replaceable

Submitted reflections can be reopened, edited, and re-submitted; the UI explicitly says re-submission replaces them. Product copy and any reliance on immutable submission therefore conflict.

**Accept:** either enforce immutable submission with an explicit retract/version flow, or accurately describe editable submissions and preserve revision/audit history.

### F-074 — Medium — Deletion is a non-atomic client cascade

Reflection documents are deleted sequentially before the conflict document. Failure can leave partial state. Rules permit member deletion more broadly than the Person A/admin UI.

**Accept:** deletion authority is rules-enforced; trusted/batched cleanup is idempotent; interrupted delete and retry tests leave no orphan/private data.

## Implementation direction

Treat Conflict Tracker as one authorization/state-machine initiative, not six isolated UI fixes. AR-03 should establish server/rules-owned identity, submission, reveal, resolution, shared-edit, and delete invariants with emulator personas before privacy claims are restored.
