import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server build (.next/standalone) only when building the
  // split webapp image (docker/Dockerfile.webapp sets NEXT_STANDALONE=1).
  // Left undefined otherwise so the monolithic docker/Dockerfile (which uses
  // `next start`) is unaffected.
  output: process.env.NEXT_STANDALONE ? 'standalone' : undefined,
};

export default nextConfig;
