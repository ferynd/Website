# Catalog integrity verification (#63 V4)

Run: 2026-11-10. Branch `claude/calorie-tracker-63-v4-integrity` from `main` at `f03d706` (PR #216, the A1 import). Authority: James's 2026-11-10 rollout decisions (V4: batches only add; reruns are idempotent; duplicates are prevented; each batch is reconciled against previously imported IDs; no profile, version, or search result is dropped). Issue #215 ANSWER Q-003 and ANSWER Q-006 both require this suite before batch A2.

This document holds **aggregate counts and published catalog ids only**. It records no nutrient value. The run only read files and printed to stdout. The shipped catalog, the [match table](source-match-table.json), and the [A1 import report](population-batch-a1-import.md) are byte-identical to `f03d706`. Both write flags stay false. There was no live call, no API key, and no Firestore access.

Related: [A1 import report](population-batch-a1-import.md) · [normalization verification (V3)](normalization-verification.md) · [research pipeline](research-pipeline.md) · [population playbook](population-playbook.md)

## Contents

1. [Why V4](#why-v4)
2. [The suite](#the-suite)
3. [Append-only and merge semantics](#append-only-and-merge-semantics)
4. [Shipped catalog results](#shipped-catalog-results)
5. [In-repo tests](#in-repo-tests)
6. [Rule for A2 and later batches](#rule-for-a2-and-later-batches)
7. [Re-run](#re-run)

## Why V4

[`stageCatalog`](../../public/shared/nutrition/research/stagedCatalog.js) builds shards only from the jobs it is given, and `researchCli stage --write` refuses a non-empty `--out`. If a second batch were staged on its own and published, the catalog would hold only that batch. Before this change there was no cumulative merge and no check that a new batch keeps the profiles, revisions, and search entries already published. V4 adds that layer next to `stageCatalog`. `stageCatalog` still works per batch and is unchanged.

## The suite

[catalogIntegrity.ts](../../scripts/nutrition/catalogIntegrity.ts) is pure and value-free. Each defect is a string of the form `<code>:<catalog id or shard key>`.

`verifyCatalog({ manifest, files })` returns `{ profileCount, variantShardCount, searchShardCount, searchEntryCount, revisionCount, variantIds, defects }`. It applies these checks:

| Code | Check |
| --- | --- |
| `manifest_schema` | schemaVersion 1, catalogId `nutrition-curated`, a non-negative integer profileCount, and both shard maps present |
| `profile_count_mismatch` | manifest profileCount equals the number of distinct variantIds across variant shards |
| `shard_path_invalid` | the shard path matches the catalog reader's pattern `^(search\|variants)/[a-z0-9_-]+\.[a-f0-9]{64}\.json$`, in the right directory and bucket |
| `shard_missing` | every manifest shard file is present |
| `shard_shape_invalid` | each shard is an array |
| `shard_hash_mismatch` | `contentHashOf(shard)` equals the manifest contentHash |
| `shard_filename_hash_mismatch` | the hash segment of the filename equals the manifest contentHash |
| `orphan_file` | no file is left unreferenced by the manifest |
| `record_shape_invalid` | each variant record has `variant.variantId` |
| `duplicate_variant` | no variantId appears twice in any variant shard |
| `variant_bucket_mismatch` | each record sits in the bucket `buildCatalogShards` assigns |
| `head_revision_missing` / `head_revision_mismatch` | the record's revisions include its head, with the same revision number, revisionId, and contentHash |
| `search_unknown_variant` | each search entry names a published variant |
| `search_ref_mismatch` | the entry's `ref` (variantId, identityId, revision, revisionId, contentHash) and head fields equal the variant's head |
| `search_bucket_mismatch` | the entry has a search token that belongs to its shard's bucket |
| `search_missing_variant` | every variant has at least one search entry |
| `rebuild_mismatch` | `buildCatalogShards` run over the catalog's own records reproduces the manifest and every referenced shard exactly |

The rebuild check goes beyond the brief. It catches a dropped, added, or stale search shard or entry that the per-entry checks cannot see, such as one alias's token shard being deleted. The bucket rule copies the private `bucket` helper in [ingredientCatalog.js](../../public/shared/nutrition/ingredientCatalog.js), which is not exported, as `catalogBucket`. If the two ever drift apart, the rebuild check fails.

`readCatalogDirectory(dir)` reads `manifest.json` and then only the shard files the manifest references. It never opens a path that fails the reader's pattern, so such a path is reported as `shard_path_invalid` plus `shard_missing`. The orphan check therefore applies to in-memory `{ manifest, files }` inputs, such as `stageCatalog` and `combineCatalogs` output. It does not apply to stray files on disk.

## Append-only and merge semantics

- **`verifyAppendOnly(previous, next)`** runs `verifyCatalog` on both catalogs and prefixes their defects with `previous:` or `next:`. It then compares the variant records by canonical JSON (`canonicalJson`). If a previous id is missing from next, it reports `dropped_profile:<id>`. If the id is present but its record differs, it reports `changed_profile:<id>`. Revisions live inside the record, so this check also protects every prior revision. Each previous search entry must also appear unchanged in the same bucket; otherwise it reports `dropped_search_entry:<bucket>:<id>`. It returns `{ added, preserved, defects }`, where `added` is the sorted list of new ids.
- **`mergeCatalogRecords(previous, new)`** handles duplicate variantIds. If both copies have identical canonical JSON, they collapse to one copy, which makes a rerun idempotent. If the copies differ, it throws a `TypeError` that names the id, so a published profile is never silently overwritten. The result is sorted by variantId, the same order `stageCatalog` uses.
- **`combineCatalogs(previous, next)`** first requires both inputs to verify with 0 defects. It then pulls the records out of both sets of variant shards, merges them, and rebuilds the catalog with `buildCatalogShards`. It returns `{ manifest, files }` and writes nothing.

**Idempotency proof (tests):** `combine(combine(A, B), B)` is byte-identical to `combine(A, B)`: the manifest JSON, the file set, and every file's canonical JSON all match. `combine(A, empty)` and `combine(empty, A)` are byte-identical to `A`. On the shipped catalog, `combineCatalogs(shipped, empty)` reproduces the on-disk `manifest.json` byte for byte and every shard's canonical JSON.

## Shipped catalog results

`npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts` on `public/shared/nutrition/catalog/nutrition-curated` at `f03d706`:

| Measure | Value |
| --- | ---: |
| Profiles (distinct variantIds; manifest profileCount) | 14 (14) |
| Variant shards | 8 |
| Search shards | 29 |
| Search entries | 47 |
| Revisions | 14 |
| Defects | 0 |

`--previous <shipped> --next <shipped>` reported added 0, preserved 14, and 0 defects. `--combine <shipped> <shipped>` (an idempotent rerun of the whole catalog) reported a combined total of 14 profiles, added 0, preserved 14, and 0 defects.

There are 14 published catalog ids: `breadcrumbs-plain-as-sold`, `chocolate-dark-45-59-percent-cacao-as-sold`, `chocolate-dark-60-69-percent-cacao-as-sold`, `chocolate-dark-70-85-percent-cacao-as-sold`, `chocolate-milk-as-sold`, `chocolate-unsweetened-baking-as-sold`, `chocolate-white-as-sold`, `cocoa-powder-unsweetened-dutch-process-as-sold`, `cocoa-powder-unsweetened-natural-as-sold`, `lemon-juice-fresh-ready-to-drink`, `lime-juice-fresh-ready-to-drink`, `mayonnaise-regular-as-sold`, `orange-juice-fresh-ready-to-drink`, `soy-sauce-regular-as-sold`.

## In-repo tests

[catalogIntegrity.test.ts](../../scripts/nutrition/catalogIntegrity.test.ts) holds 29 tests. They use synthetic records only: minimal records shaped like `toCatalogRecord` output, built with `buildCatalogShards`. Every negative case asserts that its expected defect code is present. A mutated shard also breaks its hash, so these tests do not require that defect to be the only one. The tests cover:

- **verifyCatalog:**
  - A valid two-record catalog has 0 defects and the expected counts, and so does the empty catalog.
  - Tampering is flagged: `shard_hash_mismatch`, `shard_filename_hash_mismatch`, `shard_missing`, `manifest_schema`, and `profile_count_mismatch`.
  - `duplicate_variant` is flagged in hand-assembled variant shards, and `variant_bucket_mismatch` is flagged too.
  - Search problems are flagged: `search_unknown_variant`, `search_ref_mismatch`, and `search_missing_variant`.
  - Head problems are flagged: `head_revision_missing` and `head_revision_mismatch`.
  - `orphan_file` is flagged, and so is a deleted alias search shard (`rebuild_mismatch`).
  - Defect output never contains record content.
- **verifyAppendOnly:**
  - Adding one record lists exactly that id in `added`, with preserved 2 and 0 defects.
  - A dropped profile is flagged with `dropped_profile` and `dropped_search_entry`.
  - Altered revision content is flagged with `changed_profile`.
  - Each side's own defects are prefixed.
- **mergeCatalogRecords and combineCatalogs:**
  - An identical duplicate dedupes, and a conflicting duplicate throws.
  - The idempotency proof above.
  - A batch that conflicts with a published profile throws.
  - A combine with an input that has defects is refused.
- **Staged-level proof:** this uses `stageCatalog` itself, with the approved-job factory copied from `researchStaged.test.js`.
  - Batch 1 (two jobs) and batch 2 (one different job) are staged separately. Batch 2 alone holds 1 profile.
  - Combining the two gives profileCount 3 with 0 defects, and `verifyAppendOnly(batch1, combined)` adds exactly the new id and preserves 2.
  - A rerun of batch 2 changes nothing.
  - Publishing batch 2 alone would report `dropped_profile` for both batch 1 ids.
- **Shipped catalog** (read-only; ids and counts only):
  - The catalog has 0 defects, profileCount 14, and 14 variantIds.
  - `verifyAppendOnly(shipped, shipped)` reports added [] and preserved 14.
  - `combine(shipped, empty)` is byte-identical to the shipped catalog.
- **CLI:**
  - The default mode prints counts only.
  - `--previous/--next` and `--combine` work on temporary directories.
  - A reversed pair fails with `dropped_profile`.
  - Bad usage and unreadable directories are rejected.
  - Manifest paths outside the shard pattern are never opened.

All of these fail on the pre-change code, because `catalogIntegrity.ts` and its CLI did not exist before this change.

Suite results on this branch: the targeted file passed 29/29. Root `npm test` passed 2156 (115 files). The nutrition scripts suite passed 157. CalorieTracker `npm test` passed 1181 (47 files). `npm run ci:docs` and `npm run ci:contract` pass.

## Rule for A2 and later batches

Every batch after A1, starting with A2 (25 ids on the ladder), follows these steps before its import PR is opened:

1. Stage the batch with `stageCatalog` (per batch, unchanged).
2. Combine it with the currently published catalog: `combineCatalogs(published, staged)`. A conflicting variantId stops the import, and so does any defect in either input.
3. Pass `verifyCatalog(combined)` with 0 defects.
4. Pass `verifyAppendOnly(previous = published, next = combined)` with 0 defects. `added` must equal exactly the batch's imported ids, and `preserved` must equal the published profile count.
5. Publish only the combined `{ manifest, files }`. Its counts and this check's output go in the batch's import report.

The CLI runs steps 2 to 4 with nothing written to disk: `--combine <published dir> <staged dir>`. After the combined catalog is written into the import branch, `--previous <published dir> --next <combined dir>` re-checks the written files.

## Re-run

```sh
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --previous <dir> --next <dir>
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --combine <previousDir> <newDir>
npx --no-install vitest run scripts/nutrition/catalogIntegrity.test.ts
```
