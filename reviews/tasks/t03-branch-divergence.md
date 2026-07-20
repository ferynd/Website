# T03: Pull Requests and Branch Divergence

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Audit branch: `review/full-site-investigation-2026-07`

## Result

No open pull requests were present at completion of this task.

The most recent pull request, PR #151, is merged and its Transcriber changes are part of the current `main` baseline. It includes:

- parallel OpenAI transcription chunks;
- parallel Gemini cleanup chunks;
- explicit retry/resume caches;
- correction response schemas and divergence guardrails;
- the resume-cache hardening follow-up;
- the Cloudflare Pages dependency pin and canonical `pages:build` script.

PRs #149 and #150 are also merged and establish the current Recipe Standardizer implementation and backlog structure.

## Branch matrix

| Ref | Relationship | Application relevance | Review treatment |
|---|---|---|---|
| `main` | Current production baseline at `548d952...` | Canonical application state | All subsequent tasks review this SHA or a later recorded `main` SHA |
| `review/full-site-investigation-2026-07` | Diverged: 3 commits ahead and 5 behind `main` | Only adds review documentation | Safe to retain without rebasing during investigation; does not represent alternative application code |
| PR #151 head | Merged | Transcriber and deployment changes now in `main` | Review as current `main`, not as a separate branch |
| PR #150 head | Merged | Backlog/documentation structure now in `main` | Review as current `main` |
| PR #149 head | Merged | Recipe Standardizer now in `main` | Review as current `main` |

GitHub comparison shows the audit branch's only file difference from `main` is `reviews/full-site-investigation.md`. The five commits it is behind share the original audit baseline as merge base and contain the merged PR #151 application changes.

## Effect on existing findings

- F-001 and F-002 apply to current `main`.
- F-003 through F-008 were discovered against current `main` after PR #151 merged and require no branch qualification.
- No finding is currently limited to an unmerged branch.
- T12 must review the merged Transcriber concurrency, resume, cleanup, and deployment-related changes rather than the original T00 baseline.

## Operational decision

Do not rebase the audit branch during active investigation unless a real file conflict appears. The ledger records the exact `main` SHA used for each task, and rebasing documentation-only commits adds risk without improving evidence quality.

Before a final review pull request is opened, update or rebase the audit branch onto the final reviewed `main` so the PR presents a clean documentation-only comparison.

## Findings

No new defect finding was created. The absence of pull-request checks reinforces F-006, but does not require a duplicate finding.

## Next task

`T04. Routing, navigation, discovery, and information architecture`
