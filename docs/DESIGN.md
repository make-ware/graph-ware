# Graph-Ware Design

Graph-Ware is a flowchart and schematic builder for hardware-like systems —
boats, circuits, power distribution — where components have typed connection
points and the wiring between them follows rules rather than being drawn by
hand.

It is a PocketBase re-expression of **Node-Ware**, a single-process Bun app that
stored each graph as a JSON file on disk. The original documentation is
preserved unchanged in [`example/`](../example/) and is worth reading for
context; this document explains what carried over, what changed, and why.

Companion documents: [DATA_MODEL.md](DATA_MODEL.md),
[GRAPH_ENGINE.md](GRAPH_ENGINE.md), [IMPORTS.md](IMPORTS.md), and the phase
roadmap in [phases/](phases/README.md).

## Design principles

### 1. Connections are derived, not drawn

The stored model contains nodes with ports and no edges. Every edge is computed
at render time from port compatibility: an output connects to inputs of the same
`kind`, subject to `one`/`many` relationship limits and attribute filters. The
graph describes *what components are and what they accept or provide*, and the
wiring falls out of that.

Consequences, all of them deliberate:

- Editing means editing nodes and ports. There is no "connect" gesture.
- Validation is a byproduct: a required input that no compatible output
  satisfies is an error diagnostic, reported against the node and its path.
- Determinism matters. Nodes and candidate matches are processed in name-sorted
  order, so the same data always produces the same wiring and the same layout.

**What changed:** an escape hatch. `GraphEdgeOverrides` lets a user `pin` a
connection the rules miss or `suppress` one they get wrong, scoped to a single
root graph and annotated with a `reason`. The rules remain the model; an
override is a local patch, and it should read as one. When intent can be
expressed by extending port kinds or filters, extend those instead.

### 2. Graphs compose by reference

A graph never embeds a child. It points at one, and that child stays a
first-class graph — viewable, editable, reusable by any number of parents. This
is the whole point: a `BatterySystem` defined once is a component, not a copy.

**What changed:** the reference became a record. Node-Ware used
`childGraphs: string[]`, an array of UIDs, which meant a parent could import a
given child exactly once. A boat with a port *and* a starboard battery bank was
not expressible. `GraphImports` is a join collection — one record per import,
carrying an `alias`, a display `label`, an `order`, and an `enabled` flag — so
the same child can be pulled in as many times as the system actually contains
it.

That single change is the reason instance paths exist (below). It also buys
back-relation queries: `GraphImports_via_child` answers "which graphs use this
one?", which is what the editor asks before offering to delete a graph.

### 3. Records where identity matters, JSON where it does not

Graphs and nodes are PocketBase records: they need access rules, realtime
events, stable ids, and atomic writes. Ports and attributes are none of those
things — they have no independent identity, nothing references them, and they
are always read and written with their node.

So the model is hybrid. Splitting ports and attributes into their own
collections would turn one node into seven records, make a node edit
non-atomic, and add an N+1 read to every resolution — in exchange for the
ability to run SQL over port kinds, which nothing needs. Storing the whole graph
as a single JSON document would go the other way and give up per-node rules,
realtime, and concurrent editing.

The cost of the middle path is that you cannot filter by port kind in a
PocketBase query. Kind-based search across a library is a client-side scan, or
a view collection when it becomes worth building.

### 4. The database is the database

Node-Ware's fourth principle was "files are the database", which bought
human-readable, git-diffable storage and cost it authorization, concurrency
control, and any index at all — finding a graph by UID scanned every file.

PocketBase gives all three back, and the trade is real: graphs are no longer
plain files in the repo. The sample dataset stays in `example/data/` as JSON and
`yarn db:seed` loads it, so the round-trip is still exercised. Full
import/export of that format is Phase 6.

### 5. All data access is client-side

The browser talks to PocketBase directly through the JS SDK. There are no route
handlers, no server actions, and no server-side PocketBase client — every page
under `webapp/src/app/` is `'use client'`. [PB_SSR.md](PB_SSR.md) explains why:
a module-scoped `pb` instance leaks auth state across server requests.

This inherits Node-Ware's split of where computation lives, with the server
half handed to PocketBase:

- **Server** — persistence and authorization. PocketBase computes no edges and
  no layout.
- **Client** — resolution, flattening, connection, validation, layout;
  recomputed from the resolved tree on each load or filter change.

The one deliberate server-side exception is the cycle guard, because it cannot
be anything else (below).

## System architecture

```
PocketBase collections
  Graphs · GraphNodes · GraphImports · GraphEdgeOverrides · PortKinds
        │  PocketBase JS SDK, direct from the browser
        ▼
shared/src/mutators/ ──── typed CRUD, filter/sort/expand defaults, realtime
        │
        ▼
shared/src/lib/graph/resolver.ts ──── breadth-first load of the import tree
        │  ResolvedGraph
        ▼
shared/src/lib/graph/engine.ts ────── flatten → auto-connect → validate → layout
        │  FlatNode[] / FlatEdge[] / positions / diagnostics
        ▼
components/graph/graph-canvas.tsx ─── XYFlow rendering
```

