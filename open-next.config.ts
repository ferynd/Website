import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// No ISR/PPR pages currently ship on this site (all app pages are static-
// prerendered or fully dynamic API routes). Serve the prerendered HTML/RSC
// payloads from Workers static assets (read-only cache populated at build
// time). Without this, OpenNext re-renders "static" pages on every request,
// and pages that import the Firebase SDK crash on Workers with
// "EvalError: Code generation from strings disallowed" (protobufjs).
// Revisit with an R2-backed cache override if a page starts using `revalidate`.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
