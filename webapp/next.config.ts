import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server build (.next/standalone) only when building the
  // split webapp image (docker/Dockerfile.webapp sets NEXT_STANDALONE=1).
  // Left undefined otherwise so the monolithic docker/Dockerfile (which uses
  // `next start`) is unaffected.
  output: process.env.NEXT_STANDALONE ? 'standalone' : undefined,
  // `@project/shared` ships raw .ts through its exports map — there is no build
  // step — so Next has to compile it like first-party source instead of
  // treating it as a pre-built node_modules package.
  transpilePackages: ['@project/shared'],
  // Standalone output traces from the workspace root, not webapp/, so the
  // shared sources are inside the trace boundary. cwd is always webapp/ during
  // `next build`.
  outputFileTracingRoot: path.join(process.cwd(), '..'),
};

export default nextConfig;
