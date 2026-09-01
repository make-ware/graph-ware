// Executable entry for the bundled builds.
//
// `src/index.ts` only *exports* `main` — it is imported by `bin/graphware.js`
// (the tsx source launcher) and by the tests. tsup needs an entry that
// actually runs, so this file is that, and nothing else lives here.
//
// Setting `process.exitCode` rather than calling `process.exit()` lets
// buffered stdout flush — otherwise piping `--json` output can truncate it.
// Same reasoning as bin/graphware.js; keep the two in step.
import { main } from './index.ts';

process.exitCode = await main(process.argv.slice(2));
