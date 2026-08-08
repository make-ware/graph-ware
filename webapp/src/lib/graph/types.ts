// The data the graph engine consumes and produces.
//
// Everything here is a type except the diagnostic-code list, which is a value
// because the UI keys off it. The record types are imported with `import type`
// on purpose: the engine must not pull the schema layer (and through it
// `pocketbase-zod-schema`) into its runtime, so it stays testable as pure data.
//
// Reference: docs/GRAPH_ENGINE.md

import type { GraphEdgeOverride } from '../../schema/graph-edge-override';
import type { GraphNode } from '../../schema/graph-node';
import type {
  Attribute,
  AttributeOverrideMap,
  NodePosition,
  Port,
} from './primitives';

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticLevel = 'error' | 'warning' | 'info';

/**
 * Stable identifiers the viewer keys off. `message` is for humans and may be
 * reworded freely; a code may not change without changing the UI that reads it.
 */
export const DIAGNOSTIC_CODES = [
  'required-input-unconnected',
  'unknown-port-kind',
  'stale-override',
  'stale-attribute-override',
  'child-unreadable',
  'import-disabled',
  'import-cycle',
  'resolution-truncated',
  'version-unreadable',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface GraphDiagnostic {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  message: string;
  /** The node the diagnostic is about, when it is about one. */
  instanceId?: string;
  /** That node's breadcrumb, so the UI can say where it lives. */
  path?: string[];
}

// ---------------------------------------------------------------------------
// Resolver output
// ---------------------------------------------------------------------------

export interface ResolvedChild {
  /** `GraphImports.alias` — the instance key, and the instance-path segment. */
  alias: string;
  /** `GraphImports.label`, when the import overrides the child's own label. */
  label?: string;
  /**
   * `GraphImports.attributeOverrides` — attribute values this instance replaces
   * on the subtree below it. Applied by `flattenGraph`, before auto-connect.
   */
  attributeOverrides?: AttributeOverrideMap;
  /** The `GraphVersions` id this import is pinned to, when it is pinned. */
  versionId?: string;
  /** `GraphVersions.version` — the number the editor shows as `v3`. */
  versionNumber?: number;
  graph: ResolvedGraph;
}

/** A stored graph with its imports replaced by their loaded children. */
export interface ResolvedGraph {
  id: string;
  uid: string;
  name: string;
  label: string;
  namespace?: string;
  nodes: GraphNode[];
  children: ResolvedChild[];
}

export interface ResolverResult {
  graph: ResolvedGraph | null;
  diagnostics: GraphDiagnostic[];
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export interface FlatNode {
  /** `buildInstanceId(instancePath, nodeId)` — the identity, not `nodeId`. */
  instanceId: string;
  /** Import aliases, root → leaf. Empty for a node on the root graph. */
  instancePath: string[];
  /** The `GraphNodes` record id. Repeats when a graph is imported twice. */
  nodeId: string;
  name: string;
  label: string;
  graphId: string;
  graphUid: string;
  graphName: string;
  graphLabel: string;
  graphNamespace?: string;
  /** Display labels, root → owning graph: ["Test Element Data", "Port Battery Bank"]. */
  breadcrumb: string[];
  /** Stable per *instance*, assigned in traversal order — see docs/GRAPH_ENGINE.md. */
  graphColorIndex: number;
  attributes: Attribute[];
  ports: Port[];
  /** The stored manual layout override, when the record carries one. */
  position?: NodePosition;
}

export interface FlatEdge {
  /** `edge-{sourceInstanceId}-{sourcePortName}-{targetInstanceId}-{targetPortName}` */
  id: string;
  sourceInstanceId: string;
  /** `{portName}-out-{portIndex}` — an XYFlow handle id, not a bare port name. */
  sourcePortName: string;
  targetInstanceId: string;
  /** `{portName}-in-{portIndex}` */
  targetPortName: string;
  kind: string;
  origin: 'derived' | 'pinned';
}

export interface GraphView {
  nodes: FlatNode[];
  edges: FlatEdge[];
  diagnostics: GraphDiagnostic[];
  /** Keyed by `instanceId`; empty when layout is switched off. */
  positions: Record<string, NodePosition>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * What the engine reads off a `PortKinds` row. A full `PortKind` record is
 * assignable to it, so `PortKindMutator.registry()` can be passed straight in.
 */
export interface PortKindInfo {
  key: string;
  compatibleWith?: string[];
}

export type PortKindRegistry = Record<string, PortKindInfo>;

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  rankdir?: 'LR' | 'TB';
  /** Gap between ranks (columns, left to right). */
  ranksep?: number;
  /** Gap between nodes within a rank. */
  nodesep?: number;
}

export interface EngineOptions {
  /** The **root** graph's overrides. Overrides do not inherit. */
  overrides?: readonly GraphEdgeOverride[];
  /**
   * Omitted means "no registry was loaded": kinds match only when identical,
   * and `unknown-port-kind` is not reported rather than reported for every port.
   */
  portKinds?: PortKindRegistry;
  /** Keep only nodes under this instance path. Empty keeps everything. */
  focus?: readonly string[];
  /** Diagnostics from the resolver, carried through into the view. */
  diagnostics?: readonly GraphDiagnostic[];
  /** `false` skips the layout pass and returns no positions. */
  layout?: LayoutOptions | false;
}
