# Graph Engine

The engine turns a resolved tree of graphs into everything the canvas needs:
flat nodes, edges, diagnostics, and positions. None of it is persisted.

**Status: built** (Phase 2). This document is the contract, and
`webapp/src/lib/graph/` implements it: `resolver.ts` loads the tree,
`engine.ts` runs the pipeline, `filters.ts` evaluates filter groups and
`layout.ts` wraps dagre. The primitives it operates on (`primitives.ts`) and
the addressing scheme (`imports.ts`) came from Phase 1.

The engine is pure with respect to the DOM and the network. It takes data and
returns data, which is why it can be unit-tested directly with no browser and no
live PocketBase.

## Pipeline

```
ResolvedGraph
   │  1. flatten
   ▼  FlatNode[]
   │  2. filter          (optional: focus one subgraph)
   ▼
   │  3. auto-connect    match ports by kind, honour one/many, evaluate filters
   ▼  FlatEdge[]
   │  4. apply overrides pin / suppress
   ▼
   │  5. validate        unsatisfied required inputs → diagnostics
   ▼  GraphDiagnostic[]
   │  6. layout          dagre, left-to-right
   ▼  positions
```

## Input

### `ResolvedGraph`

Produced by the resolver from `Graphs`, `GraphImports` and `GraphNodes` records.
Same shape as a stored graph, with imports replaced by loaded children.

```ts
interface ResolvedGraph {
  id: string;
  uid: string;
  name: string;
  label: string;
  namespace?: string;
  nodes: GraphNode[];
  children: ResolvedChild[];
}

interface ResolvedChild {
  alias: string;          // GraphImports.alias — the instance key
  label?: string;         // GraphImports.label
  graph: ResolvedGraph;
}
```

