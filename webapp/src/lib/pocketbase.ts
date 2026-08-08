// The app-wide PocketBase client.
//
// The factory lives in `@project/shared/client` so the CLI can build the same
// client against a different URL and a file-backed auth store. What stays here
// is the part that is webapp-only: reading the build-time env var, and holding
// the module singleton every context and hook imports.
import { createPocketBaseClient } from '@project/shared/client';

// Inlined at build time by Next — `/` for the container images (same origin
// behind nginx), `http://localhost:8090` for dev.
const pb = createPocketBaseClient(
  process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090',
  {
    enableAutoCancellation: false,
    requestTimeout: 30000, // 30 second timeout
  }
);

export default pb;
