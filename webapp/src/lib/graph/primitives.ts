// Value objects for the graph model.
//
// These are the shapes stored as JSON on a GraphNode record (`attributes`,
// `ports`) plus the small vocabulary the graph engine reasons about. They are
// deliberately NOT in `webapp/src/schema/` — `pocketbase-migrate` discovers
// collection definitions by scanning that directory, and a file with no
// `defineCollection` export has no business being scanned. `schema/graph-node.ts`
// imports from here and wraps these with `JSONField(...)`.
//
// Reference: docs/DATA_MODEL.md

import { z } from 'zod';

/**
 * How deep a chain of child-graph imports may go, root included.
 *
 * Enforced authoritatively by `pocketbase/pb_hooks/graph-imports.pb.js` and
 * mirrored client-side in `lib/graph/imports.ts`. Keep the two in sync.
 */
export const MAX_IMPORT_DEPTH = 8;

/**
 * Upper bound on nodes in a single resolved tree. The resolver stops walking
 * past this and emits a diagnostic rather than melting the browser on a graph
 * that fans out pathologically.
 */
export const MAX_RESOLVED_NODES = 2000;

/** Separator between segments of an instance path. */
export const INSTANCE_PATH_SEPARATOR = '/';

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/**
 * A named value on a node.
 *
 * `value` is always a string. The engine parses it as a float when both sides
 * of a filter comparison look numeric, and falls back to string comparison
 * otherwise — see `docs/GRAPH_ENGINE.md`.
 */
export const AttributeSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().max(500),
  unit: z.string().max(50).optional(),
  kind: z.string().min(1).max(100),
});

export type Attribute = z.infer<typeof AttributeSchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const COMPARISON_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;

export const ComparisonOperatorSchema = z.enum(COMPARISON_OPERATORS);
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;

/** Operators that only make sense against numbers. */
export const ORDERING_OPERATORS: readonly ComparisonOperator[] = [
  'gt',
  'gte',
  'lt',
  'lte',
];

export const LOGICAL_OPERATORS = ['AND', 'OR'] as const;
export const LogicalOperatorSchema = z.enum(LOGICAL_OPERATORS);
export type LogicalOperator = z.infer<typeof LogicalOperatorSchema>;

/**
 * One constraint on a candidate source node's attributes.
 *
 * `attribute` names an attribute on the *source node*, not on the source port.
 */
