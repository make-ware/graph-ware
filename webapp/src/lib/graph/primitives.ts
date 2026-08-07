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

/** Normalize an arbitrary label into a machine name. */
export function toMachineName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
