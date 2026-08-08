# Phase 3 — Viewer

**Status: done.**

## Goal

See the graph. A list of your graphs, and a full-bleed canvas that renders a
resolved tree with derived wiring, colour-coded subgraph membership,
kind-coloured ports and edges, a detail panel, and a diagnostics list. Read
only — nothing on these screens changes data.

## In scope

- `/graphs` — list of your graphs plus published ones, with node and import
  counts, namespace grouping and tag filtering.
- `/graphs/[id]` — the viewer: sidebar, canvas, detail panel.
- **Canvas** — `@xyflow/react` fed by engine output. Input handles left, output
  handles right, matching the left-to-right layout.
- **Subgraph focus** — the sidebar lists every import instance by its label;
  selecting one filters the canvas by instance path (`port_bank` and
  `starboard_bank` focus independently).
- **Detail panel** — selecting a node shows its attributes, ports and
  breadcrumb; selecting an edge shows both endpoints, the kind, and whether it
  was derived or pinned.
- **Diagnostics panel** — grouped by level, each entry jumping to its node.
- **Colours** — subgraph membership from `graphColorIndex`; port and edge colour
  from `PortKinds` via `usePortKinds`, never a hardcoded map.
- **Realtime** — a per-page provider subscribing to `GraphNodes` and
  `GraphImports` for the resolved set, recomputing the engine on change.

## Out of scope

- Any editing. No create, update, delete, drag-to-position, or override UI —
  Phase 4.
- Export to image — Phase 6.
- Search across the public library — Phase 5.

## Data and API surface

Reads only. No schema changes.

Realtime subscriptions are the new thing: a `GraphViewerProvider` mounted per
page (not globally — `AuthProvider` is the only global one) subscribing to the
collections whose records appear in the resolved tree, and tearing the
subscriptions down on unmount.

> Per CLAUDE.md: when a provider combines optimistic updates with a `'*'`
> subscription, writes land twice. The viewer does not write, so this is
> latent here — but the provider is the one Phase 4 extends, so dedupe by id
> from the start.

## Files

```
webapp/src/app/graphs/page.tsx               list
webapp/src/app/graphs/[id]/page.tsx          viewer, full-bleed layout
webapp/src/contexts/graph-viewer-context.tsx resolve + engine + realtime
webapp/src/components/graph/graph-canvas.tsx
webapp/src/components/graph/graph-node.tsx   custom XYFlow node
webapp/src/components/graph/graph-sidebar.tsx
webapp/src/components/graph/graph-detail-panel.tsx
webapp/src/components/graph/diagnostics-panel.tsx
webapp/src/components/graph/port-badge.tsx
webapp/src/hooks/use-graph-viewer.ts
```

Built as planned, plus two files the sketch did not anticipate:

```
webapp/src/lib/graph/flow-adapter.ts             GraphView → XYFlow, pure
webapp/src/components/graph/subgraph-palette.ts  graphColorIndex → theme tokens
```

`flow-adapter.ts` is where the canvas becomes testable — ReactFlow measures the
DOM and happy-dom has no `ResizeObserver`, so the mapping is asserted directly
and `<ReactFlow>` is never mounted in a test. It stays out of the
`@project/shared` barrel for the same reason the resolver does: it has a
dependency (`@xyflow/react`) that the barrel should not drag in.

Routing moved into two route groups, `(shell)` and `(viewer)`, because
`NavigationBar` was mounted in the root layout and a nested layout cannot remove
an ancestor's chrome. `/graphs` and `/graphs/[id]` resolving from different
groups is legal — verified by `next build`.

shadcn/ui primitives already in `components/ui/` cover the panels: `card`,
`badge`, `scroll-area`, `resizable`, `tabs`, `separator`, `tooltip`.

## Design notes

**The canvas takes engine output, not records.** It should be renderable from a
fixture with no PocketBase in the picture, which also makes it testable.

**Every graph is first class in the sidebar,** including imported ones — a child
opens on its own route and renders as its own root.

**Instance paths in the URL.** Focus state belongs in the query string
(`?focus=port_bank`) so a focused view is linkable. Node selection too
(`?node=port_bank/abc`).

**Full-bleed layout.** The viewer route needs its own layout without the
standard nav chrome; every other page keeps the existing shell.

## Acceptance criteria

All verified against a seeded database driven through a real browser.

- [x] `/graphs` lists the seeded graphs with correct node and import counts
      (`testDataElement` 0/3, `BatterySystem` 3/0, `EngineSystem` 1/0).
- [x] `/graphs/[testDataElement]` renders both battery banks as visually
      distinct groups.
- [x] Focusing `port_bank` shows only its nodes; `starboard_bank` shows a
      different set of the same components.
- [x] Port and edge colours come from `PortKinds`; a port with an unregistered
      kind renders in the fallback colour and produces an `unknown-port-kind`
      info diagnostic.
- [x] The Cerbo GX's unconnected required input shows as an error diagnostic
      that navigates to the node — see the note below on when it fires.
- [x] Editing a node in the PocketBase admin UI updates the open canvas without
      a reload. One record edit updates *both* instances of a twice-imported
      node.
- [x] Opening a `public` graph owned by another user renders read-only, with no
      edit affordances.
- [x] `yarn precommit` passes.

### On the Cerbo GX diagnostic

In the **whole** `testDataElement` tree the Cerbo's required `supply` input is
*connected* — the battery bank's fuse has a `many` power output that reaches it,
which is the engine working correctly. The diagnostic fires when the engine bay
is looked at on its own: `?focus=control`, or `/graphs/[EngineSystem]` as its own
root. Worth knowing, because it makes the diagnostic a property of the current
view rather than of the stored data.

## Answered questions

- **How much of the tree renders at once?** Everything, for now. Focus by
  instance path is the scaling tool, and `MAX_RESOLVED_NODES` (2000) plus the
  `resolution-truncated` diagnostic backstop the pathological case. Revisit
  collapsing when there is a real system big enough to need it.
- **Should edges be selectable when derived?** Yes, both derived and pinned.
  The detail panel shows endpoints, kind and provenance, and says outright that
  a derived edge has no stored record. Phase 4 hangs "suppress this connection"
  off the same selection, so building it now avoids a rework.

## Notes for Phase 4

- `GraphViewerProvider` splits the async load from the synchronous engine run so
  focus changes never refetch. Realtime patches replace nodes **by id**, which
  is what keeps optimistic updates from double-inserting against the `'*'`
  subscription.
- A `GraphImports` change triggers a full re-resolve rather than a patch: a new
  import can pull in a graph that was never loaded.
- `isOwner` is already on the context; gate edit affordances on it.
- Canvas nodes declare `width`/`height` rather than being measured. The canvas
  is controlled without `onNodesChange`, so XYFlow cannot write measured
  dimensions back — anything reading them off a node (the minimap did) sees
  nothing. Adding drag in Phase 4 means adding `onNodesChange` and revisiting
  this.
