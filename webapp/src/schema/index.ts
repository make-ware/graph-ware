// Barrel export for all collection schemas, types, and validation schemas.
// Exposed to the app as `@project/shared/schema`.
//
// This file is excluded from `pocketbase-migrate`'s schema discovery — keep it
// that way, or every collection gets parsed twice.
export * from './user';
export * from './workspace';
export * from './workspace-member';
export * from './graph';
export * from './graph-node';
export * from './graph-import';
export * from './graph-edge-override';
export * from './graph-version';
export * from './port-kind';
