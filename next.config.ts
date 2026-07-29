import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Only wires up Cloudflare bindings/simulation for `next dev`; a no-op
// during `next build` and in the OpenNext-built Worker itself.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
