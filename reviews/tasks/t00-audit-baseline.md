# T00: Audit Baseline and Change Boundaries

Completed: 2026-07-10

## Repository and references

- Repository: `ferynd/Website`
- Default branch: `main`
- Original baseline commit: `b261ba0d35deb7ed7c4d5bf590ff2895f87f6ac8`
- Audit branch: `review/full-site-investigation-2026-07`

## Review boundaries

- Review `main` as the stable application baseline.
- Record the exact `main` SHA used for each task.
- Review active pull requests separately and identify whether they change or invalidate findings.
- Keep audit documentation on a review-only branch.
- Do not change application behavior during the investigation.
- Keep validated defects separate from risks, opportunities, subjective design recommendations, and items requiring live access.
- Delay implementation-backlog changes until final consolidation unless James explicitly requests earlier action.
- Every final recommendation must include evidence, affected surface, impact, priority, confidence, acceptance criteria, and validation approach.

## Change handling

New commits may continue landing on `main`. At the start of each task:

1. identify the latest `main` commit;
2. compare it with the last reviewed commit;
3. determine whether previous findings need revalidation;
4. record whether each finding applies to `main`, an active branch, or both.

The audit branch may remain behind `main` during investigation because it contains documentation only. It should be updated or rebased before a final review pull request is opened.

## Evidence conventions

- `validated`: directly supported by code, configuration, repository history, or reproducible output;
- `risk`: plausible but requires runtime/provider confirmation;
- `manual validation required`: cannot be established from source alone;
- priorities: critical, high, medium, low;
- confidence: high, medium, low.

## Continuity rule

The review ledger and task files are the durable source of truth. Chat summarizes progress and product decisions. If conversation context becomes unreliable, update the repository files first and resume in a new conversation from the ledger's `Next Task` entry.
