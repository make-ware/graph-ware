# Child Graph Imports

How one graph reuses another. This is the feature the data model is shaped
around, so it gets its own document.

Implementation: `webapp/src/schema/graph-import.ts` (the collection),
`webapp/src/lib/graph/imports.ts` (client-side rules and instance addressing),
`pocketbase/pb_hooks/graph-imports.pb.js` (the authoritative guard).

## What an import is

A `GraphImports` record says *this parent graph contains that child graph*. The
child is not copied. It stays a first-class graph — viewable and editable on its
own — and any number of parents can point at it.

```
GraphImports { parent, child, alias, label?, order, enabled }
```

Deleting the record removes the reference and leaves the child untouched.

## Aliases and instancing

`alias` is the load-bearing field. It is unique within a parent, and it is what
makes the *same* child importable more than once:

```
testDataElement
├── port_bank       → BatterySystem   "Port Battery Bank"
├── starboard_bank  → BatterySystem   "Starboard Battery Bank"
└── control         → EngineSystem    "Control System"
```

Two imports, one child, two independent instances. The old file-based model
stored `childGraphs: ["BatterySystem", "EngineSystem"]` and could not express
this at all.

`label` is display only. `order` controls listing order. `enabled: false`
excludes a subtree from resolution without losing the link — useful for "what
does this system look like without the generator?".

`GraphImportMutator.addImport()` picks a free alias for you, seeding it from the
child's machine name and appending `_2`, `_3`, … as needed, because importing
the same child twice is an expected action rather than a mistake to reject.

### Instance paths

Because a child can appear twice, a `GraphNodes` record can appear twice in one
resolved tree, and its id no longer identifies it. The **instance path** does —
the chain of aliases from the root down to the graph that owns the node:

```
buildInstanceId([], nodeId)                        // "abc"            root graph
buildInstanceId(["port_bank"], nodeId)             // "port_bank/abc"
buildInstanceId(["port_bank", "cells"], nodeId)    // "port_bank/cells/abc"
```