export const FilterConditionSchema = z.object({
  attribute: z.string().min(1).max(100),
  value: z.string().max(500),
  operator: ComparisonOperatorSchema,
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export const FilterGroupSchema = z.object({
  logicalOperator: LogicalOperatorSchema,
  conditions: z.array(FilterConditionSchema).min(1).max(50),
});

export type FilterGroup = z.infer<typeof FilterGroupSchema>;

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export const PORT_DIRECTIONS = ['input', 'output'] as const;
export const PortDirectionSchema = z.enum(PORT_DIRECTIONS);
export type PortDirection = z.infer<typeof PortDirectionSchema>;

export const PORT_RELATIONSHIPS = ['one', 'many'] as const;
export const PortRelationshipSchema = z.enum(PORT_RELATIONSHIPS);
export type PortRelationship = z.infer<typeof PortRelationshipSchema>;

/** `relationship` is optional in stored data; absent means `one`. */
export const DEFAULT_PORT_RELATIONSHIP: PortRelationship = 'one';

/**
 * An inline spec on a port, optionally carrying a filter.
 *
 * On an **input** port, `filter` constrains which source nodes may connect. On
 * an output port a filter is ignored by the engine.
 */
export const PortAttributeSchema = AttributeSchema.extend({
  filter: FilterGroupSchema.optional(),
});

export type PortAttribute = z.infer<typeof PortAttributeSchema>;

/**
 * A connection point on a node.
 *
 * `kind` is the compatibility key: an output connects only to inputs of the
 * same kind (or a kind listed in that kind's `compatibleWith`, see the
 * `PortKinds` collection). Port names are unique per direction on a node, so
 * `supply` may exist once as an input and once as an output — that is exactly
 * how the sample `house_fuse` is modelled.
 */
export const PortSchema = z.object({
  name: z.string().min(1).max(100),
  direction: PortDirectionSchema,
  kind: z.string().min(1).max(100),
  relationship: PortRelationshipSchema.optional(),
  /** Inputs only: an unconnected required input becomes an error diagnostic. */
  isRequired: z.boolean().optional(),
  attributes: z.array(PortAttributeSchema).max(50).optional(),
});

export type Port = z.infer<typeof PortSchema>;

// ---------------------------------------------------------------------------
// Per-import attribute overrides
// ---------------------------------------------------------------------------

/**
 * Attribute values one import instance replaces on the graph it pulls in.
 *
 * Stored on `GraphImports.attributeOverrides`, so `starboard_bank` can run at
 * 24 V while `port_bank` — the same `BatterySystem` record — stays at 12 V,
 * without forking the child.
 *
 * Keys are **instance ids relative to the import**: the alias chain below this
 * import plus the `GraphNodes` record id, exactly what `buildInstanceId`
 * produces. For a node on the imported graph itself that is just the node id;
 * `cells/NODEID` reaches a node one import deeper. Record ids rather than node
 * names, for the same reason `GraphEdgeOverrides` uses them — a rename must not
 * silently detach the override.
 *
 * Values name an attribute on that node and give its replacement `value`. An
 * override can only *replace* an existing attribute, never introduce one: a new
 * attribute would need a `kind` the override has nowhere to put, and a typo
 * would silently become data. Keys that match nothing surface as a
 * `stale-attribute-override` diagnostic.
 */
export const AttributeOverrideMapSchema = z.record(
  z.string().min(1).max(500),
  z.record(z.string().min(1).max(100), z.string().max(500))
);

export type AttributeOverrideMap = z.infer<typeof AttributeOverrideMapSchema>;

// ---------------------------------------------------------------------------
// Node payloads (what a GraphNode record actually stores)
// ---------------------------------------------------------------------------

export const AttributeListSchema = z.array(AttributeSchema).max(100);
export const PortListSchema = z.array(PortSchema).max(100);

/** Optional manual layout override; auto-layout runs when this is absent. */
export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export type NodePosition = z.infer<typeof NodePositionSchema>;

// ---------------------------------------------------------------------------
// Version snapshots
// ---------------------------------------------------------------------------

/**
 * The current `GraphSnapshot.format`. Bump it when the payload shape changes;
 * `restoreSnapshot` refuses a format it does not understand rather than
 * half-restoring one.
 */
export const GRAPH_SNAPSHOT_FORMAT = 1;

/**
 * A `GraphNodes` record as it appears inside a snapshot.
 *
 * **`id` is the original record id, and that is load-bearing.** Instance paths
 * — and therefore every `GraphEdgeOverride` on the parent — end in a node id.
 * Preserving it is what lets an import be pinned to an old version without
 * every override underneath it going stale.
 */
export const SnapshotNodeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  attributes: z.array(AttributeSchema).max(100).optional(),
  ports: z.array(PortSchema).max(100).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export type SnapshotNode = z.infer<typeof SnapshotNodeSchema>;

/** A `GraphImports` row as it appears inside a snapshot. */
export const SnapshotImportSchema = z.object({
  id: z.string().min(1).max(64),
  child: z.string().min(1).max(64),
  alias: z.string().min(1).max(40),
  label: z.string().max(200).optional(),
  order: z.number().int().min(0),
  enabled: z.boolean(),
  /** A pin the snapshotted graph itself carried, preserved verbatim. */
  version: z.string().max(64).optional(),
  attributeOverrides: AttributeOverrideMapSchema.optional(),
});

export type SnapshotImport = z.infer<typeof SnapshotImportSchema>;

/**
 * One immutable picture of a graph, stored as JSON on `GraphVersions.snapshot`.
 *
 * A blob rather than a second set of records because a version is never queried
 * field by field — it is written once, read whole, and restored whole.
 *
 * **The snapshot is one level deep.** It captures the graph's own nodes and its
 * own import rows; the graphs those imports name are *not* copied into it. So a
 * pinned import renders the child exactly as it was, while the child's own
 * children keep resolving live unless they carried pins of their own. Freezing
 * transitively is the correct-in-principle alternative and was rejected on
 * cost: every publish would copy the entire subtree, and a shared library graph
 * would be duplicated into every snapshot that reaches it. See
 * docs/IMPORTS.md § Pinned imports.
 */
export const GraphSnapshotSchema = z.object({
  format: z.number().int().min(1),
  /** The graph's own descriptive fields, so a restore can put them back. */
  graph: z.object({
    uid: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    namespace: z.string().max(32).optional(),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
  nodes: z.array(SnapshotNodeSchema).max(1000),
  imports: z.array(SnapshotImportSchema).max(200),
});

export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

// ---------------------------------------------------------------------------
// Instance paths
// ---------------------------------------------------------------------------

/**
 * The chain of `GraphImports.alias` values from the root graph down to the
 * graph that owns a node. Empty for nodes on the root graph itself.
 *
 * A child graph can be imported more than once, so a record id is NOT a unique
 * handle on a node in a resolved tree — the instance path is. See
 * `buildInstanceId` in `lib/graph/imports.ts`.
 */
export const InstancePathSchema = z.array(
  z.string().regex(/^[a-z0-9_]{1,40}$/)
);

export type InstancePath = z.infer<typeof InstancePathSchema>;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Machine names: snake_case, used for deterministic sorting and addressing. */
export const MACHINE_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Graph UIDs: the human-chosen reference key, kept for import/export. */
export const GRAPH_UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Namespaces: a flat grouping label, lowercase alphanumeric. */
export const NAMESPACE_PATTERN = /^[a-z0-9]{1,32}$/;

/** Import aliases: the per-parent instance key. */
export const IMPORT_ALIAS_PATTERN = /^[a-z0-9_]{1,40}$/;

/**
 * Workspace slugs: the URL segment a workspace is addressed by.
 *
 * Dashes rather than underscores, and never at either end — this one appears in
 * a path (`/workspaces/north-sea`), unlike the machine names above.
 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Normalize an arbitrary label into a machine name. */
export function toMachineName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Normalize an arbitrary label into a workspace slug. */
export function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
