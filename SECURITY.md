# Security & Privacy

This site is a **client-first** Next.js app with static sub-sites. There is **no server-side secret logic** in this repo. 
Persistence is provided via **Firebase (Auth + Firestore)** for selected tools.

## Secrets & Keys
- **Firebase web config** (`app/tools/trip-cost/firebaseConfig.ts` and `/public/tools/CalorieTracker/firebaseConfig.js`) contains **public identifiers**. 
  - These MUST NOT be treated as secrets; access is controlled by **Firestore Security Rules**.
  - Do **not** commit any private server keys, service account JSON, or API tokens.
- Never log PII, tokens, or auth data to the console. Avoid printing document contents that could include personal information.

## Authentication
- Email/password via Firebase Auth on Trip Cost (and optionally in Calorie Tracker).
- The admin user is `arkkahdarkkahd@gmail.com` (see `ADMIN_EMAIL` in the Trip Cost config). Use this only for approvals and privileged actions.

## Firestore Structure
Trip Cost data lives under `artifacts/trip-cost/**` (see **ARCHITECTURE.md**). Calorie Tracker uses `artifacts/<appId>/users/{uid}/**` scoped to a user. Trip Planner persists under `artifacts/trip-planner/**` with the following collections:

- `planners/{plannerId}` — metadata, participant IDs, linked Trip Cost ID, settings, and start/end dates.
- `planners/{plannerId}/events/{eventId}` — itinerary blocks, travel segments, and activities.
- `planners/{plannerId}/activityIdeas/{ideaId}` — curated suggestions visible to planner participants.
- `planners/{plannerId}/changelog/{logId}` — admin-only audit log entries.

### Trip Planner

- **Participants**: Only authenticated participants listed in `participantUids` (plus the admin account) can read or modify a planner, its events, and activity ideas.
- **Changelog**: Audit entries under `planners/{plannerId}/changelog/{logId}` are **readable by admin only**. Participants may append entries that reference their own UID; no edits or deletions are allowed client-side.
- **Linked data**: `costTrackerId` maintains the 1:1 link to Trip Cost trips. All participant mutations must keep the two tools synchronized.
- **Uploads**: Images land in Storage under `artifacts/trip-planner/uploads/{plannerId}/**` and should be compressed client-side (see `PlanContext` image helpers) before upload.

## Firestore Security Rules (authoritative)
The canonical Firestore rules are maintained in `firestore.rules` at the repository root.

To keep one source of truth, do not duplicate or partially copy rules in docs; reference `firestore.rules` directly whenever rules are discussed.

## Supply-chain & XSS Considerations
- Static sub-sites under `/public` may include third-party scripts (Firebase, Chart.js). Prefer **pinned versions** and integrity attributes where feasible.
- Avoid `innerHTML` with untrusted data in static apps. Use DOM APIs and escape user input before rendering.
- Do not include untrusted external scripts/styles in production without review.

## Data Minimization & Retention
- Store only what is necessary for features (e.g., trip participants/emails, expenses, payments). 
- If you add analytics or additional PII, document the fields and update this SECURITY.md.

## When to Update this Document
- Any change to auth flows, Firestore structure, **rules**, data retention, or external scripts.
- Any new tool that persists user data or reads sensitive data.



### Date Night Roulette

- Firestore paths: `artifacts/date-night/**` for `couples/main`, `settings/global`, `dates`, `modifiers`, and `rolls`.
- Access model: only `participantUids` from `couples/main` plus admin email may read/write tool data.
- Uploads: Storage path `artifacts/date-night/uploads/**` is participant/admin scoped (see `storage.date-night.rules`).
- Firestore rules for Date Night and Trip Planner are now consolidated into the single root `firestore.rules` file.

- State-machine note: vetoes increment source counters without creating roll docs; only accepted outcomes create `rolls` entries.
