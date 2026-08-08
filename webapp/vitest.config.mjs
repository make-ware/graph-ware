import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
    testTimeout: 10000, // 10 seconds per test
    hookTimeout: 10000, // 10 seconds for hooks (beforeEach, afterEach, etc.)
    teardownTimeout: 5000, // 5 seconds for teardown
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
  },
  resolve: {
    // No `@project/shared` aliases: it is a real workspace resolved through its
    // own `exports` map. Keep this in step with `tsconfig.json` `paths` — an
    // alias surviving in either file shadows the package.
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
});