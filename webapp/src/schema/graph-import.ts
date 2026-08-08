import {
  baseSchema,
  BoolField,
  defineCollection,
  JSONField,
  NumberField,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
// Relative, not `@/…` — see the note in ./graph.ts.
import {
  AttributeOverrideMapSchema,
  IMPORT_ALIAS_PATTERN,
} from '../lib/graph/primitives';
import { graphReadable, memberOf, SIGNED_IN, writerOf } from './permissions';

/**
 * One graph importing another — the reuse mechanism.
 *
 * This replaces the `childGraphs: string[]` array of the file-based model. A
 * join record instead of a relation array buys the thing that array could not
 * do: importing the *same* child twice. A boat with a port and a starboard
 * battery bank is two `GraphImports` rows pointing at one `BatterySystem`,
 * distinguished by `alias`.
 *
 * `alias` is therefore load-bearing, not decoration: it is the segment that
 * appears in every instance path the engine and `GraphEdgeOverrides` address
 * nodes by. See docs/IMPORTS.md.
 *
 * Cycles and nesting depth cannot be expressed as an API rule — PocketBase
 * rules cannot walk an ancestor chain — so they are enforced by the hook in
 * `pocketbase/pb_hooks/graph-imports.pb.js`.
 */
export const GraphImportSchema = z
  .object({
    parent: RelationField({ collection: 'Graphs', cascadeDelete: true }),
    child: RelationField({ collection: 'Graphs', cascadeDelete: true }),
    alias: TextField({ min: 1, max: 40, pattern: IMPORT_ALIAS_PATTERN }),
    label: TextField({ max: 200 }).optional(),
    order: NumberField({ min: 0, noDecimal: true }),
    // Exclude a subtree from resolution without losing the link.
    //
    // `.optional()` is load-bearing, not laxity. A *required* bool in
    // PocketBase means "must be true": `false` is indistinguishable from blank,
    // so the API rejects it with `validation_required`. A required `enabled`
    // could therefore never be switched off, which is the only thing the field
    // is for. Records still always carry a value — PocketBase stores `false`
    // rather than null, and `GraphImportInputSchema` defaults it to `true`.
    enabled: BoolField().optional(),
    /**
     * Pin this import to one `GraphVersions` snapshot. Absent means live.
     *
     * Live is the default on purpose. Defaulting to pinned would freeze every
     * import that exists at whatever the child happened to be, and a library
     * whose components never move is a dead one. Pinning is the deliberate act,
     * for the systems that need it.
     *
     * `cascadeDelete: false`: deleting a version must not delete the import
     * that pinned it. The resolver reports a dangling pin and falls back to
     * live rather than silently losing the link.
     */
    version: RelationField({
      collection: 'GraphVersions',
      cascadeDelete: false,
    }).optional(),
    /**
     * Attribute values this instance replaces on the graph it pulls in, so
     * `starboard_bank` can run at 24 V without forking `BatterySystem`.
     *
     * Applied during flatten, **before** auto-connect, so an overridden value
     * is what input-port filters are evaluated against — otherwise a voltage
     * override would change the label and not the wiring. That is a Phase 2
     * contract change; see docs/GRAPH_ENGINE.md § 1. Flatten.
     */
    attributeOverrides: JSONField(AttributeOverrideMapSchema).optional(),
  })
  .extend(baseSchema);

export const GraphImportCollection = defineCollection({
  collectionName: 'GraphImports',
  schema: GraphImportSchema,
  permissions: {
    listRule: graphReadable('parent'),
    viewRule: graphReadable('parent'),
    // Write the parent, and be allowed to see the child you are pulling in.
    createRule: `${SIGNED_IN} && ${writerOf('parent.workspace')} && (child.visibility != "private" || ${memberOf('child.workspace')})`,
    updateRule: `${SIGNED_IN} && ${writerOf('parent.workspace')} && (child.visibility != "private" || ${memberOf('child.workspace')})`,
    deleteRule: `${SIGNED_IN} && ${writerOf('parent.workspace')}`,
  },
  indexes: [
    'CREATE UNIQUE INDEX `idx_graph_imports_parent_alias` ON `GraphImports` (`parent`, `alias`)',
    // Backs "which graphs import this one?" via GraphImports_via_child — the
    // impact check the editor runs before deleting a graph.
    'CREATE INDEX `idx_graph_imports_child` ON `GraphImports` (`child`)',
  ],
});

export default GraphImportCollection;

export type GraphImport = z.infer<typeof GraphImportSchema>;

export const GraphImportInputSchema = z.object({
  parent: z.string().min(1),
  child: z.string().min(1),
  alias: z
    .string()
    .min(1)
    .max(40)
    .regex(IMPORT_ALIAS_PATTERN, 'Use lowercase letters, numbers, underscores'),
  label: z.string().max(200).optional(),
  order: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  version: z.string().max(64).optional(),
  attributeOverrides: AttributeOverrideMapSchema.optional(),
});

export type GraphImportInput = z.infer<typeof GraphImportInputSchema>;
