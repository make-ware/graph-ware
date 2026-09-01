import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// release-please bumps the root package.json; cli/package.json stays at 0.0.0.
const version =
  process.env.GW_VERSION ??
  (
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string }
  ).version;

export default defineConfig((options) => ({
  entry: {
    graphware: 'src/cli.ts',
  },
  format: ['esm'],
  // The package declares `engines.node >= 20.19`; the build has to agree.
  target: 'node20',
  platform: 'node',
  // The CLI is an application, not a library - consumers never import its types.
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
  define: { __GRAPHWARE_VERSION__: JSON.stringify(version) },
  // npm dependencies stay external and resolve from node_modules, but
  // `@project/shared` has no build of its own — its exports map points at raw
  // `.ts`, which Node cannot load. Leaving it external produces a dist/ that
  // dies on the first import; inlining it is what makes this output runnable.
  // tsup.bundle.config.ts inlines *everything* for the release artifact.
  noExternal: ['@project/shared'],
  clean: !options.watch,
  sourcemap: true,
  minify: false,
  splitting: false,
}));