The engine is pure with respect to the DOM and the network — it takes a
resolved tree and returns data — which is why it is unit-testable without a
browser or a live PocketBase. Layers below `mutators/` are Phase 2 and 3; see
[phases/](phases/README.md).

### Query / Context boundary

Server state lives in TanStack Query (`webapp/src/hooks/queries/` with
`queryKeys` in `hooks/queries/keys.ts`); UI and derived state lives in
contexts (`GraphViewerProvider`, `WorkspaceProvider`). The query cache is
`staleTime: Infinity` with `refetchOnReconnect` — realtime `subscribeToCollection`
events invalidate it, so no polling timers are needed. `PortKinds` is cached
with a long `gcTime` because every canvas render reads it. On auth change
`QueryProvider` clears the cache.

## Design decisions specific to PocketBase

### Ownership through nested lookups

`GraphNodes`, `GraphImports`, `GraphEdgeOverrides` and `GraphVersions` carry no
owner or workspace column of their own. Their rules resolve scope through the
parent relation — `graph.workspace`, and from there its membership roll. A
denormalized copy would be one join cheaper and one more thing that can silently
drift out of sync after a transfer or a clone. At this scale, correctness wins.

### A workspace owns a graph; a user created it

Phase 5 moved the access anchor from `Graphs.owner` to `Graphs.workspace`.
Scoping work to a single user account works right up to the moment two people
need to edit the same system, at which point the only options are sharing a
password or copying the graph — and a copy that has to be kept in step by hand
is the problem this whole model exists to avoid.

`owner` survives as provenance and grants nothing. Every user gets a personal
workspace on signup, so the single-player case is unchanged from outside: one
workspace, one member, and the switcher hides itself.

The cost is that the rules got long enough to be dangerous, and that the
same-row semantics of `?=` / `?!=` are the difference between a role model and a
security hole. Both are answered structurally: the expressions are built once in
`shared/src/schema/permissions.ts`, and `yarn db:verify-rules` walks a
three-user, two-workspace matrix against a running server, because no unit test
can assert a property of PocketBase's filter engine.

### Visibility, not just ownership

Reuse across users needs a way to publish, so `Graphs.visibility` is
`private | unlisted | public` and every read rule admits anything not private —
ahead of the membership test, so a published graph resolves for someone in none
of its workspaces. Without it, importing a graph from someone else's library
would resolve to an empty subtree: the parent would be readable and the child
would not.

Visibility grants reads only. Writing still requires membership, which is what
makes "use somebody's component without being able to change it" the default
relationship in the library.

### The cycle guard is a hook

PocketBase API rules can follow a relation one level at a time but cannot walk
an ancestor chain, and "does this import close a loop?" is inherently recursive.
So it lives in `pocketbase/pb_hooks/graph-imports.pb.js`, which rejects
self-imports, cycles, and chains deeper than `MAX_IMPORT_DEPTH`.

`shared/src/lib/graph/imports.ts` mirrors the same rules client-side. That copy
is advisory — it exists so the editor can explain *why* an import is refused
instead of surfacing a bare 400, and so the logic is unit-testable. The hook is
the authority. Change one, change the other.

### Instance paths instead of record ids

Because a child can be imported twice, one `GraphNodes` record can appear
several times in a resolved tree, and its id stops identifying it. Everything
derived is keyed by an **instance path** — the chain of import aliases from the
root down to the owning graph, plus the node id.

This is why `GraphEdgeOverrides` stores `sourcePath`/`targetPath` as text rather
than as relations: an override has to target one specific instance of a node,
and there is no record to point at.

## Accepted trade-offs

- **No SQL over ports.** Ports live inside a JSON column, so "find every node
  with a `data/canbus` output" is a client-side scan.
- **Greedy matching.** Auto-connect assigns matches in name-sorted order —
  first eligible match wins, no global optimization or backtracking. `one`
  relationship contention resolves alphabetically.
- **Last write wins.** PocketBase has no optimistic concurrency on record
  updates; two editors on one node will clobber each other.
- **Resolution is N round-trips.** The resolver batches by depth level, so a
  tree nested eight deep costs eight requests. A `pb_hooks` endpoint returning a
  fully resolved tree in one call is Phase 6, once the shape has settled.
- **Overrides are unvalidated against the tree.** A `pin` naming an instance
  path that no longer exists is stored happily and silently does nothing. The
  editor is expected to surface stale overrides; the collection does not.
- **`PortKinds` is superuser-write.** Users cannot add kinds through the app
  yet, only use unregistered ones and accept the fallback colour. Per-user kinds
  are Phase 5.
