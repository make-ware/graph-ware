# Phase 3 — Viewer

**Status: planned.** Depends on Phase 2.

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

- [ ] `/graphs` lists the seeded graphs with correct node and import counts.
- [ ] `/graphs/[testDataElement]` renders both battery banks as visually
      distinct groups.
- [ ] Focusing `port_bank` shows only its nodes; `starboard_bank` shows a
      different set of the same components.
- [ ] Port and edge colours come from `PortKinds`; a port with an unregistered
      kind renders in the fallback colour and produces an `unknown-port-kind`
      info diagnostic.
- [ ] The Cerbo GX's unconnected required input shows as an error diagnostic
      that navigates to the node.
- [ ] Editing a node in the PocketBase admin UI updates the open canvas without
      a reload.
- [ ] Opening a `public` graph owned by another user renders read-only, with no
      edit affordances.
- [ ] `yarn precommit` passes.

## Open questions

- **How much of the tree renders at once?** A deeply nested system could produce
  hundreds of nodes. Collapsing subgraphs into a single summary node may be
  necessary; decide after seeing real data.
- **Should edges be selectable when derived?** They have no record to open,
  only computed provenance.
