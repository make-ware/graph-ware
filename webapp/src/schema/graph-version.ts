import {
  baseSchema,
  defineCollection,
  JSONField,
  NumberField,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import {
  GraphSnapshotSchema,
  // Relative, not `@/…` — see the note in ./graph.ts.
} from '../lib/graph/primitives';
import { graphReadable, graphWritable } from './permissions';

/**
 * An immutable picture of a graph at a moment — what a pinned import renders.
 *
 * Taken on publish, and before a destructive edit, so that "I depend on this
 * component" can mean a specific state of it rather than whatever its author
 * happens to have saved this morning.
 *
 * `snapshot` is JSON, not a second set of records, because a version is never
 * queried field by field: it is written once, read whole, and restored whole.
 * Records would buy queryability nobody wants and cost a full copy of the node
 * table per publish. See docs/DATA_MODEL.md § Versions.
 *
 * There is no update rule. A version that can be edited is not a version.
 */
export const GraphVersionSchema = z
  .object({
    graph: RelationField({ collection: 'Graphs', cascadeDelete: true }),
    // Monotonic per graph, allocated by `GraphVersionMutator.publish`.
    version: NumberField({ min: 1, noDecimal: true, required: true }),
    snapshot: JSONField(GraphSnapshotSchema, { maxSize: '5M' }),
    note: TextField({ max: 500 }).optional(),
    createdBy: RelationField({ collection: 'Users', cascadeDelete: false }),
  })
  .extend(baseSchema);

export const GraphVersionCollection = defineCollection({
  collectionName: 'GraphVersions',
  schema: GraphVersionSchema,
  permissions: {
    // Same reach as the graph itself: pinning an import to a version of
    // somebody else's published component has to be able to *read* it.
    listRule: graphReadable('graph'),
    viewRule: graphReadable('graph'),
    createRule: `${graphWritable('graph')} && createdBy = @request.auth.id`,
    // Immutable by construction. Nothing may edit a snapshot, including its
    // author — pins would silently change meaning underneath their importers.
    updateRule: null,
    deleteRule: graphWritable('graph'),
  },
  indexes: [
    'CREATE UNIQUE INDEX `idx_graph_versions_graph_version` ON `GraphVersions` (`graph`, `version`)',
    'CREATE INDEX `idx_graph_versions_graph` ON `GraphVersions` (`graph`)',
  ],
});

export default GraphVersionCollection;

export type GraphVersion = z.infer<typeof GraphVersionSchema>;

/** What `publish` submits; `createdBy` and `version` are allocated for it. */
export const GraphVersionInputSchema = z.object({
  graph: z.string().min(1),
  version: z.number().int().min(1),
  snapshot: GraphSnapshotSchema,
  note: z.string().max(500).optional(),
  createdBy: z.string().min(1),
});

export type GraphVersionInput = z.infer<typeof GraphVersionInputSchema>;

/** `v3` — how a version is labelled everywhere in the UI. */
export function formatVersion(version: Pick<GraphVersion, 'version'>): string {
  return `v${version.version}`;
}
