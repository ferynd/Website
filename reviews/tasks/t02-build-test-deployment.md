# T02: Development, Build, Test, and Deployment Foundations

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Reviewed

- root and Nutrition Tracker package manifests/lockfiles;
- Next.js, TypeScript, ESLint, Tailwind, and PostCSS configuration;
- Cloudflare adapter packages and deployment-fix commit;
- repository checks/workflows;
- README development/deployment instructions;
- current official framework, hosting, and security guidance.

Direct command reproduction was blocked because the review execution container could not resolve GitHub. Successful commands reported in commit `7bf4625` are retained as repository evidence, not independently reproduced results.

## Positive controls

- committed lockfile v3;
- strict TypeScript and Next plugin;
- Next/eslint-config version alignment;
- semantic ESLint configuration;
- ignored secrets/build output/debug logs;
- explicit Edge runtime route declarations;
- recent deployment pin reports clean install, type-check, lint, 1,194 tests, standard build, and Pages build.

## Findings

### F-003: Next.js is below required security-patched versions

Root pins `next@15.4.3`. Official vendor guidance requires the 15.4 line through 15.4.11 for the complete late-2025/January-2026 React Server Component security fixes.

Priority: critical.

Immediate response:

- upgrade Next and matching packages;
- regenerate lockfile;
- rerun all checks/builds and deploy smoke tests;
- assess production exposure and server-secret rotation.

### F-004: Production uses deprecated `@cloudflare/next-on-pages`

The pin fixed an immediate peer-dependency outage, but the adapter is deprecated/archived and caps supported Next versions. Current Cloudflare full-stack Next.js direction is Workers with `@opennextjs/cloudflare`.

Priority: high.

### F-005: No enforceable runtime/package-manager contract

- no root `engines`;
- no `packageManager`;
- no `.nvmrc`/`.node-version`;
- README says Node 18+;
- locked dependency set includes a Node 22+ requirement.

Priority: medium. Recommended current baseline: Node 22.

### F-006: No required automated PR quality/security gate

No GitHub Actions workflow, check status, or Dependabot configuration was found. Checks are manually reported but not repository-enforced.

Priority: high.

### F-007: Overlapping test suites run under two Vitest majors

Root bare discovery uses Vitest 2 while nested Nutrition Tracker explicitly runs the same test files using Vitest 4.

Priority: medium.

### F-008: README documents the wrong production contract

It describes Node 18+, generic Pages builds, no server-side behavior, and incomplete Firebase/environment requirements despite current API routes and deployment tooling.

Priority: medium.

## Unverified provider/runtime items

- clean install on intended Node version;
- exact suite totals;
- current standard and provider build output;
- deployed Cloudflare command/runtime/version;
- production route smoke tests;
- provider-level mitigations;
- secret-rotation history.
