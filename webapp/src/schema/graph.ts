import {
  baseSchema,
  defineCollection,
  JSONField,
  RelationField,
  SelectField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import {
  GRAPH_UID_PATTERN,
  MACHINE_NAME_PATTERN,
  NAMESPACE_PATTERN,
  // Relative, not `@/…` — `pocketbase-migrate` imports these files directly
  // through tsx from the repo root, where the webapp path alias is not in scope.
} from '../lib/graph/primitives';

export const GRAPH_VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export type GraphVisibility = (typeof GRAPH_VISIBILITIES)[number];

/**
 * A graph — a system, subsystem, or reusable component library.
 *
 * Every graph is first class: one that is imported by another is still viewable
 * and editable on its own. Graphs hold no edges; connections are derived from
 * port compatibility at render time (see docs/GRAPH_ENGINE.md).
 */
export const GraphSchema = z
  .object({
    owner: RelationField({ collection: 'Users', cascadeDelete: true }),
    // The human-chosen reference key. Was the filename in the JSON-file model
    // and is still what import/export round-trips on.
    uid: TextField({ min: 1, max: 64, pattern: GRAPH_UID_PATTERN }),
    name: TextField({ min: 1, max: 100, pattern: MACHINE_NAME_PATTERN }),
    label: TextField({ min: 1, max: 200 }),
    // A flat grouping label. In the file-based original this was a directory
    // and carried lookup semantics; here it is presentation only.
    namespace: TextField({ max: 32, pattern: NAMESPACE_PATTERN }).optional(),
    description: TextField({ max: 2000 }).optional(),
    // Reuse across users needs a way to publish. Read rules key off this.
    visibility: SelectField(GRAPH_VISIBILITIES),
    tags: JSONField(z.array(z.string().max(50)).max(20)).optional(),
  })
  .extend(baseSchema);

export const GraphCollection = defineCollection({
  collectionName: 'Graphs',
  schema: GraphSchema,
  permissions: {
    // Anything not private is readable, so a graph imported from someone else's
    // library still resolves for the importer.
    listRule:
      '@request.auth.id != "" && (owner = @request.auth.id || visibility != "private")',
    viewRule:
      '@request.auth.id != "" && (owner = @request.auth.id || visibility != "private")',
    // The owner field must match the caller, so mutators inject it on create.
    createRule: '@request.auth.id != "" && owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && owner = @request.auth.id',
  },
  indexes: [
    'CREATE UNIQUE INDEX `idx_graphs_owner_namespace_uid` ON `Graphs` (`owner`, `namespace`, `uid`)',
    'CREATE INDEX `idx_graphs_owner` ON `Graphs` (`owner`)',
    'CREATE INDEX `idx_graphs_visibility` ON `Graphs` (`visibility`)',
  ],
});

export default GraphCollection;

export type Graph = z.infer<typeof GraphSchema>;

/** What the editor submits; `owner` is injected by the mutator. */
export const GraphInputSchema = z.object({
  uid: z
    .string()
    .min(1)
    .max(64)
    .regex(GRAPH_UID_PATTERN, 'Use letters, numbers, dashes or underscores'),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(MACHINE_NAME_PATTERN, 'Use lowercase letters, numbers, underscores'),
  label: z.string().min(1).max(200),
  namespace: z
    .string()
    .regex(NAMESPACE_PATTERN, 'Use lowercase letters and numbers')
    .optional()
    .or(z.literal('')),
  description: z.string().max(2000).optional(),
  visibility: z.enum(GRAPH_VISIBILITIES).default('private'),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export type GraphInput = z.infer<typeof GraphInputSchema>;
