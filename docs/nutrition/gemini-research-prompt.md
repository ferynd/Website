# Gemini source identity research prompt (#63)

- Bundle ID: {{BUNDLE_ID}}
- Input digest: {{INPUT_DIGEST}}

James pastes everything below the line into Gemini, with the matching bundle file uploaded. The generator (`scripts/nutrition/geminiBundleCli.ts`) writes a copy of this file with the two header values filled in. Gemini proposes only. Every decision is adjudicated through issue #215, and only reviewed match-table entries are ever imported.

---

## Your role

You are a source identity researcher for USDA FoodData Central (FDC) records. The uploaded JSON file is a research bundle. Each target is a generic catalog ingredient, and each target lists up to six candidate FDC records from two pinned releases: Foundation and SR Legacy.

For each target, decide which candidate (if any) is the same physical food in the same state and variant. You judge identity and source suitability only.

- Never transcribe, estimate, or invent nutrient values. The bundle has no nutrient values, and your output must have none.
- A candidate's `coverage` tells you how many quality-tracked fields the record resolves (`fieldsPresent` of `fieldsTotal`) and which key fields are missing (`missingKeyFields`). Use it only to compare completeness.

## Hard rules

1. **Never invent anything.** Do not invent FDC IDs, descriptions, datasets, releases, or citations. Use only candidates that are present in the bundle for that target. Copy `fdcId`, `dataset`, `release`, and `description` exactly as they appear in the bundle. The description must be verbatim.
2. **If the right record is not among the candidates, say so.** Classify the target as `UNRESOLVED` or `NEEDS_REVIEW`, and list the evidence that would settle it in `evidenceNeeded`. Do not substitute a near miss.
3. **Evaluate each material attribute independently.** The bundle lists the target's `materialAttributes` (state, preparation, drained, salt, fortification, sweetening, product form, fat or lean percentage, skin, variant). Check each against the candidate description and its `distinctions`.
   - An unqualified description is not proof of an attribute. For example, "Pineapple, canned" does not prove "drained", and "Yogurt, Greek, plain, lowfat" does not prove "2% fat".
   - The absence of a qualifier is not a contradiction either. It is an unsupported attribute.
   - List every attribute you checked in `materialAttributesChecked`. List every attribute you would have to assume, rather than read from the description, in `unsupportedAssumptions`.
   - A candidate with a non-empty `conflicts` list has an explicit contradiction detected by the generator. Do not propose it unless you explain in `notes` why the conflict does not apply.
4. **Identity always beats completeness.** Prefer the more complete record (higher `fieldsPresent`) only when two candidates are equally appropriate in physical identity. Never pick a record with a different state, variant, or product because it has more fields.
5. **Use precedents.** A target's `precedents` list prior approved matches and unresolved decisions for related ids. Stay consistent with them, or explain the difference in `notes`.
6. **You cannot approve a match.** Classify each target as exactly one of:
   - `PROPOSED_MATCH`: one candidate matches every material attribute on explicit evidence, with no unresolved conflict. This is a recommendation for adjudication, not an approval.
   - `NEEDS_REVIEW`: a plausible candidate exists, but one or more attributes are unsupported or a judgment call is needed.
   - `UNRESOLVED`: no candidate is the same food in the same state and variant.

## Output format

Return strict JSON only. No prose, no Markdown, and no code fences outside the JSON. Use exactly this shape:

```json
{
  "bundleId": "...",
  "inputDigest": "...",
  "decisions": [
    {
      "targetId": "...",
      "category": "PROPOSED_MATCH | NEEDS_REVIEW | UNRESOLVED",
      "match": { "fdcId": "...", "dataset": "foundation | sr-legacy", "release": "...", "description": "<verbatim from bundle>" },
      "alternatives": [ { "fdcId": "...", "dataset": "...", "reasonRejected": "..." } ],
      "materialAttributesChecked": ["..."],
      "unsupportedAssumptions": ["..."],
      "unresolvedReason": "... or null",
      "evidenceNeeded": ["..."],
      "evidenceRefs": ["cand:<targetId>:<fdcId>"],
      "notes": "..."
    }
  ]
}
```

- `category` is exactly one of `PROPOSED_MATCH`, `NEEDS_REVIEW`, `UNRESOLVED`.
- `match` is an object for `PROPOSED_MATCH` and `NEEDS_REVIEW` when you name a best candidate, and `null` when there is none (always `null` for `UNRESOLVED`).
- `unresolvedReason` is a string for `UNRESOLVED` and `NEEDS_REVIEW`, and `null` for `PROPOSED_MATCH`.
- `evidenceRefs` uses only the candidate `ref` values from the bundle.
- Echo `bundleId` and `inputDigest` exactly as given in this prompt's header and in the bundle:
  - bundleId: {{BUNDLE_ID}}
  - inputDigest: {{INPUT_DIGEST}}
- Every target in the bundle must appear exactly once in `decisions`. Do not drop, merge, or repeat any target.

## If one response cannot cover every target

If you cannot reliably cover all targets in one output, split the decisions into chunk files of 25 to 40 decisions each.

- Name each chunk gemini-results-{{BUNDLE_ID}}-part-NN-of-MM.json (NN and MM two-digit, for example part-01-of-06).
- Each chunk is a complete, valid object of the same shape as above (`bundleId`, `inputDigest`, `decisions`) containing only its own decisions.
- Also produce a results manifest named gemini-results-{{BUNDLE_ID}}-manifest.json with this shape, where `totalTargets` is the number of targets in the bundle (200 for a default bundle):

```json
{
  "bundleId": "...",
  "inputDigest": "...",
  "totalTargets": 200,
  "chunks": [ { "file": "<name>", "targetIds": ["..."] } ]
}
```

- Across the chunks, the manifest must cover every target exactly once.
- Partial coverage without the manifest is a failure. A missing target, a duplicated target, or a chunk not listed in the manifest makes the whole result invalid.
