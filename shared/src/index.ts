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
export * from '../lib/graph/snapshot';
// `lib/graph/resolver` and `lib/graph/clone` are deliberately absent: both take
// a PocketBase client. They live at `@/lib/graph/…` for the pages that need
// them. `snapshot` is here because its exported half is pure — the publish and
// restore helpers that touch the network live in the version mutator.
export * from '../lib/graph/layout';
export * from '../lib/loading-manager';
export * from '../lib/errors';
export * from '../lib/retry';
