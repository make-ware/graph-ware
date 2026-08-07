import {
  baseSchema,
  defineCollection,
  RelationField,
  SelectField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';

export const EDGE_OVERRIDE_MODES = ['pin', 'suppress'] as const;
export type EdgeOverrideMode = (typeof EDGE_OVERRIDE_MODES)[number];

/**
 * A correction to the derived wiring — the escape hatch.
 *
 * Edges are still not stored. Auto-connect from port compatibility remains the
 * whole model; an override only says "also connect these two" (`pin`) or "not
 * these two" (`suppress`) in the context of one root graph. When the rules can
 * express the intent, extend port kinds and filters instead — an override is a
 * local patch, and `reason` exists so it reads as one.
 *
 * Endpoints are addressed by **instance path**, not record id: the same node
 * appears once per import instance, and an override must target exactly one of
 * them. See docs/DATA_MODEL.md § Instance identity.
 */
export const GraphEdgeOverrideSchema = z
  .object({
    // The graph the override applies *in*. Overrides are contextual: the same
    // subgraph wired differently under two parents is the normal case.
    graph: RelationField({ collection: 'Graphs', cascadeDelete: true }),
    mode: SelectField(EDGE_OVERRIDE_MODES),
    sourcePath: TextField({ min: 1, max: 500 }),
    sourcePort: TextField({ min: 1, max: 100 }),
    targetPath: TextField({ min: 1, max: 500 }),
    targetPort: TextField({ min: 1, max: 100 }),
    reason: TextField({ max: 500 }).optional(),
  })
  .extend(baseSchema);

export const GraphEdgeOverrideCollection = defineCollection({
  collectionName: 'GraphEdgeOverrides',
  schema: GraphEdgeOverrideSchema,
  permissions: {
    listRule:
      '@request.auth.id != "" && (graph.owner = @request.auth.id || graph.visibility != "private")',
    viewRule:
      '@request.auth.id != "" && (graph.owner = @request.auth.id || graph.visibility != "private")',
    createRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && graph.owner = @request.auth.id',
  },
  indexes: [
    'CREATE INDEX `idx_graph_edge_overrides_graph` ON `GraphEdgeOverrides` (`graph`)',
    'CREATE UNIQUE INDEX `idx_graph_edge_overrides_endpoints` ON `GraphEdgeOverrides` (`graph`, `sourcePath`, `sourcePort`, `targetPath`, `targetPort`)',
  ],
});

export default GraphEdgeOverrideCollection;

export type GraphEdgeOverride = z.infer<typeof GraphEdgeOverrideSchema>;

export const GraphEdgeOverrideInputSchema = z.object({
  graph: z.string().min(1),
  mode: z.enum(EDGE_OVERRIDE_MODES),
  sourcePath: z.string().min(1).max(500),
  sourcePort: z.string().min(1).max(100),
  targetPath: z.string().min(1).max(500),
  targetPort: z.string().min(1).max(100),
  reason: z.string().max(500).optional(),
});

export type GraphEdgeOverrideInput = z.infer<
  typeof GraphEdgeOverrideInputSchema
>;
