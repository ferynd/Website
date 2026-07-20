# T12A — Transcriber Post-merge Revalidation

Status: complete  
Reviewed main: `89128768467dc8945ec4bd14f37602dcc0421c1f`  
Relevant merge: PR #152 (`a4bd351`)

PR #152 replaced the earlier speaker and classification pipeline with overlapping chunk handling, deterministic reconciliation, targeted repair, sparse correction, separate classification, content-keyed caches, and stronger regression coverage.

## Finding status

Closed by PR #152:

- F-057 — chunk overlap and seam handling
- F-058 — speaker identity no longer assigned authoritatively from profile order alone
- F-062 — argument export no longer depends on one majority tag after turn merging
- F-063 — reference-clip cache identity now uses content hashes

Still open:

- F-030 — cancellation and operation deadlines
- F-056 — default silence-removal fidelity
- F-059 — non-neutral default run context
- F-060 — whole-file browser memory
- F-061 — automatic repeated-phrase suppression
- F-064 — refresh/tab-loss recovery

## Execution impact

AR-12 covers only the open findings above. Future agents must not recreate the four closed fixes. Reuse and extend the evaluation harness merged in PR #152 for the remaining validation work.
