# Personal Website

This repository contains a small Next.js application that serves as an interactive hub along with various static pages.  All content lives in the `hub` folder and is exported to static files under `hub/out` for deployment.

## Setup

Ensure you have a recent Node.js version installed (tested with Node 18+). Install project dependencies inside the `hub` directory:

```bash
cd hub && npm install
```

## Local Development

1. Start the development server:
   ```bash
   npm run dev
   ```
   The hub will be available at `http://localhost:3000`.
2. Build the static site (output goes to `hub/out`):
   ```bash
   npm run build
   ```
3. To view the static pages without a build step, run a simple server from the project root:
   ```bash
   python3 -m http.server 8080
   ```

## Project Structure

- `index.html` – Redirects visitors to the React hub under `/hub/`.
- `index_legacy.html` – Previous static landing page kept for reference.
- `hub/` – Source for the Next.js hub.
  - `app/` – Application routes and components.
  - `public/` – Static assets used by the hub.
  - `out/` – Static export produced by `npm run build`.
    - `games/`, `tools/`, `trips/` – Demos, utilities, and travel notes copied here during deployment.

## Updating Hub Links

Links shown in the hub are normally collected from Markdown files under `content/hub/<category>/`. Create a new markdown file with `title`, `url`, and `icon` front matter to add a link:

```markdown
---
title: "Cool Project"
url: "/projects/cool/"
icon: "✨"
---

Short description here.
```

Alternatively, you can maintain a single JSON configuration by editing `content/hubConfig.json` and enabling the `useJsonHubData` flag in `hub/next.config.ts`.

## Deployment on Cloudflare Pages

1. Create a new Pages project and connect it to this repository.
2. Set the build command to `npm run build` and the build directory to `hub/out`.
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

### How to add animation layers

Animation layers are controlled by the `HubStage` component inside `hub/components`. Create new client components that render `OrbLayer` and update the `layerStack` when selected. New orb elements use the shared `popSpring` transition.

Install particle dependencies with:
```bash
npm install react-tsparticles tsparticles-engine
```
