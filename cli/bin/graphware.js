#!/usr/bin/env node
// Zero-build launcher. There is no dist/: this registers tsx's ESM loader and
// then imports the TypeScript entry point directly, so what runs is exactly the
// source in src/. That is why tsx is a real dependency and not a devDependency.
//
// A `#!/usr/bin/env -S npx tsx` shebang would be shorter, but `env -S` is
// missing on older BSD/macOS and some Alpine images, and it re-resolves tsx
// from PATH on every invocation.
import { register } from 'tsx/esm/api';

const unregister = register();
try {
  const { main } = await import('../src/index.ts');
  // Setting exitCode rather than calling process.exit() lets buffered stdout
  // flush — otherwise piping `--json` output can truncate it.
  process.exitCode = await main(process.argv.slice(2));
} finally {
  await unregister();
}
