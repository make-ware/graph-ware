import { defineConfig } from 'vitest/config';

// Everything here runs offline against the mock PocketBase from
// `@project/shared/test-fixtures`. No server, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules'],
    testTimeout: 10000,
  },
});
