# Personal Website

This repository contains the static HTML pages for my website. There is no build step or framework; the site is served directly from these files.

## Local Setup

1. Clone the repository.
2. Start a simple static server from the project root. For example:
   ```bash
   python3 -m http.server 8080
   ```
   Then open `http://localhost:8080` in your browser.

## Directory Overview

- `index.html` – Landing page linking to everything else.
- `games/` – Small demos and experiments.
  - `noir_detective_idea/` – Prototype noir adventure.
- `tools/` – Utility pages.
  - `CalorieTracker/` – Three‑day rolling average nutrition tracker.
- `trips/` – Travel notes and itineraries.
  - `ChicagoTripItinerary/` – Example weekend plan for Chicago.

## Deployment on Cloudflare Pages

1. Create a new Pages project and connect it to this repository.
2. Leave the build command blank and set the root directory to `/`.
3. Cloudflare will deploy on every commit to the main branch.

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
