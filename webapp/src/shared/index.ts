// Public surface of the `@project/shared` package.
//
// Per the project architecture this exposes shared **types, schemas, and
// utility functions** only. Mutators and services are application-specific and
// live under `@/mutators` and `@/services` (reachable as
// `@project/shared/mutators` for the data layer).
export * from '../schema';
export * from '../lib/graph/primitives';
export * from '../lib/graph/imports';
export * from '../lib/graph/types';
export * from '../lib/graph/filters';
export * from '../lib/graph/engine';
// `lib/graph/resolver` is deliberately absent: it takes a PocketBase client.
// It lives at `@/lib/graph/resolver` for the pages that need it.
export * from '../lib/graph/layout';
export * from '../lib/loading-manager';
export * from '../lib/errors';
export * from '../lib/retry';
