import {
  baseSchema,
  defineCollection,
  JSONField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';

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
 * Globally readable, superuser-write: kinds are shared vocabulary, and letting
 * one user rename `power` under another user's feet would be worse than the
 * inconvenience of an admin-managed list. Per-user kinds are Phase 5.
 */
export const PortKindSchema = z
  .object({
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
    // Readable by anyone, including signed-out visitors looking at a public graph.
    listRule: '',
    viewRule: '',
    // null → superusers only.
    createRule: null,
    updateRule: null,
    deleteRule: null,
  },
  indexes: ['CREATE UNIQUE INDEX `idx_port_kinds_key` ON `PortKinds` (`key`)'],
});

export default PortKindCollection;

export type PortKind = z.infer<typeof PortKindSchema>;

export const PortKindInputSchema = z.object({
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
