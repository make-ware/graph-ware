import {
  baseSchema,
  defineCollection,
  JSONField,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import {
  AttributeListSchema,
  MACHINE_NAME_PATTERN,
  NodePositionSchema,
  PortListSchema,
  // Relative, not `@/…` — see the note in ./graph.ts.
} from '../lib/graph/primitives';

/**
 * An element inside a graph: a battery, a fuse, a control unit.
 *
 * Hybrid normalization — the node is a record (so it gets access rules,
 * realtime and atomic writes) but its ports and attributes are validated JSON
 * on the record rather than collections of their own. They are always read with
 * their node and never referenced independently, so splitting them out would
 * buy nothing but N+1 reads and non-atomic edits. Rationale: docs/DESIGN.md.
 */
export const GraphNodeSchema = z
  .object({
    graph: RelationField({ collection: 'Graphs', cascadeDelete: true }),
    name: TextField({ min: 1, max: 100, pattern: MACHINE_NAME_PATTERN }),
    label: TextField({ min: 1, max: 200 }),
    attributes: JSONField(AttributeListSchema).optional(),
    ports: JSONField(PortListSchema).optional(),
    // Manual layout override. Absent means the engine's auto-layout decides.
    position: JSONField(NodePositionSchema).optional(),
  })
  .extend(baseSchema);

export const GraphNodeCollection = defineCollection({
  collectionName: 'GraphNodes',
  schema: GraphNodeSchema,
  permissions: {
    // Nested lookups through the parent graph rather than a denormalized owner
    // column — one less thing that can drift out of sync.
    listRule:
      '@request.auth.id != "" && (graph.owner = @request.auth.id || graph.visibility != "private")',
    viewRule:
      '@request.auth.id != "" && (graph.owner = @request.auth.id || graph.visibility != "private")',
    createRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
  },
  indexes: [
    'CREATE INDEX `idx_graph_nodes_graph` ON `GraphNodes` (`graph`)',
    'CREATE UNIQUE INDEX `idx_graph_nodes_graph_name` ON `GraphNodes` (`graph`, `name`)',
  ],
});

export default GraphNodeCollection;

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphNodeInputSchema = z.object({
  graph: z.string().min(1, 'A node must belong to a graph'),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(MACHINE_NAME_PATTERN, 'Use lowercase letters, numbers, underscores'),
  label: z.string().min(1).max(200),
  attributes: AttributeListSchema.optional(),
  ports: PortListSchema.optional(),
  position: NodePositionSchema.optional(),
});

export type GraphNodeInput = z.infer<typeof GraphNodeInputSchema>;
