# Node-Ware Design

Node-Ware is a graph editor and viewer for hardware-like systems — boats, circuits, power systems — where components have typed connection points and the wiring between them follows rules rather than being drawn by hand.

Companion documents: `DATA_MODEL.md` (type-by-type reference), `CLAUDE.md` (dev workflow).

## Design principles

**1. Connections are derived, not drawn.**
The stored model contains nodes with ports; it contains no edges. Every edge is computed at render time by the graph engine from port compatibility: an output port connects to input ports of the same `kind`, subject to one/many relationship limits and attribute filters. This is the central design decision — the graph describes *what components are and what they accept/provide*, and the wiring falls out of that. Consequences:

- Editing means editing nodes and ports, never edge lists. There is no "connect" gesture in the UI.
- Validation is a natural byproduct: a required input that no compatible output satisfies is an error diagnostic, surfaced per-node with its breadcrumb path.
- Determinism matters. Nodes and candidate matches are processed in name-sorted order so the same data always yields the same wiring and layout.

**2. Graphs compose by reference.**
A graph lists child graphs by UID (`childGraphs: ["BatterySystem", ...]`), never by embedding. A subgraph like `BatterySystem` is a first-class graph — viewable, editable, and reusable by multiple parents. Resolution (recursively loading children into a tree) happens server-side on demand, with circular-reference and missing-child protection.

**3. Files are the database.**
One JSON file per graph at `data/graphs/{namespace}/{uid}.json`. Namespaces are just directories (validated `a-z0-9`). This keeps the store human-readable, diffable, and git-friendly — sample datasets (`test/`, `boat/`, `circuit/`) live in the repo as plain files. There is no database, no migrations, and the whole store layer is one file (`src/store.ts`).

**4. One process, one runtime.**
A single `Bun.serve()` process serves the REST API and the React SPA (HTML imports, no separate bundler dev server). Bun is used for everything: runtime, bundler, test runner.

## System architecture

```
data/graphs/**/*.json
        │  read/write/resolve
        ▼
src/store.ts ──────────── file CRUD + recursive resolve + seed
        │
        ▼
src/index.ts ──────────── Bun.serve(): /api/* routes + SPA fallback
        │  JSON over HTTP
        ▼
src/api/api.ts ────────── frontend API client (all fetch calls live here)
        │
        ▼
pages/ + components/ ──── React Router pages, viewer/editor UI
        │  ResolvedGraph
        ▼
src/graph/graph-engine.ts  flatten → auto-connect → validate → layout
        │  FlatNode[] / FlatEdge[] / positions / diagnostics
        ▼
graph-canvas.tsx ───────── XYFlow rendering
```

### The engine pipeline

`GraphEngineService.process(resolvedGraph, filterGraphRef?)` runs client-side in four steps:

1. **Flatten** — walk the resolved tree depth-first, emitting every element as a `FlatNode` stamped with provenance: breadcrumb path, owning graph, and a stable color index per subgraph (used for visual grouping badges).
2. **Filter** — optionally keep only nodes belonging to one subgraph ref (drives the sidebar's "focus on child graph" feature).
3. **Auto-connect & validate** — match outputs to inputs by `kind`; enforce `relationship` (`one` outputs stop after one edge, `one` inputs are claimed by their first connection); evaluate input-port attribute filters against candidate source-node attributes (numeric comparison when both sides parse as numbers). Unsatisfied `isRequired` inputs become error diagnostics.
4. **Layout** — dagre, left-to-right rank direction, fixed node dimensions (280×120).

The engine is pure with respect to the DOM and network — it takes a `ResolvedGraph` and returns data — which is why it can be unit-tested directly (`src/graph/graph-engine.test.ts`) without any browser setup.

### Where computation lives

- **Server**: persistence and *resolution* (turning UID references into a loaded tree). The server never computes edges or layout.
- **Client**: everything visual — flattening, connection, validation, layout — recomputed from the resolved graph on each load or filter change.

This split means the API stays a thin CRUD layer over files, and connection semantics can evolve without touching the server.

## Frontend design

- **Routing** (`src/App.tsx`): every route has a namespace-prefixed twin under `/n/:namespace/...`. The viewer (`/graphs/:uid`) uses its own full-bleed layout (sidebar + canvas + detail panel); all other pages share `AppLayout` with a top nav.
- **Viewer** (`GraphViewerPage`): sidebar lists all graphs (every graph is first-class, including children); selecting a subgraph in the sidebar filters the canvas via `filterGraphRef`. Selecting a node or edge on the canvas opens the detail panel (`graph-panel.tsx`).
- **Editor** (`GraphEditorPage`): edits the *stored* form — metadata, child-graph UID references, and the node list. Node editing happens in `NodeEditorModal` (label/name, attributes, ports). Because edges are derived, the editor never touches connections; the live preview link shows the resulting wiring.
- **Visual encoding**: subgraph membership is color-coded via `graphColorIndex` (8-color palette in `graph-node.tsx`); port/edge color encodes `kind` (`power` amber, `data/canbus` cyan, `video/hdmi` purple, `data/vbus` emerald, fallback gray) — the same map in `graph-node.tsx` and `graph-canvas.tsx`. Input handles render on the left, outputs on the right, matching the LR dagre layout.
- **API discipline**: components never call `fetch`; all HTTP goes through `src/api/api.ts`.
- **UI kit**: shadcn/ui (new-york style) primitives in `src/components/ui/`, Tailwind 4 via `bun-plugin-tailwind`; icons are mostly inline SVG components defined next to their usage.

## Testing strategy

Three layers, all on `bun:test`:

- **Engine** (`src/graph/graph-engine.test.ts`) — pure unit tests of flatten/connect/validate, no DOM.
- **API client** (`tests/api.test.ts`) — `spyOn(global, "fetch")` to assert endpoints and payloads.
- **Components** (`tests/*.test.tsx`) — happy-dom installed manually via `require("./setup")` at the top of each file (no global preload), Testing Library for rendering, `mock.module()` to stub `@xyflow/react`.

## Known trade-offs

Accepted consequences of the current design, useful context when extending it:

- **Lookup scans**: finding a graph by UID without a namespace scans all files recursively; fine at sample-data scale, no index is maintained.
- **No manual edges**: wiring that the kind/filter rules can't express can't be drawn by hand. Extending expressiveness means extending port semantics (kinds, filters), not adding an edge store.
- **Greedy matching**: auto-connect assigns matches in name-sorted order — first eligible match wins. There is no global optimization or backtracking, so `one`-relationship contention resolves alphabetically.
- **No concurrency control**: last write wins on graph files; no locking or versioning.
- **Node-level PUT** replaces the whole node object within its graph file (read-modify-write of the file).
