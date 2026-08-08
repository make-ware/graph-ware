import { defineConfig } from 'vitest/config';

// Deliberately minimal. The absence of happy-dom, @vitejs/plugin-react and a
// setup file is the enforcement that everything tested here stays pure — a
// test that reaches for the DOM belongs in the webapp workspace instead.
//
// No `resolve.alias` either: every import inside shared/ is relative.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
  },
});
