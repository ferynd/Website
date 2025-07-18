# Personal Website

This repository hosts my static pages along with a small Next.js app that powers the main landing page.

## Local Development

1. Install dependencies inside the `hub` directory if you plan to work on the React hub:
   ```bash
   cd hub && npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
   The hub will be available at `http://localhost:3000`.
3. To view the static pages without a build step, you can run a simple server from the project root:
   ```bash
   python3 -m http.server 8080
   ```

## Directory Overview

- `index.html` – Redirects visitors to the React hub under `/hub/`.
- `index_legacy.html` – Previous static landing page kept for reference.
- `hub/` – Next.js project containing the interactive hub.
- The hub is exported with `basePath: '/hub'` so all assets load from this folder.
- `games/` – Small demos and experiments.
  - `noir_detective_idea/` – Prototype noir adventure.
- `tools/` – Utility pages.
  - `CalorieTracker/` – Three‑day rolling average nutrition tracker.
- `trips/` – Travel notes and itineraries.
  - `ChicagoTripItinerary/` – Example weekend plan for Chicago.

## Deployment on Cloudflare Pages

1. Create a new Pages project and connect it to this repository.
2. Set the build command to `npm run build` and the build directory to `hub/out`.
   The Next.js config specifies `basePath: '/hub'` so the static export works from this subfolder.
3. Add a deployment step that copies the `games`, `tools`, and `trips` directories into `hub/out` so they remain accessible.

## Firebase Config

The Calorie Tracker uses Firebase for authentication and storage. Its `firebaseConfig` object lives in `tools/CalorieTracker/firebaseConfig.js`. These values are public client identifiers and safe to include in the repository.

### React Hub Initialization

If Firebase functionality is later needed in the React hub, create a file such as `hub/firebase.ts` and initialize Firebase there:

```ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { firebaseConfig } from '../tools/CalorieTracker/firebaseConfig';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

Import the `auth` instance in your React components wherever authentication is required.
