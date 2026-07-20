# T01: Verified Repository Inventory

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Baseline drift

The original baseline advanced by five commits before T01 completed:

- PR #151 merged Transcriber parallel processing, resume, and cleanup hardening;
- a Transcriber cache-hardening follow-up landed;
- Cloudflare Pages dependencies were pinned.

## Runtime architecture

- Next.js 15 App Router, React 19, TypeScript
- Tailwind CSS and CSS-variable design tokens
- standalone static HTML/CSS/JavaScript under `public/`
- Firebase Auth, Firestore, and selected Storage usage
- Edge API routes for AI and media metadata
- LocalStorage/IndexedDB for device-local state and Transcriber clips

## Product surface

### Main routes

- `/`
- `/games`
- `/tools`
- `/trips`
- `/style-guide`

### React tools

1. CIFI Research Estimator
2. Transcriber
3. Show Tracker, including Trends, Mood, and Settings
4. Conflict Tracker
5. Trip Planner
6. Date Night Roulette
7. Trip Cost Calculator
8. Recipe Standardizer

### Static tools

9. Nutrition Tracker
10. Social Security interactive guide
11. Social Security calculator

### Static content

- Noir Detective
- Emeril: A World Divided
- Japan Trip
- Chicago Trip Itinerary

## API routes

### Show Tracker

- `POST /api/classify`
- `POST /api/classify/resolve`
- `POST /api/recommend`
- `POST /api/seasons`

### Transcriber

- `GET /api/transcriber/status`
- `POST /api/transcriber/transcribe`
- `POST /api/transcriber/correct`
- `POST /api/transcriber/gemini/upload`
- `POST /api/transcriber/gemini/window`
- `DELETE /api/transcriber/gemini/file`

## Shared surfaces

- React primitives: Nav, Button, Input, Select, ProjectCard
- shared AI model/request configuration
- Edge-compatible Firebase token verification
- root Firestore rules
- Date Night Storage rules
- shared static stylesheet

## Test inventory

Broad coverage:

- Transcriber
- Nutrition Tracker
- Recipe Standardizer

Partial coverage:

- Show Tracker
- Date Night
- Trip Planner scheduling

No dedicated suite discovered:

- CIFI
- Conflict Tracker
- Trip Cost financial logic
- Social Security tools
- static games/trips
- security rules
- authenticated end-to-end workflows

## Inventory findings

### F-001: Japan Trip uses developer-placeholder card copy

The file exists, but Home and Trips descriptions tell a developer to add/drop in the file instead of describing the itinerary.

Priority: low.

### F-002: Architecture inventory is materially stale

`ARCHITECTURE.md` omits active tools/trips, understates the Tools route, and describes Nutrition Tracker as a simple calorie tracker despite its current scope.

Priority: medium.

## Follow-up dependencies

- build/deployment: T02
- routing/discovery: T04
- design-system consistency: T05
- test strategy: T10
- documentation correction package: T25
