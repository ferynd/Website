# Shared nutrition research pipeline (#62)

[Overview](README.md) · [Workflow](workflow.md) · [Assistant contract](assistant-contracts.md#research-request-v1) · [Population playbook](population-playbook.md)

This implementation prepares and reviews ingredient profiles locally. It does not populate or publish the catalog, enable ingredient writes, or add a tracker/recipe research screen. Those consumers remain #63/#66/#69/#70. The optional paid transport is #71; no provider route or paid API transport is implemented here.

## Modules and execution boundaries

Shared ESM modules and their TypeScript declarations are in [the research directory](../../public/shared/nutrition/research/). Both tools and the operator CLI use these modules directly, with no generated copy.

| Module (.js and .d.ts) | Origin and responsibility |
| --- | --- |
| fdcNutrientMap | Kept from the paused implementation: FDC ID/definition map; mappings remain provisional until a real release is pinned under Part B. |
| fdcFood | Reshaped: shared bulk/API parser, strict numeric input, source checksums, LOQ and household weights. |
| sourceResult | Reshaped: registry normalization, explicit unknowns, source metadata, serving-basis checks, units and LOQ across all nutrient paths; manual/label observations are normalized too. FDC observations remain per 100 g even if a serving size is listed. |
| researchJob | Reshaped: stable keys/IDs, transitions, issued request histories and awaiting_response. |
| researchValidator | Reshaped: #61 revision/hash/conversion validation, stored-field coverage, sources, zero evidence, estimates, identity/state conflicts, additives and diagnostics. |
| researchReview | Reshaped: diffs, checklist, hash-bound approval, source verification and private attestation. Corrections require another pass. |
| manualAdapters | Reshaped: manual source/status inputs and labels with rounding intervals; inline inputs without recordId use canonical content hashes for cache identity. Labels require explicit positive gram serving sizes with gram units or originalBasis: per_100g_edible; missing bases are rejected, and non-gram servings remain non-convertible gaps. |
| memoryResearchStore | Reshaped: in-memory CAS plus atomic packet-group saves and source cache. |
| stagedCatalog | Reshaped: reviewed/hash-validated curated records pass through #61 buildCatalogShards; private data and duplicate variant records are refused. |
| researchService | Reshaped: adapter orchestration, source cache/retry checkpoints, packet issue/accept/cancel/expiry, source attestation/refetch, review. |
| researchPorts | Reshaped declaration-only adapter/store interfaces, including two-phase transport and atomic group saves. |
| profileFields | New: stored-field allowlist; excludes fiberWeightedLegacy from coverage and star requests. |
| researchPacket | New: request v1 builder, canonical body/digest, deterministic chunking, copyable instructions plus JSON, strict response v1 validation. |
| assistantPacketAdapter | New: manual copy/paste prepareRequest/acceptResponse transport, available in browser and CLI. |
| packetProposal | New: accepted responses become #61 revision/conversion drafts with assistant evidence retained separately and initially unverified. |
| indexedDbResearchStore | New: owner-scoped local research outbox, transactional CAS/group saves, bounded clearing and stale-handle invalidation. |
| curatedAdapter | New: exact confirmed catalog variant reuse; no external research for a resolved profile. |

The CLI-only TypeScript modules in [scripts/nutrition](../../scripts/nutrition/) are new: researchConfig, manifestReader, matchTable, fdcBulkReader, fdcApiAdapter, fileResearchStore, coverageReport and researchCli. They handle filesystem/configuration/credentials outside browser code. The match table ships with no entries. The manifest reader validates the 1,114 queued identities and refuses nutrient values. It uses [variantVocabulary](../../public/shared/nutrition/variantVocabulary.js), as do packet targets; there is no second state vocabulary.

Synthetic source fixtures and the inherited research tests were retained and corrected for the merged contracts and #61 APIs. Added tests cover packets, IndexedDB, CLI/app parity, pins, operator adapter behavior and file-store persistence.

## Job schema and lifecycle

A schemaVersion 1 job contains jobId/jobKey, scope/ownerUid, target, requestedFields, parentBatchId/passId, state/version, attempts/checkpoints, match, sourceEvidence, proposal/validation/review, request history and pendingRequest. Compare-and-swap uses version. Packet groups save atomically; validation occurs before any result is staged.

Catalog job keys contain manifest ID; private keys contain namespace, owner and stable identity/variant IDs. Both include sorted requested fields and source release. Public manifest insertion is never required for private input. A parent batch is source-independent; each issued packet records its random requestId, digest and one pass ID in the job store. The pass ID is absent from the packet itself.

States are queued → awaiting_response → needs_review for packets; queued → matched → needs_review for deterministic lookup. Exact curated reuse stays matched with its existing revision. Approved/imported jobs and matched proposals are never fetched again. Blocked jobs record actionable needs. retryJob explicitly returns a blocked job to queued, clearing its old blocked reason, match, proposal, validation, review, checkpoints, pending request, source evidence and attempt budget so corrected evidence can be matched again. Rejecting a proposal also clears the old match and proposal before the next pass. Expiry/cancel returns awaiting_response jobs to queued; runJob resumes a pending request without fetching, or expires its group when its deadline passes. Reissuing generates a fresh request ID. Already answered, cancelled and expired responses cannot be applied.

The service exposes enqueue, retryJob, runJob/runBatch, prepareRequest, acceptResponse, cancelRequest, attestSource, verifySource, review and report. There is no ingredient-store write call. An approved private job exposes proposal.revisionDraft for a future #61 store caller; INGREDIENT_STORE_WRITES_ENABLED remains false.

## Packet contract and review

Packets contain ingredient identity/forms, requested fields/units, known observations and attempted sources. Meal composition is never selected into a packet. Label evidence is omitted by default; includeLabelEvidence must be explicitly selected, and only text label fields are accepted. Consumers must preview copyableResearchPacket verbatim before copying; the future UI owns that preview.

The canonical body omits requestId, requestDigest and createdAt, sorts targets by targetId and object keys recursively, and preserves other array order. The SHA-256 digest therefore matches between app and CLI; issue IDs use 96 cryptographically random bits. The service partitions jobs by parentBatchId before issuing packets, including CLI packet calls without --batch; each pass ID uses that packet’s own parent batch. Within each batch, mixed sets emit all-field groups first (8 by default), then field-limited groups (25); targets requesting more than 10 fields count as all-field. Byte limits can split groups further or reject an oversized target. Defaults are 200,000 UTF-8 bytes per request, 1,000,000 per response and a seven-day lifetime. PACKET_LIMITS is configurable.

acceptResponse accepts strict JSON only. It validates echoes, pending state, expiry, registry version, profile reference, requested targets/fields, observations, statuses, provenance, units, bounds, URLs and numeric types before building drafts. Known observations preserve value (including null), status, qualifier, roundingInterval and upperBound after unit normalization; null is never numerically converted. Store CAS prevents concurrent response replay. Consumers maintaining current library heads should pass currentRefs, keyed by job ID, to acceptResponse; a changed head then rejects a response even if the job record itself has not yet refreshed. Field-limited revision updates supply target.baseRevision and baseRef so unchanged stored observations and provenance are preserved.

Assistant source verification starts unverified. verifySource compares cited FDC values and every cited conversion against an injected deterministic FDC adapter. Conversion weights must match normalized grams per unit and state; missing, differently weighted, ambiguously weighted or unexpressed qualified portions cannot be verified. A mismatch leaves the source unverified, including after an earlier successful verification. Successful refetch copies the adapter’s source metadata and known license into the draft and its conversions, recalculates the draft hash/conversion IDs and refreshes validation; approval must use the refreshed hash. Atwater energy from nutrients 2047/2048 retains calculated status and derivation. attestSource records a reviewer for one particular source. Curated approval and staging require every cited source verified and resolved permittedUse metadata. The assistant placeholder review_required blocks curated validation even after reviewer source attestation; deterministic refetch can resolve it from the adapter’s license. Private approval may instead include reviewer attestation and retains the assistant-researched label. Estimated values retain comparator, transfer reason, derivation and range. Review is tied to the draft content hash and requires all warnings acknowledged.

## Browser persistence and auth

IndexedDB nutrition-research-jobs-v1 holds one owner's jobs and requests. Same-owner reload resumes pending packets. Opening for another owner clears the database; failure disables access. Sign-out and owner changes clear it through the tracker ingredientSession and Recipe Standardizer auth paths, including explicit sign-out. Clearing invalidates open handles before deletion, with a bounded wait for blocked deletion. No Firebase collection or security rule is added.

Only the research modules imported by tracker auth are added to APP_SHELL; the cache name is nutritrack-v5. Future research UI consumers must register any additional loaded modules when they ship.

## CLI use and safety

Run from the repository root with vite-node (already installed):

```sh
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --max 5 --fields protein,iodine
npx --no-install vite-node scripts/nutrition/researchCli.ts -- coverage
```

These commands are dry runs. To persist a local research outbox, explicitly use --write with --store pointing outside public. For example:

```sh
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --max 5 --fields protein,iodine --write --store /tmp/nutrition-research
npx --no-install vite-node scripts/nutrition/researchCli.ts -- packet --write --store /tmp/nutrition-research
```

packet prints the request and copyable block. Save the assistant's response as a local JSON file, then use import-packet with --input and the same --store; first omit --write to validate without changing the pending jobs. Add --write only to persist the accepted results. review with --job shows a review packet; --verify-source plus --reviewer attests to one source. --decide approve requires --hash, --reviewer and --ack for each warning (separated with a vertical bar); private review may use --attest. Corrected values go through a new manual pass. For blocked jobs, retry --job <id> --store <path> previews a queued reset; add --write to persist it, then run or issue a packet again. Retry requires an explicitly selected blocked job and does not fetch sources.

Other commands are index (--dataset/--file), run (--source fdc-bulk, fdc-api, manual or label; manual/label also use --input), validate, stage (--out) and suggest (--manifest-id, optionally --dataset/--file). --batch or --job limits an existing job selection. stage only writes with --write and outside public. Staging rejects multiple approved passes for the same variant; select one reviewed pass so each variant has one record and profileCount counts unique variants. Suggestion output never edits the reviewed match table. Coverage reports exclude private jobs.

Every command defaults to dry run. --write requires --store. The file store/source cache use atomic local writes, locks, checksums and CAS. Locks are never stolen automatically by age; after a crash, inspect the recorded PID and remove an abandoned lock explicitly before retrying. Paths resolving through symlinks into public are refused. A malformed cache or store is an error, never an empty successful import. The bulk reader requires a matching SHA-256 pin and currently permits only explicitly labeled synthetic fixtures. Production pins are deliberately absent.

There is no network without --live. fdc-api without --live exits nonzero. Its operator-only adapter reads process.env.FDC_API_KEY only after the live gate, sends it in X-Api-Key, and redacts transport/error details. Tests inject fetch and use synthetic keys; no live calls are part of verification. Bulk/manual/label/packet commands need no key. Live credentials and access are dependencies of [#62 Part B](../../backlogs/calorie-tracker.md#62-part-b-pin-live-sources-and-publish-staged-curated-data), requiring James's explicit approval. Publishing catalog shards and #63 population remain separately approval-gated.

## Validation boundaries

Automated coverage includes malformed sources, unknown/LOQ, concentrated additives, state conflicts, retry/idempotency, packet round trips/rejections/chunk bounds, CLI/app canonical equality, pending resume, owner changes/sign-out, fixture pins, redacted operator transport and file CAS/locks. No live FDC ID mapping, source license, production auth, deployment or catalog population is claimed by these tests. The curated manifest remains at zero profiles and both write flags remain false.

## File-level test and integration handoff

The module table above covers each implementation file and its matching declaration. The remaining file changes are listed here; paths below are relative to the linked directories.

| Directory | Files | Treatment |
| --- | --- | --- |
| [Tracker nutrition tests](../../public/tools/CalorieTracker/nutrition/) | researchFdcMap.test.js, researchFdcFood.test.js, researchNormalize.test.js, researchValidator.test.js, researchReview.test.js, researchService.test.js, researchManualLabel.test.js, researchStaged.test.js | Retained and reshaped for current #61 APIs, synthetic IDs, stored-field coverage and normalization regressions. |
| Same directory | researchPacket.test.js, researchPacketFixtures.js, researchIndexedDb.test.js, researchCurated.test.js | New packet/lifecycle/provenance/verification, owner storage and catalog-reuse coverage. |
| [CLI tests](../../scripts/nutrition/) | researchPipeline.test.ts, researchCli.test.ts, fdcApiAdapter.test.ts | New manifest/pins/filesystem/CAS/cache/CLI parity/dry-run and injected transport tests. |
| [Synthetic fixtures](../../scripts/fixtures/nutrition/) | manifest-mini.json, match-table-mini.json | Reshaped to actual enums/match schema with explicit synthetic labels. |
| [FDC fixtures](../../scripts/fixtures/nutrition/fdc/) | apple-api.json, apple-bulk.json, legume-bulk.json, oil-bulk.json, salt-additive-bulk.json, loq-food.json, mismatch-vitamins.json, malformed-duplicate-nutrient.json, malformed-missing-id.json, malformed-string-amount.json | Retained and labeled synthetic; fixture IDs changed to 990000x to avoid confusion with live records. |
| [Tracker](../../public/tools/CalorieTracker/) | main.js, services/ingredientSession.js, services/ingredientSession.test.js | Research clearing on auth changes and explicit sign-out, with cleanup-failure coverage. |
| Same directory | sw.js, sw.test.js, package.json | Register loaded shared dependencies/cache v5 and every new tracker test. |
| [Shared nutrition](../../public/shared/nutrition/) | capabilities.js, capabilities.d.ts | Cache-name synchronization only; write gates remain false. |
| [Recipe Standardizer](../../app/tools/recipe-standardizer/) | RecipeContext.tsx, __tests__/recipeAuth.test.ts, __tests__/ingredientModulesParity.test.ts | Research cleanup mirrors profile cleanup, including same-owner reload and failed cleanup. |
| [Match table](source-match-table.json) | source-match-table.json | New empty reviewed-match table. |
| Repository documentation | README.md, ARCHITECTURE.md, SECURITY.md, backlogs/calorie-tracker.md | Update current architecture/security, entry point and pending status; no completion/merge claim. |
| [Nutrition documentation](README.md) | README.md, workflow.md, population-playbook.md, research-pipeline.md | Updated pointers and new implementation/runbook/handoff. |

Verification at PR time: tracker **963 tests**, root **1,999 tests**, API contract suite **43 tests**; lint, build, ci:contract, ci:docs, unchanged Firestore rules/indexes, zero-profile curated manifest, and diff checks pass. No live research, Firebase production work, catalog population, or deployment was performed.

