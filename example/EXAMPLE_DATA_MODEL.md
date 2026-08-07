# Node-Ware Data Model

Reference for the graph data model. Source of truth: `src/graph/types.ts` (types), `src/store.ts` (persistence), `src/graph/graph-engine.ts` (derived structures).

## Core invariants

- Every graph and node has an `id` — a CUID generated with `@paralleldrive/cuid2`, unique and opaque.
- Every graph additionally has a `uid` — the human-chosen key used as its **filename** and as the **reference key** in `childGraphs` (e.g. `BatterySystem`).
- Graphs reference children by UID in `childGraphs`, **never by embedding them inline**. This lets one subgraph be reused by multiple parents.
- Edges are **not part of the stored model**. Connections are derived at render time by the graph engine from port compatibility (see [Derived model](#derived-model-engine-output)).
- A `namespace` is an optional grouping string matching `^[a-z0-9]+$`, mapped to a directory on disk.

## Storage layout

Each graph is one JSON file:

```
data/graphs/{namespace}/{uid}.json    # namespaced graph
data/graphs/{uid}.json                # graph without namespace
```

The namespace directory is authoritative: when a file's JSON lacks a `namespace` field, the store fills it in from the directory it was found in. Child resolution (`resolveGraph`) looks up each `childGraphs` UID in the parent's namespace first.

## Stored types

### `Graph` — the persisted form

```ts
interface Graph {
  id: string;            // CUID
  uid: string;           // filename / reference key
  name: string;          // machine name, e.g. "battery_system"
  label: string;         // display name, e.g. "Battery System"
  namespace?: string;    // a-z0-9 only; maps to a directory
  elements?: GraphNode[];
  childGraphs?: string[]; // UIDs of child graphs (references, not data)
}
```

### `GraphNode` — an element inside a graph

```ts
interface GraphNode {
  id: string;      // CUID
  name: string;    // machine name, e.g. "house_battery_1"
  label: string;   // display name
  attributes?: Attribute[];
  ports?: Port[];
}
```

### `Attribute` — a named value on a node

```ts
interface Attribute {
  name: string;   // e.g. "voltage"
  value: string;  // always a string; parsed as float for comparisons when numeric
  unit?: string;  // e.g. "volts"
  kind: string;   // domain tag, e.g. "power"
}
```

### `Port` — a connection point on a node

```ts
type PortDirection = "input" | "output";
type PortRelationship = "one" | "many";

interface Port {
  name: string;                    // e.g. "supply"
  direction: PortDirection;
  kind: string;                    // connection type, e.g. "power", "data/canbus", "video/hdmi"
  relationship?: PortRelationship; // defaults to "one" when absent
  isRequired?: boolean;            // inputs only: unconnected required inputs produce an error diagnostic
  attributes?: PortAttribute[];    // inline specs, optionally with filters
}
```

Port semantics used by the engine:

- `kind` is the compatibility key — an output only connects to inputs of the **same** `kind`.
- `relationship` on an **output** limits how many inputs it fans out to (`one` → 1 edge, `many` → all matches).
- `relationship` on an **input** controls whether it can be claimed by multiple outputs (`one` → first connection claims it, `many` → unlimited).
- `isRequired` on an input that ends up with zero connections yields an `error`-level `GraphDiagnostic`.

### `PortAttribute` — inline spec on a port, with optional filter

```ts
interface PortAttribute {
  name: string;
  value: string;
  unit?: string;
  kind: string;
  filter?: FilterGroup;  // constraint evaluated against a candidate SOURCE node's attributes
}
```

### Filters — connection constraints

```ts
type ComparisonOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
type LogicalOperator = "AND" | "OR";

interface FilterCondition {
  attribute: string;  // name of an attribute on the candidate source node
  value: string;
  operator: ComparisonOperator;
}

interface FilterGroup {
  logicalOperator: LogicalOperator;  // how conditions combine
  conditions: FilterCondition[];
}
```

Filters live on **input** port attributes and are evaluated against the **source node's** (not port's) attributes during auto-connect. Values are compared numerically when both sides parse as floats; otherwise only `eq`/`neq` string comparison applies (ordering operators fail). A missing attribute fails the condition. Example: a Cerbo GX `supply` input accepts only sources with `10 <= voltage <= 15`.

## Resolved model

### `ResolvedGraph` — engine input form

Produced by `resolveGraph(uid)` in the store (`GET /api/graphs/:uid/resolved`): same shape as `Graph`, but `childGraphs` (UIDs) is replaced by `children: ResolvedGraph[]` with each child recursively loaded from its own file. Circular references are detected via a visited set and skipped with a warning; missing children are skipped with a warning.

```ts
interface ResolvedGraph {
  id: string;
  uid: string;
  name: string;
  label: string;
  namespace?: string;
  elements?: GraphNode[];
  children: ResolvedGraph[];  // fully loaded, recursive
}
```

## Derived model (engine output)

`GraphEngineService.process(resolvedGraph)` flattens the tree and derives connections. These types are never persisted — they exist only for rendering (XYFlow) and validation.

### `FlatNode`

Every element from the whole resolved tree, flattened into one list with provenance:

```ts
interface FlatNode {
  id: string;
  name: string;
  label: string;
  graphRef: string;         // owning graph's name — used for subgraph filtering
  graphUid: string;
  graphName: string;
  graphNamespace?: string;
  breadcrumb: string[];     // path of graph names from root, e.g. ["test", "battery_system"]
  graphColorIndex: number;  // stable per-subgraph index for visual grouping
  attributes: Attribute[];
  ports: Port[];
}
```

### `FlatEdge`

Auto-derived connections (deterministic: nodes and matches are processed in name-sorted order):

```ts
interface FlatEdge {
  id: string;              // "edge-{srcNode}-{srcPort}-{srcIdx}-{dstNode}-{dstPort}-{dstIdx}"
  sourceNodeId: string;
  sourcePortName: string;  // "{portName}-out-{portIndex}" — matches XYFlow handle ids
  targetNodeId: string;
  targetPortName: string;  // "{portName}-in-{portIndex}"
  kind: string;
}
```

### `GraphDiagnostic`

Validation output, currently produced for unconnected required inputs:

```ts
type DiagnosticLevel = "error" | "warning" | "info";

interface GraphDiagnostic {
  level: DiagnosticLevel;
  message: string;
  nodeId?: string;   // offending node
  path?: string[];   // that node's breadcrumb
}
```

## Summary type

### `GraphIndex` — list-endpoint projection

Returned by `GET /api/graphs` for the dashboard; a lightweight summary, not the full graph:

```ts
interface GraphIndex {
  id: string;
  uid: string;
  name: string;
  label: string;
  namespace?: string;
  childGraphCount: number;
  elementCount: number;
}
```

## Example

A minimal namespaced graph file, `data/graphs/test/BatterySystem.json`:

```json
{
  "id": "tz4a98xxat96iws9zmbrgj3a",
  "uid": "BatterySystem",
  "name": "battery_system",
  "label": "Battery System",
  "namespace": "test",
  "elements": [
    {
      "id": "pfh0haxfpzowht3oi213cqos",
      "name": "house_battery_1",
      "label": "House Battery 1",
      "attributes": [
        { "name": "voltage", "value": "12", "unit": "volts", "kind": "power" }
      ],
      "ports": [
        { "name": "supply", "direction": "output", "relationship": "one", "kind": "power" }
      ]
    }
  ],
  "childGraphs": []
}
```

A parent references it by UID only:

```json
{
  "uid": "testDataElement",
  "name": "test",
  "label": "Test Element Data",
  "namespace": "test",
  "elements": [],
  "childGraphs": ["BatterySystem", "EngineSystem"]
}
```
