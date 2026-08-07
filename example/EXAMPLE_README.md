# README

## Architecture

Node-Ware is a graph editor/viewer for hardware-like systems (batteries, engines, circuits). A single Bun process serves both the REST API and the React SPA. Design rationale and trade-offs: `DESIGN.md`.

**Data flow:** JSON files on disk → store → REST API → frontend API client → GraphEngineService → XYFlow canvas.

### Backend 

- `src/index.ts` — `Bun.serve()` with route-object API. Serves `src/index.html` as SPA fallback (`/*`) and JSON endpoints under `/api/graphs`, `/api/graphs/:uid`, `/api/graphs/:uid/nodes/:nodeId`, `/api/graphs/:uid/resolved`, `/api/namespaces`. Seeds sample data on startup via `seedIfEmpty()`.
- `src/store.ts` — file-based persistence. Each graph lives at `data/graphs/{namespace}/{uid}.json`. Namespaces are directories, validated against `^[a-z0-9]+$`. `resolveGraph()` recursively loads `childGraphs` references into a `ResolvedGraph` tree, guarding against circular refs.

### Graph model 

Central invariants (documented in that file):

- Every graph/node has an `id` (CUID); every graph also has a `uid` used as its filename and reference key.
- Graphs reference children by **UID in `childGraphs`**, never by embedding — this enables reuse of subgraphs.
- Nodes (`GraphNode`) carry `attributes` (name/value/unit/kind) and `ports` (direction in/out, `kind` string like `power` or `data/canbus`, `relationship` one/many, optional `isRequired`, optional attribute `filter` conditions).

### Graph engine (`src/graph/graph-engine.ts`)

`GraphEngineService.process(resolvedGraph)` is the core algorithm: it flattens the resolved tree into `FlatNode[]` (with breadcrumbs and per-subgraph color indices), then **auto-connects** ports — edges are not stored, they are derived by matching output ports to input ports of the same `kind`, respecting one/many relationships, and evaluating input-port filters against the source node's attributes. It then validates (missing `isRequired` inputs become diagnostics) and lays out nodes with dagre.

### Frontend (`src/frontend.tsx` → `src/App.tsx`)

- react-router-dom routes: `/` (list), `/graphs/:uid` (viewer, full-bleed layout), `/graphs/:uid/edit`, `/graphs/new`, `/graphs/:uid/node/:nodeId` — each with a namespace-prefixed variant under `/n/:namespace/...`.
- All fetch calls go through `src/api/api.ts`; components never call `fetch` directly.
- `src/components/graph-canvas.tsx` renders via `@xyflow/react` using GraphEngineService output; shadcn/ui primitives live in `src/components/ui/` (new-york style, configured in `components.json`).
- Path alias: `@/*` → `./src/*`.

## Testing conventions

- Tests use `bun:test` (`describe`/`test`/`expect`/`mock`/`spyOn`). Engine tests sit next to the source (`src/graph/graph-engine.test.ts`); component/API tests are in `tests/`.
- Component tests must `require("./setup")` first — `tests/setup.ts` installs a happy-dom window/document into `globalThis` (there is no global preload configured). They use `@testing-library/react` with CommonJS `require` after setup, and `mock.module()` to stub `@xyflow/react`.
- API tests mock `global.fetch` with `spyOn`.
