# Phase 4 — Editor

**Status: done.** Depends on Phase 3.

## Goal

Build a graph from inside the app. Create and edit graphs, nodes, attributes and
ports; manage child-graph imports with their aliases; correct wiring the rules
get wrong; and delete safely. At the end of this phase the seed script is a
convenience rather than the only way to get data in.

## In scope

- **Graph CRUD** — create, edit metadata (uid, name, label, namespace,
  description, visibility, tags), delete with an impact check.
- **Node editor** — a modal editing label, name, attributes and ports, saved as
  one atomic record write.
- **Port editor** — direction, kind (a combobox over `PortKinds` that still
  accepts free text), relationship, `isRequired`, port attributes and their
  filter groups. The filter builder is the fiddliest piece of UI in the app.
- **Import management** — add a child graph, edit its alias and label, reorder,
  toggle `enabled`, remove. Adding the same child twice is a first-class action,
  not an error.
- **Pre-flight cycle checks** — run `checkImport()` before offering a graph in
  the picker, and disable the ineligible ones with the reason shown.
- **Override UI** — from a selected edge, "suppress this connection"; from two
  selected ports, "connect these anyway", each requiring a `reason`. A panel
  lists active overrides and flags stale ones.
- **Manual positioning** — drag a node to write `position`; "reset layout"
  clears it.

## Out of scope

- Cloning or forking a graph — Phase 5.
- Version pinning and per-import attribute overrides — Phase 5.
- Bulk operations and JSON import — Phase 6.
- Multi-user concurrent editing beyond last-write-wins.

## Data and API surface

First phase that writes. All five collections, through the Phase 1 mutators.

Two constraints that shape the UI:

- **`GraphMutator.create` must inject `owner`.** Already handled in the mutator;
  the form must not send its own.
