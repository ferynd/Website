import type { NextConfig } from 'next'

export const useJsonHubData = process.env.USE_JSON_HUB_DATA === 'true'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
}

export default nextConfig
