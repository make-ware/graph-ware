// Config for `pocketbase-migrate` (from the pocketbase-zod-schema package).
//
// The zod collection definitions in webapp/src/schema are the source of truth
// for fields and API rules; the migrations in pocketbase/pb_migrations are what
// PocketBase actually applies on boot. This config connects the two so drift
// between them can be detected (`yarn db:status`) and closed (`yarn db:generate`).
//
// `schema.exclude` is left at its default (base.ts, index.ts, permissions.ts,
// permission-templates.ts) — specifying it here would replace that list, and
// the barrel file must stay excluded.
export default {
  schema: {
    directory: './webapp/src/schema',
  },
  migrations: {
    directory: './pocketbase/pb_migrations',
    // Round-trip up()/down() before writing a migration; refuse one that
    // doesn't roll back.
    verify: true,
    // "" resolves to the pb_data directory next to the migrations directory,
    // i.e. pocketbase/pb_data — the local dev database.
    dataDirectory: '',
  },
  diff: {
    warnOnDelete: true,
    requireForceForDestructive: true,
  },
  typeGen: {
    // Kept out of schema.directory so generated output is never mistaken for a
    // collection definition during schema discovery.
    outPath: './webapp/src/types/pocketbase-types.ts',
  },
};