- **Deleting a graph cascades its imports.** Call
  `GraphMutator.countImporters()` first and require explicit confirmation
  naming the parents. See
  [IMPORTS.md § Deleting a graph](../IMPORTS.md#deleting-a-graph-that-others-import).

Optimistic updates plus the `'*'` realtime subscription from Phase 3 means a
write lands twice — **dedupe by id** when adding to the context's node list.

## Files

```
webapp/src/app/(shell)/graphs/new/page.tsx
webapp/src/app/(viewer)/graphs/[id]/edit/page.tsx
webapp/src/components/graph/editor/graph-form.tsx
webapp/src/components/graph/editor/node-editor-modal.tsx
webapp/src/components/graph/editor/attribute-list-editor.tsx
webapp/src/components/graph/editor/port-list-editor.tsx
webapp/src/components/graph/editor/filter-group-editor.tsx
webapp/src/components/graph/editor/import-manager.tsx
webapp/src/components/graph/editor/override-panel.tsx
webapp/src/components/graph/editor/delete-graph-dialog.tsx
webapp/src/contexts/graph-editor-context.tsx
```

The two route paths gained their group prefixes: this sketch predates Phase 3's
`(shell)` / `(viewer)` split. `/graphs/new` is a plain form page and keeps the
nav chrome; the editor is full-bleed and lives in `(viewer)`, next to the
viewer, which also avoids defining `/graphs/[id]/…` from two groups at once.
`next build` confirms both resolve.

Built as planned, plus three files the sketch did not anticipate:

```
webapp/src/hooks/use-graph-editor.ts                     context accessor
webapp/src/components/graph/editor/port-kind-combobox.tsx
```

`port-kind-combobox.tsx` came out of `port-list-editor.tsx` because the
free-text-with-warning behaviour is the whole of the "kind typos" open question
and wanted to be one testable thing rather than a branch inside a form row.

Forms use `react-hook-form` + `@hookform/resolvers` against the `*InputSchema`
zod schemas already exported from `shared/src/schema/`, matching the existing
auth forms. `parseAuthError` in `lib/errors.ts` normalizes PocketBase errors into
field errors — reuse it rather than writing a second error mapper.

Two deviations worth knowing:

- **`graph-form.tsx` is typed on the schema's input, not its output.**
  `visibility` carries a zod `.default()`, so `z.input<typeof GraphInputSchema>`
  has it optional while `GraphInput` has it required. `useForm<Input, unknown,
  GraphInput>` is what reconciles the two.
- **The node editor is not built on `react-hook-form`.** Its state is two nested
  arrays — ports, each with attributes, each with a filter group of conditions —
  which `useFieldArray` addresses through generated path strings three levels
  deep. A plain draft object validated with zod on submit is less machinery for
  the same guarantee, and it let the sub-editors become controlled components
  that a test can render from a fixture with no form context at all.

## Design notes

**The editor edits the stored form, never the derived one.** There is no
"connect" gesture on the canvas. The live preview shows the wiring that falls
out of the edits, which is the feedback loop that teaches the model.

**Ports and attributes are edited as one node write.** They are JSON on the
record; a "save node" button writes them together. No per-port save.

**Aliases need a good default and a visible explanation.** `addImport()` already
allocates `battery_system`, `battery_system_2`, …; the UI should show that the
alias is what distinguishes two instances, because it is not obvious and it is
baked into every override path.

**Overrides need friction.** Requiring a `reason` is deliberate: an override is
an admission the rules do not express something, and the next person needs to
know what.

**Renaming an alias breaks overrides.** Every override under it holds a stale
path. Either rewrite them in the same operation or warn loudly — decide and
document it.

> Decided: **rewrite them**, behind a confirmation naming the count. Written up
> in [IMPORTS.md § Renaming an alias](../IMPORTS.md#renaming-an-alias).

**An override stores port *names*; an edge carries port *handles*.** This is the
sharpest trap in the phase. `FlatEdge.sourcePortName` is an XYFlow handle id
(`supply-out-0`), but `GraphEdgeOverrides.sourcePort` is a bare name (`supply`)
that `applyOverrides` resolves with `findPort`. Building an override straight
from a selected edge without converting stores a row that matches nothing and
resurfaces later as a `stale-override` warning — it never errors at the point of
the mistake. `portNameFromHandle` converts by **index**, not by splitting on
`-`, because port names may themselves contain dashes.

**Only root-graph nodes can be dragged.** `position` lives on the `GraphNodes`
record while the canvas is keyed by instance id, so a node imported twice is one
record under two ids. The engine already settled this by ignoring `position`
below the root (`flattenGraph`); the editor mirrors it rather than offering a
gesture whose result would be discarded. Per-instance layout needs a schema
change and belongs with Phase 5.

## Acceptance criteria

All verified against a seeded database driven through a real browser.

- [x] A graph can be created, edited and deleted from the UI.
- [x] A node with attributes, ports, port attributes and a filter group can be
      created and round-trips exactly.
- [x] The import picker disables graphs that would create a cycle and shows why.
- [x] The same child can be imported twice; the second gets a distinct alias
      automatically.
- [x] Deleting a graph with importers requires confirmation naming them.
- [x] Toggling `enabled` removes the subtree from the preview without deleting
      the link. **This did not work when the phase started** — see below.
- [x] Suppressing an edge removes it from the canvas; pinning one adds it and
      clears the corresponding required-input error.
- [x] Dragging a node persists `position`; "reset layout" clears it and dagre
      takes over again.
- [x] Two browser windows on the same graph converge via realtime with no
      duplicated nodes.
- [x] `yarn precommit` passes.

### The one schema change: `enabled` could never be false

`GraphImports.enabled` was declared `BoolField()`, which generates
`required: true`. In PocketBase a required bool means **must be true** — `false`
is rejected as `validation_required` — so the field could be switched on and
never off. Nothing had noticed because Phase 1–3 only ever wrote `true`, and the
resolver's `enabled: false` path was reachable from a fixture but not from the
API.

Fixed by `BoolField().optional()` plus a generated migration
(`1786151776_updated_GraphImports.js`). This is the phase's only schema change,
and it is a correction rather than new surface.

### Two override behaviours the UI now has to state out loud

Both fall out of the engine and the collection, and both were silent failures
before:

- **One override per pair of ports.** `GraphEdgeOverrides` is uniquely indexed on
  `(graph, sourcePath, sourcePort, targetPath, targetPort)`, so you cannot pin a
  pair you have also suppressed. The panel checks first and names the override in
  the way, instead of surfacing a bare "Failed to create record."
- **Pinning an already-derived edge does nothing.** `applyOverrides` skips a pin
  whose edge id already exists and leaves it `origin: 'derived'`. The panel
  refuses that pin rather than writing a row and reporting success over an
  unchanged canvas.

### A pin only renders where both of its endpoints do

A pin from `port_bank/…` into `control/…` does not appear under
`?focus=control`: focus filters nodes *before* overrides are applied, so the
source is out of frame and the override cannot resolve. That is the engine
working as designed — a focused view shows the wiring internal to that subtree —
and it is also why stale reporting is switched off under focus. Worth knowing
before concluding that a pin failed to save.

## Answered questions

- **Alias rename semantics.** *Rewrite the dependent override paths*, behind a
  confirmation that states how many will change. Refusing the rename would turn a
  cosmetic edit into a dead end whose only exit is deleting work. The rewrite is
  not atomic — PocketBase has no multi-record transaction — so the override
  panel's stale detection stays as the backstop. Written up in
  [IMPORTS.md § Renaming an alias](../IMPORTS.md#renaming-an-alias).
- **How much validation belongs client-side?** A warning, as suspected. The kind
  combobox lists `PortKinds` but accepts free text, and flags a kind with no
  registry row without blocking the save — matching the engine, which still
  connects unregistered kinds to themselves and reports `unknown-port-kind` as
  *info*. Making the registry a gate here would contradict the model.
- **Undo.** Deferred to Phase 5 with `GraphVersions`, which introduces snapshots
  anyway. Until then the destructive operations carry confirmations instead:
  deleting a graph with importers additionally requires typing its machine name.

## Notes for Phase 5

- `GraphViewerProvider` now also exposes the *stored* form — `rootNodes`,
  `rootImports`, `graphsById`, `overrides` — straight off the already-loaded
  tree, plus `applyNodePatch` / `applyOverridePatch`. Fork/clone can read what it
  is copying from there without a second fetch.
- Writes are optimistic through those same patch functions, which replace by id.
  Anything Phase 5 adds should go through them rather than calling `reload()`,
  which re-resolves the whole tree.
- `GraphEdgeOverrides` now has a realtime subscription alongside `GraphNodes` and
  `GraphImports`; the viewer-context test asserts all three are torn down.
- Per-instance node positions are still unsolved (see decision 4 above) and are
  the natural companion to per-import attribute overrides.
