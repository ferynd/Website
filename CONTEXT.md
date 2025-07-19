# Project Overview

This repository hosts a static web hub built with **Next.js**.  The root of the repo contains static pages while the interactive React hub lives in the `hub/` directory and is exported as static files for deployment.

## Top Level Layout

```
LICENSE
README.md
index.html          # Redirects to /hub/
index_legacy.html   # Static fallback kept for reference
content/            # Markdown or JSON data for hub links
hub/                # Next.js application
```

Inside `hub/` you will find:

```
app/        # Application routes/components (Next.js app router)
components/ # React UI pieces for the orb-based interface
lib/        # Data loading utilities and context providers
public/     # Static images and assets
out/        # Static export produced by `npm run build`
```

## Development Flow

1. Install dependencies (Node 18+ recommended) in the `hub` directory:
   ```bash
   cd hub && npm install
   ```
2. Run the dev server:
   ```bash
   npm run dev
   ```
   The hub is served at `http://localhost:3000`.
3. Build a static version (output in `hub/out`):
   ```bash
   npm run build
   ```
4. You can view any static HTML by serving the repo root:
   ```bash
   python3 -m http.server 8080
   ```

These steps match the quickstart notes in `README.md` lines 5‑27.

## Hub Data

Link categories are normally collected from markdown files under `content/hub/<category>/`.  Each markdown file includes `title`, `url` and optional `icon` front matter.  See `README.md` lines 39‑50 for the format:

```markdown
---
title: "Cool Project"
url: "/projects/cool/"
icon: "✨"
---
Short description here.
```

Alternatively, you can maintain a single JSON configuration at `content/hubConfig.json` and set `useJsonHubData` in `hub/next.config.ts` to `true`.  The flag appears on line 3 of `hub/next.config.ts`.

## Data Loading Utilities

The `hub/lib/` folder contains helpers used by the React app. `getHubData.ts` reads markdown files and constructs an array of categories.  `loadHubData.ts` decides whether to read the markdown folders or the JSON file based on the `useJsonHubData` flag.

Key excerpts:

```ts
// hub/lib/getHubData.ts
const HUB_CONTENT_DIR = path.resolve(process.cwd(), '../content/hub');
...
export async function getHubData(): Promise<HubCategory[]> {
  const dirs = await fs.readdir(HUB_CONTENT_DIR, { withFileTypes: true });
  ...
}
```
```ts
// hub/lib/loadHubData.ts
export async function loadHubData(): Promise<HubCategory[]> {
  if (useJsonHubData) {
    const jsonPath = path.resolve(process.cwd(), '../content/hubConfig.json');
    const raw = await fs.readFile(jsonPath, 'utf8');
    return JSON.parse(raw) as HubCategory[];
  }
  return getHubData();
}
```

## Styling and Animations

Tailwind CSS powers the styling. `hub/tailwind.config.ts` defines the content paths and custom animation utilities.  The config exposes neon colors and a few keyframe animations such as `neon-glow` and `orb-pulse`. Adjust durations or colors within the `CONFIG` object near the top of that file.

```ts
// hub/tailwind.config.ts
const CONFIG = {
  contentPaths: ['./app/**/*.{js,ts,jsx,tsx}', './pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  glowDuration: '1.8s',
  pulseDuration: '1.6s'
};
```

## Additional Notes

- `index.html` immediately redirects to `/hub/` so the React hub is the default landing page.
- `index_legacy.html` provides a simple static site layout if needed.
- Assets for the hub live in `hub/public/` (e.g., SVG icons).
- When deploying to Cloudflare Pages, use `npm run build` with `hub/out` as the build directory, as stated in the README.
- Firebase configuration for the Calorie Tracker demo lives under `tools/CalorieTracker/firebaseConfig.js` (referenced in the README).

This file should help orient new contributors and outline where to add content or modify site behavior.
