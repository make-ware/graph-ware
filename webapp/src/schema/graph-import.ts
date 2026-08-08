import {
  baseSchema,
  BoolField,
  defineCollection,
  NumberField,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
// Relative, not `@/…` — see the note in ./graph.ts.
import { IMPORT_ALIAS_PATTERN } from '../lib/graph/primitives';

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
  })
  .extend(baseSchema);

export const GraphImportCollection = defineCollection({
  collectionName: 'GraphImports',
  schema: GraphImportSchema,
  permissions: {
    listRule:
      '@request.auth.id != "" && (parent.owner = @request.auth.id || parent.visibility != "private")',
    viewRule:
      '@request.auth.id != "" && (parent.owner = @request.auth.id || parent.visibility != "private")',
    // Own the parent, and be allowed to see the child you are pulling in.
    createRule:
      '@request.auth.id != "" && parent.owner = @request.auth.id && (child.owner = @request.auth.id || child.visibility != "private")',
    updateRule:
      '@request.auth.id != "" && parent.owner = @request.auth.id && (child.owner = @request.auth.id || child.visibility != "private")',
    deleteRule: '@request.auth.id != "" && parent.owner = @request.auth.id',
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
});

export type GraphImportInput = z.infer<typeof GraphImportInputSchema>;
