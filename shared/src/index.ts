// Public surface of the `@project/shared` package — the bare specifier.
//
// This exposes shared **types, schemas, and pure utility functions** only.
// Mutators and services have their own subpaths (`@project/shared/mutators`,
// `@project/shared/services`) so importing the bare barrel never pulls the
// whole data layer along.
export * from './schema';
export * from './lib/graph/primitives';
export * from './lib/graph/imports';
export * from './lib/graph/types';
export * from './lib/graph/filters';
export * from './lib/graph/engine';
export * from './lib/graph/snapshot';
// `lib/graph/resolver` and `lib/graph/clone` are deliberately absent: both take
// a PocketBase client. They live at `@project/shared/graph` for the callers
// that need them. `snapshot` is here because its exported half is pure — the
// publish and restore helpers that touch the network live in the version
// mutator.
export * from './lib/graph/layout';
export * from './lib/loading-manager';
export * from './lib/errors';
export * from './lib/retry';
