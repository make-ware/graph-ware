# Phase 4 — Editor

**Status: planned.** Depends on Phase 3.

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
webapp/src/app/graphs/new/page.tsx
webapp/src/app/graphs/[id]/edit/page.tsx
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

Forms use `react-hook-form` + `@hookform/resolvers` against the `*InputSchema`
zod schemas already exported from `webapp/src/schema/`, matching the existing
auth forms. `parseAuthError` in `lib/errors.ts` normalizes PocketBase errors into
field errors — reuse it rather than writing a second error mapper.

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

## Acceptance criteria

- [ ] A graph can be created, edited and deleted from the UI.
- [ ] A node with attributes, ports, port attributes and a filter group can be
      created and round-trips exactly.
- [ ] The import picker disables graphs that would create a cycle and shows why.
- [ ] The same child can be imported twice; the second gets a distinct alias
      automatically.
- [ ] Deleting a graph with importers requires confirmation naming them.
- [ ] Toggling `enabled` removes the subtree from the preview without deleting
      the link.
- [ ] Suppressing an edge removes it from the canvas; pinning one adds it and
      clears the corresponding required-input error.
- [ ] Dragging a node persists `position`; "reset layout" clears it and dagre
      takes over again.
- [ ] Two browser windows on the same graph converge via realtime with no
      duplicated nodes.
- [ ] `yarn precommit` passes.

## Open questions

- **Alias rename semantics.** Rewrite dependent override paths, or refuse the
  rename while overrides exist?
- **How much validation belongs client-side?** Kind typos are the most common
  error and only the registry can catch them — but the registry is deliberately
  not a gate. A warning, probably.
- **Undo.** Nothing here is undoable. Worth a `GraphVersions` snapshot on
  destructive operations, which Phase 5 introduces anyway.