Resolution is breadth-first and batched by depth level; see
[IMPORTS.md § Resolution](IMPORTS.md#resolution). Disabled imports
(`enabled: false`) are omitted. Unreadable children are omitted with a warning
diagnostic rather than failing the render.

## 1. Flatten

Walk the tree depth-first, emitting every node with its provenance.

```ts
interface FlatNode {
  instanceId: string;        // buildInstanceId(instancePath, node.id)
  instancePath: string[];    // import aliases, root → leaf
  nodeId: string;            // the GraphNodes record id
  name: string;
  label: string;
  graphId: string;
  graphUid: string;
  graphName: string;
  graphLabel: string;
  graphNamespace?: string;
  breadcrumb: string[];      // display labels: ["Test Element Data", "Port Battery Bank"]
  graphColorIndex: number;   // stable per-instance index for visual grouping
  attributes: Attribute[];
  ports: Port[];
  position?: NodePosition;   // the stored manual override, root graph only
}
```

Two things that must not be confused:

- **`instanceId` is the identity.** `nodeId` repeats when a graph is imported
  twice. Every downstream structure keys off `instanceId`.
- **`graphColorIndex` is per instance, not per graph.** `port_bank` and
  `starboard_bank` are two visual groups even though they are one
  `BatterySystem`. Assign the index in traversal order so it is stable across
  renders.

`breadcrumb` uses the import's `label` when it has one and the child graph's
`label` otherwise.

`position` is carried through from the `GraphNodes` record, but **only for
nodes on the root graph**. It is stored per record, so an imported node reports
the same coordinates under every alias — honouring it below the root would
stack `port_bank` and `starboard_bank` exactly on top of each other. Imported
instances are laid out instead.

## 2. Filter

Optionally keep only nodes under one instance path — the "focus on this
subgraph" control in the viewer sidebar. Filtering by *instance path*, not graph
id, so focusing `port_bank` does not also select `starboard_bank`.

Filtering happens before connection, so a focused view shows only the wiring
internal to that subtree.

## 3. Auto-connect

For every output port, find the input ports it connects to.

**Compatibility.** An output reaches an input when:

1. `output.kind === input.kind`, or either kind's `compatibleWith` in
   `PortKinds` lists the other — the relation is **symmetric**; and
2. every filter on the input port's attributes passes against the **source
   node's** attributes; and
3. neither side has exhausted its relationship budget; and
4. the two ports are not on the same node instance. `house_fuse` declares
   `supply` in both directions, and a self-loop there carries no meaning.

With no registry loaded, only identical kinds match — the registry is a
presentation aid, so an unregistered kind still wires to its own kind.

**Relationships.**

| | `one` | `many` |
|---|---|---|
| on an **output** | stops after one edge | connects to every match |
| on an **input** | claimed by its first connection | accepts unlimited |

`relationship` is optional in stored data; absent means `one`.

**Filters.** A `FilterGroup` on an input port attribute is evaluated against the
candidate source node's `attributes`:

- `logicalOperator: "AND"` — every condition must pass; `"OR"` — at least one.
- Look up `condition.attribute` by name on the source node. A missing attribute
  **fails** the condition.
- If both the attribute value and `condition.value` parse as finite floats,
  compare numerically.
- Otherwise only `eq` and `neq` apply; `gt`, `gte`, `lt`, `lte` **fail** on
  non-numeric operands rather than falling back to string ordering.

**Determinism.** Nodes are processed in `name` order and, within a node, ports
in declaration order. Candidate targets are considered in the same order.
Matching is greedy — first eligible match wins, no backtracking — so `one`
contention resolves alphabetically. This is a deliberate trade: the same input
must always produce the same picture, and a global optimizer would not.

```ts
interface FlatEdge {
  id: string;                // "edge-{sourceInstanceId}-{sourcePortName}-{targetInstanceId}-{targetPortName}"
  sourceInstanceId: string;
  sourcePortName: string;    // "{portName}-out-{portIndex}" — matches XYFlow handle ids
  targetInstanceId: string;
  targetPortName: string;    // "{portName}-in-{portIndex}"
  kind: string;              // the output port's kind
  origin: 'derived' | 'pinned';
}
```

`portIndex` is the port's index in the node's **full `ports` array**, so
`house_fuse` yields `supply-out-0` and `supply-in-1`. Anything rendering
handles must derive them the same way or the edges will not line up.

## 4. Apply overrides

Load `GraphEdgeOverrides` for the **root** graph only — overrides do not
inherit, because the instance paths under a different parent are different
paths.

`sourcePath` / `targetPath` are matched against `FlatNode.instanceId` — the
whole `buildInstanceId(instancePath, nodeId)` string. `sourcePort` /
`targetPort` are **plain port names**, resolved among the source node's outputs
and the target node's inputs respectively; direction is what tells
`house_fuse`'s two `supply` ports apart.

Suppressions are applied before pins, each in a fixed endpoint order, so the
result never depends on the order the records came back in.

- `suppress` — drop a derived edge whose four endpoint fields match. Freeing the
  target input does **not** re-run matching; suppression removes an edge, it
  does not hand the slot to the runner-up. Keeping the pipeline single-pass
  keeps it predictable.
- `pin` — add an edge between two endpoints regardless of kind, relationship
  budget, or filters, marked `origin: 'pinned'` so the canvas can render it
  distinctly. A pinned edge does satisfy an `isRequired` input.

An override whose instance path or port name matches nothing is a
warning-level diagnostic, not an error: the tree it was recorded against may
have legitimately changed. Stale overrides are surfaced, never silently
dropped.

## 5. Validate

```ts
type DiagnosticLevel = 'error' | 'warning' | 'info';

interface GraphDiagnostic {
  level: DiagnosticLevel;
  code: string;              // stable, e.g. 'required-input-unconnected'
  message: string;
  instanceId?: string;
  path?: string[];           // that node's breadcrumb
}
```

Produced at minimum for:

| code | level | when |
|---|---|---|
| `required-input-unconnected` | error | an `isRequired` input ended with zero edges |
| `unknown-port-kind` | info | a port names a kind with no `PortKinds` row |
| `stale-override` | warning | an override matched no node or port |
| `child-unreadable` | warning | an imported graph could not be loaded |
| `import-disabled` | info | a subtree was skipped via `enabled: false` |
| `import-cycle` | warning | a graph reappeared on its own ancestor chain |
| `resolution-truncated` | warning | `MAX_IMPORT_DEPTH` or `MAX_RESOLVED_NODES` hit |

`import-cycle` cannot normally happen — `pb_hooks/graph-imports.pb.js` refuses
to write one. It exists because a malformed database should degrade to a
warning and a pruned branch rather than an infinite loop.

In a focused view, an override addressing a node outside the focus is out of
frame rather than stale, and produces no diagnostic.

`code` is what the UI keys off; `message` is for humans and may be reworded
freely.

## 6. Layout

Dagre, left-to-right rank direction, fixed node dimensions. Input handles render
on the left, outputs on the right, matching the rank direction.

A node with a stored `position` uses it and is excluded from the auto-layout
pass; the rest lay out around it.

Dagre reports node centres; XYFlow places nodes by their top-left corner, so
`layout.ts` converts and rounds to whole pixels — which is also what lets the
determinism tests compare positions exactly.

`@dagrejs/dagre` is a `webapp` dependency (it ships its own types; the older
`dagre` would need `@types/dagre`). `@xyflow/react` was already installed.

## Testing

The engine is the most testable part of the system and should be the
best-tested. All of it runs under Vitest with no DOM.

- **Flatten** — instance ids for a doubly-imported child; per-instance colour
  indices; breadcrumbs; depth and node-count truncation.
- **Connect** — kind matching; each of the four `one`/`many` combinations;
  numeric filters (the sample Cerbo GX `10 <= voltage <= 15` case); string
  `eq`/`neq`; ordering operators failing on non-numeric values; missing
  attributes failing; determinism across shuffled input.
- **Overrides** — suppress removes exactly one edge and does not reopen
  matching; pin bypasses kind and satisfies a required input; stale overrides
  produce diagnostics.
- **Validate** — a required input satisfied only by a pinned edge is not an
  error.

Fixtures should reuse `example/data/*.json`, which already contains the
interesting cases: a fan-out fuse (`many` in and out), two competing `one`
outputs, and a filtered required input.
