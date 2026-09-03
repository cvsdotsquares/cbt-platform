import type { NextConfig } from 'next';
import path from 'path';
import { loadEnvConfig } from '@next/env';

// Share JWT_ACCESS_SECRET (and API_PROXY_URL) from the API package in monorepo dev.
loadEnvConfig(path.join(__dirname, '..', 'api'));

const nextConfig = {
  transpilePackages: ['@cbt/shared'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    middlewareClientMaxBodySize: '100mb',
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
    ],
  },
} as NextConfig;

export default nextConfig;
