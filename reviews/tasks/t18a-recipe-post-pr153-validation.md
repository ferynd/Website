# T18A — Recipe Standardizer Revalidation after PR #153

Status: complete  
Reviewed main: `89128768467dc8945ec4bd14f37602dcc0421c1f`  
Relevant merge: PR #153 (`8912876`)

PR #153 moved Recipe Standardizer to schema v2 with named prep groups/results, a typed timeline, explicit v1 compatibility, exact prompt shape, and structural chronology/cycle validation.

## Finding status

Closed by PR #153:

- **F-094:** the conversion prompt now requires the exact supported shape and no extra fields; schema versions have explicit compatibility behavior.
- **F-095:** workflow references, chronology, dependencies, cycles, and timeline contradictions are structurally validated with focused tests.

Still open:

- **F-093:** baked scaling can retain an unscalable secondary equivalent without a persisted warning/review state.
- **F-096:** whole-recipe updates remain last-write-wins across tabs without revision conflict detection.
- **F-097:** exact-name food matching still looks confirmed and confirmed links lack robust target lifecycle/revision validation.

## Execution impact

- Do not recreate F-094/F-095 work.
- Recipe phases P1/P3 should close F-097 and the linked provenance finding F-143.
- P5 or AR-16 should close F-093/F-096 and reconcile the namespace migration finding F-141.
- The active Recipe backlog has been updated to treat schema v2/PR #153 as the implementation baseline.
