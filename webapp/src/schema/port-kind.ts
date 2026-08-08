import {
  baseSchema,
  defineCollection,
  JSONField,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import { memberOf, SIGNED_IN, writerOf } from './permissions';

/**
 * The registry of connection types — `power`, `data/canbus`, `video/hdmi`.
 *
 * In the file-based original, `kind` was a bare string and its colour lived in
 * a map hardcoded in two components that had to be kept in step by hand. Here
 * presentation comes from data.
 *
 * The registry is **not** a validation gate. A port may name a kind that has no
 * row here; it still connects to ports of the same kind, it just renders with
 * the fallback colour. That keeps the registry an aid rather than a bottleneck
 * every new kind has to pass through.
 *
 * Rows come in two flavours since Phase 5. A row with **no** `workspace` is
 * global: readable by everyone including signed-out visitors looking at a
 * public graph, writable only by a superuser, because letting one user rename
 * `power` under another's feet is worse than an admin-managed list. A row
 * **with** a workspace is that workspace's own vocabulary — invisible
 * elsewhere, writable by its members, and it shadows a global row of the same
 * key for them.
 */
export const PortKindSchema = z
  .object({
    /**
     * Absent means global. Present scopes the kind to one workspace, which is
     * both a visibility boundary and a write boundary.
     */
    workspace: RelationField({
      collection: 'Workspaces',
      cascadeDelete: true,
    }).optional(),
    key: TextField({ min: 1, max: 100, pattern: /^[a-z0-9/_-]+$/ }),
    label: TextField({ min: 1, max: 100 }),
    // Any CSS colour the canvas can use for ports and edges of this kind.
    color: TextField({ min: 1, max: 32 }),
    description: TextField({ max: 500 }).optional(),
    // Kinds this one may also connect to, for future cross-kind compatibility
    // (e.g. `power/12v` accepting `power`). Empty means same-kind only.
    compatibleWith: JSONField(z.array(z.string().max(100)).max(50)).optional(),
  })
  .extend(baseSchema);

export const PortKindCollection = defineCollection({
  collectionName: 'PortKinds',
  schema: PortKindSchema,
  permissions: {
    // Global rows stay readable by anyone, including signed-out visitors
    // looking at a public graph. Workspace rows are visible to that workspace
    // only — a private vocabulary is part of what makes it worth having.
    listRule: `workspace = "" || (${SIGNED_IN} && ${memberOf('workspace')})`,
    viewRule: `workspace = "" || (${SIGNED_IN} && ${memberOf('workspace')})`,
    // `workspace != ""` is what keeps the global rows superuser-only: there is
    // no workspace whose membership could admit a caller to them.
    createRule: `${SIGNED_IN} && workspace != "" && ${writerOf('workspace')}`,
    updateRule: `${SIGNED_IN} && workspace != "" && ${writerOf('workspace')}`,
    deleteRule: `${SIGNED_IN} && workspace != "" && ${writerOf('workspace')}`,
  },
  indexes: [
    // Was `UNIQUE (key)`. Scoped, so a workspace may define its own `power`
    // without colliding with the global row it shadows.
    'CREATE UNIQUE INDEX `idx_port_kinds_workspace_key` ON `PortKinds` (`workspace`, `key`)',
    // Non-unique, and named apart from the old `idx_port_kinds_key` it replaces
    // — an index name that means UNIQUE before a migration and non-unique after
    // is a trap for anyone reading the schema history.
    'CREATE INDEX `idx_port_kinds_key_lookup` ON `PortKinds` (`key`)',
  ],
});

export default PortKindCollection;

export type PortKind = z.infer<typeof PortKindSchema>;

export const PortKindInputSchema = z.object({
  /** Omitted for a global kind; only a superuser can write one of those. */
  workspace: z.string().max(64).optional(),
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9/_-]+$/),
  label: z.string().min(1).max(100),
  color: z.string().min(1).max(32),
  description: z.string().max(500).optional(),
  compatibleWith: z.array(z.string().max(100)).max(50).optional(),
});

export type PortKindInput = z.infer<typeof PortKindInputSchema>;

/** Colour used for a port whose kind has no registry row. */
export const FALLBACK_PORT_KIND_COLOR = '#94a3b8';

/** Seeded into `PortKinds`; also the offline fallback the canvas reads. */
export const DEFAULT_PORT_KINDS: PortKindInput[] = [
  {
    key: 'power',
    label: 'Power',
    color: '#f59e0b',
    description: 'DC or AC power distribution',
  },
  {
    key: 'data/canbus',
    label: 'CAN bus',
    color: '#06b6d4',
    description: 'CAN bus data link',
  },
  {
    key: 'data/vbus',
    label: 'VE.Bus',
    color: '#10b981',
    description: 'Victron VE.Bus data link',
  },
  {
    key: 'video/hdmi',
    label: 'HDMI',
    color: '#a855f7',
    description: 'HDMI video output',
  },
];
