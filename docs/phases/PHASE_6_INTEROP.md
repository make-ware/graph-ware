# Phase 6 — Interop

**Status: planned.** Depends on Phase 2 for validation and Phase 4 for the UI.
Independent of Phase 5.

## Goal

Get data in and out. Round-trip the Node-Ware JSON format, export diagrams as
images, run bulk operations without clicking through a UI, and — once the shape
has settled — collapse tree resolution into a single request.

## In scope

- **JSON import** — upload one file or a directory of them, map `childGraphs`
  UID references onto `GraphImports` records, validate before writing, and
  report what would happen before it happens.
- **JSON export** — a single graph, or a graph and its whole import subtree, in
  the `example/data/*.json` format. Byte-comparable round-trips for graphs that
  use no post-Node-Ware features.
- **Diagram export** — SVG and PNG from the canvas, including a print
  stylesheet.
- **Bulk operations** — a CLI (`scripts/graph-cli.mjs`) for import, export,
  validate and lint across a whole workspace, usable in CI.
- **Resolved-tree endpoint** — a `pb_hooks` route returning a fully resolved
  tree in one request, replacing the resolver's per-level round-trips.

## Out of scope

- Other formats: KiCad netlists, Graphviz, Mermaid, SysML. Interesting, not now.
- Live sync with an external system.
- Importing without an authenticated user.

## Data and API surface

No schema changes. Two things need care.

**The format has diverged.** The Node-Ware file format cannot express what
Phase 1 added:

| Node-Ware | Graph-Ware | On import | On export |
|---|---|---|---|
| `childGraphs: string[]` | `GraphImports` records | one import each, alias derived from the child's name | emitted as UIDs; **a child imported twice collapses to one entry** |
| — | `alias`, `label`, `order`, `enabled` | defaulted | lost |
| — | `GraphEdgeOverrides` | — | lost |
| — | `position` | — | lost |
| `id` (CUID) | PocketBase id | preserved in a `sourceId` field, not used as the record id | emitted as the record id |

So export is lossy for anything using the new capabilities. The exporter must
say so — a manifest listing what was dropped, not a silent downgrade. An
extended `graph-ware.json` format that loses nothing is the obvious companion;
whether it replaces the compatible one or sits beside it is an open question.

**A custom route re-implements authorization.** The resolved-tree endpoint runs
as a `pb_hooks` handler and does not get collection rules for free. It has to
check the caller's access to the root graph and to every child it walks —
which is precisely why it is deferred to Phase 6 rather than done in Phase 2.

## Files

```
webapp/src/lib/graph/serialize.ts        graph → Node-Ware JSON
webapp/src/lib/graph/deserialize.ts      JSON → records, with a dry-run plan
webapp/src/lib/graph/export-image.ts     canvas → SVG/PNG
webapp/src/app/graphs/import/page.tsx    upload, preview, confirm
webapp/src/components/graph/export-menu.tsx
scripts/graph-cli.mjs
pocketbase/pb_hooks/graph-resolve.pb.js  GET /api/graph-ware/graphs/:id/resolved
```

## Design notes

**Import is a two-step: plan, then apply.** Parse and validate everything, show
what will be created, updated and skipped, and only then write. `scripts/seed-graphs.mjs`
already does upsert-on-natural-key; generalize that rather than starting over.

**UID references resolve within a scope.** Node-Ware looked children up in the
parent's namespace first, then globally. Importing a set of files is a closed
world: resolve `childGraphs` against the uploaded batch first, then against
existing graphs in the target scope, and report anything unresolved instead of
silently dropping it.

**Validate with the engine, not a second implementation.** After building the
tree in memory, run the Phase 2 engine over it and surface the diagnostics as
part of the import preview. An import producing forty unconnected required
inputs is something the user wants to know before committing.

**Measure before adding the endpoint.** The resolver's per-level batching may
well be fast enough. The endpoint is worth its authorization complexity only if
resolution is measurably slow on a real tree.

## Acceptance criteria

- [ ] Importing `example/data/*.json` produces the same graphs, nodes and
      imports as `yarn db:seed`.
- [ ] Exporting those graphs and re-importing them is idempotent.
- [ ] Exporting `testDataElement` — which imports one child twice — emits a
      manifest stating that the duplicate import was collapsed.
- [ ] Import shows a dry-run plan and writes nothing until confirmed.
- [ ] An unresolvable `childGraphs` reference is reported, not skipped.
- [ ] The import preview shows engine diagnostics for the resulting tree.
- [ ] SVG export opens in a browser with correct colours in light and dark.
- [ ] `graph-cli.mjs validate` exits non-zero on a graph with error-level
      diagnostics, so it can gate CI.
- [ ] The resolved endpoint returns the same tree as the client resolver, and
      returns 404 for a graph the caller cannot read.
- [ ] `yarn precommit` passes.

## Open questions

- **One format or two?** A lossless `graph-ware.json` alongside the compatible
  Node-Ware format, or a single versioned format with a compatibility flag?
- **Should import be able to update in place?** Matching on `uid` makes re-import
  an update; matching on nothing makes it always-create. The seed script chose
  update; a user importing someone else's export probably wants create.
- **Where does the CLI authenticate from?** A superuser is too much for a CI
  validation job. A scoped token would be better, and PocketBase has no first-class
  notion of one.