Everything derived is keyed by this: flat nodes, edges, diagnostics, layout
positions, canvas selection, and the endpoints stored on `GraphEdgeOverrides`.
See [DATA_MODEL.md § Instance identity](DATA_MODEL.md#instance-identity).

### Renaming an alias

Because the alias is a *segment of every instance path beneath it*, and
`GraphEdgeOverrides` stores those paths verbatim as text, renaming an alias
invalidates every override underneath it. Nothing in the database notices: the
rows stay valid, they simply stop matching, and resurface as `stale-override`
warnings the next time the graph is resolved.

**The editor rewrites them in the same operation.** Renaming `port_bank` to
`harbour_bank` rewrites the leading segment of `sourcePath` and `targetPath` on
every override that named it, and the confirmation says how many will change
before it happens. The alternative — refusing the rename while overrides exist
— was rejected for the same reason `cascadeDelete: false` was rejected below:
it turns a cosmetic edit into a dead end whose only way out is deleting work.

Two properties keep the rewrite honest:

- Matching is on the alias **plus the separator**, so renaming `port_bank`
  leaves `port_bank_2` alone (`isUnderAlias` in `lib/graph/imports.ts`).
- Only the leading segment is replaced, so `port_bank/cells/abc` becomes
  `harbour_bank/cells/abc` and the node id survives.

PocketBase has no multi-record transaction, so a rename that fails partway
leaves some overrides rewritten and some not. That is why stale detection stays
in the override panel rather than being treated as a problem the rename solved
— it is the backstop for exactly this case.

## The rules

Three things are refused.

**Self-import.** A graph cannot import itself.

**Cycles.** An import is refused if the child can already reach the parent by
following imports downward — directly (`A → B`, then `B → A`) or through any
number of intermediates (`A → B → C`, then `C → A`).

A **diamond is not a cycle**. Two different parents importing the same child is
the reuse the whole model exists for, and it is explicitly allowed:

```
      root
     ╱    ╲            legal — both branches resolve independently
  port   starboard
     ╲    ╱
   BatterySystem
```

**Depth.** The longest chain of graphs running through a new import may not
exceed `MAX_IMPORT_DEPTH` (8, in `webapp/src/lib/graph/primitives.ts`). Depth
counts graphs, not edges: everything stacked above the parent, the parent and
child themselves, and everything hanging below the child. Adding a link in the
middle of two existing chains can therefore be refused even though neither chain
was near the limit on its own.

### Where the rules run

PocketBase API rules can follow a relation one level at a time but cannot walk
an ancestor chain, and cycle detection is inherently recursive. So the check
lives in a hook:

| | |
|---|---|
| `pocketbase/pb_hooks/graph-imports.pb.js` | **Authoritative.** Runs on create and update, throws `BadRequestError`. |
| `pocketbase/pb_hooks/graph-imports-guard.js` | The shared implementation. Not a `*.pb.js` file, so it is not auto-loaded — only `require()`d. |
| `webapp/src/lib/graph/imports.ts` | **Advisory mirror.** Powers pre-flight checks in the editor and is what the unit tests exercise. |

The mirror exists so a refused import produces a specific message instead of a
bare 400, and so the logic can be tested without a live server. It is not a
substitute for the hook — a client can always be bypassed. **Change one, change
the other.**

On update the record's own edge is excluded from the check: re-pointing an
existing import has to be evaluated against the graph *without* the link it is
replacing, or every update would look like a cycle with itself.

Two goja constraints on the hook, both easy to trip over:

- Handler callbacks run in isolated runtimes and **cannot close over
  module-scope variables**. That is why each handler `require()`s the guard
  rather than calling a function defined above it.
- The guard is written in ES5 — no arrow functions, template literals, spread,
  or destructuring.

## Resolution

Loading a tree is breadth-first, one batched request per depth level:

1. Start with the root graph id.
2. Fetch all `GraphImports` whose `parent` is in the current level
   (`parent = "a" || parent = "b" || …`), skipping `enabled: false`.
3. Fetch the `GraphNodes` for those graphs in one batched request.
4. Repeat with the children, memoizing by graph id so a diamond loads its shared
   child once.
5. Stop at `MAX_IMPORT_DEPTH` levels or `MAX_RESOLVED_NODES` nodes, emitting a
   diagnostic rather than continuing.

A tree nested eight deep costs eight round-trips. Collapsing that into a single
`pb_hooks` endpoint is Phase 6 — deferred until the shape has settled, because a
custom route has to re-implement the access rules by hand.

The resolver keeps its own visited set even though the hook prevents cycles: a
malformed database, or a hook that did not run, should degrade to a warning
rather than an infinite loop.

## Cross-user imports

A graph can import someone else's graph if that graph is not `private`. The
create rule enforces it:

```
parent.owner = @request.auth.id && (child.owner = @request.auth.id || child.visibility != "private")
```

The read rules on `Graphs` and `GraphNodes` admit anything not private, so the
imported subtree resolves for the importer. Writes stay owner-only — you can use
someone's component, not edit it.

If the child's owner later flips it to `private`, existing imports remain as
records but resolve to nothing. The resolver reports that as a diagnostic
("child graph is no longer readable") rather than failing the whole render.

## Deleting a graph that others import

Both `parent` and `child` cascade. Deleting a graph therefore **silently
removes every import that pointed at it**, quietly emptying subtrees in parents
you may not have looked at.

So the editor runs an impact check first:

```ts
const importers = await graphMutator.countImporters(graphId);
// or, for the list of parents:
await graphImportMutator.listImporters(graphId);
```

Backed by the `(child)` index and PocketBase's back-relation syntax
(`GraphImports_via_child`, see [PB_RELATIONSHIPS.md](PB_RELATIONSHIPS.md)). A
graph with importers should require explicit confirmation naming them.

The alternative — `cascadeDelete: false`, which makes PocketBase refuse to
delete a referenced graph — was rejected because it turns a recoverable warning
into a hard error with no way forward from inside the app.

## Not yet supported

Deliberately deferred, with the phase that takes them on:

- **Version pinning.** An import always resolves to the child's current state.
  Editing a shared component changes every system using it, immediately.
  `GraphVersions` plus a pinned version on the import is Phase 5.
- **Per-import overrides.** You cannot yet say "this instance of
  `BatterySystem`, but with `voltage = 24`". Phase 5.
- **Cloning a subtree.** Forking a graph and everything it imports into your own
  library is Phase 5.
