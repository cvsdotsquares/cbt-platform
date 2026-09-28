import type { NextConfig } from 'next';
import os from 'os';
import path from 'path';
import { loadEnvConfig } from '@next/env';

// Share JWT_ACCESS_SECRET (and API_PROXY_URL) from the API package in monorepo dev.
loadEnvConfig(path.join(__dirname, '..', 'api'));

function lanDevOrigins() {
  const origins = new Set(['localhost', '127.0.0.1']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const net of addrs || []) {
      const v4 = net.family === 'IPv4';
      if (v4 && net.address) origins.add(net.address);
    }
  }
  return [...origins];
}

const nextConfig = {
  transpilePackages: ['@cbt/shared'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  allowedDevOrigins: lanDevOrigins(),
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

