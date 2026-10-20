import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages added these two response headers by default; Workers do
  // not, so set them explicitly to keep parity after the Pages -> Workers
  // cutover (AR-01).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

// Only wires up Cloudflare bindings/simulation for `next dev`; a no-op
// during `next build` and in the OpenNext-built Worker itself.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
