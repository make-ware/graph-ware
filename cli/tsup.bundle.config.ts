import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const version =
  process.env.GW_VERSION ??
  (
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string }
  ).version;

/**
 * Standalone single-file build used for GitHub release assets.
 *
 * Bundles every workspace and npm dependency into one script so the published
 * artifact only requires Node.js >= 20.19 at runtime — no node_modules, and in
 * particular no tsx, which is what `bin/graphware.js` needs to run the source.
 *
 * `@project/shared` is source-only and has no build of its own; esbuild
 * resolves its `exports` map straight to `.ts` and compiles it in here, so
 * nothing has to run before this.
 */
export default defineConfig({
  entry: {
    graphware: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Kept out of dist/ so it never shadows the normal workspace build.
  outDir: 'bundle',
  dts: false,
  // Some bundled dependencies (commander) are CommonJS. esbuild's interop shim
  // needs a real `require` in scope, otherwise inlined `require('events')`
  // calls fail at runtime with "Dynamic require of ... is not supported".
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __gwCreateRequire } from 'node:module';",
      'const require = __gwCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  define: { __GRAPHWARE_VERSION__: JSON.stringify(version) },
  // Inline all dependencies (@project/shared, commander, @inquirer/prompts,
  // pocketbase, zod).
  noExternal: [/.*/],
  clean: true,
  sourcemap: false,
  minify: true,
  splitting: false,
});
