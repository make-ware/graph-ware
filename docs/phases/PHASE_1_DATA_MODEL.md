# Phase 1 — Data Model

**Status: done.**

## Goal

Replace the boilerplate's single `Users` collection with the graph-ware domain
model on PocketBase: graphs, nodes, child-graph imports, edge overrides, and a
port-kind registry — with access rules, a cycle guard, typed mutators, and a
seeded sample dataset. No UI, no engine; this phase makes the data real so
everything after it has something to stand on.

## In scope

- Five collections defined in `shared/src/schema/` with fields, indexes and
  access rules.
- Value-object schemas for attributes, ports, filters and instance paths.
- Client-side import rules (cycle, depth, alias allocation) and the goja hook
  that enforces them server-side.
- `BaseMutator` subclasses for every collection, registered in both
  `TypedPocketBase` interfaces.
- Generated migrations, applied and verified against a real PocketBase.
- A seed script loading `example/data/` and exercising double-import.

## Out of scope

- The resolver and the graph engine — Phase 2.
- Any UI. There is no `/graphs` route yet.
- Version pinning, per-import overrides, workspaces — Phase 5.
- JSON import/export of the Node-Ware file format — Phase 6.

## Data and API surface

| Collection | Fields | Rules |
|---|---|---|
| `Graphs` | owner, uid, name, label, namespace, description, visibility, tags | owner-write; read admits anything not `private` |
| `GraphNodes` | graph, name, label, attributes, ports, position | scoped via `graph.owner` |
| `GraphImports` | parent, child, alias, label, order, enabled | scoped via `parent.owner`; create also requires the child be visible |
| `GraphEdgeOverrides` | graph, mode, source/target path + port, reason | scoped via `graph.owner` |
| `PortKinds` | key, label, color, description, compatibleWith | global read, superuser write |

Full reference: [DATA_MODEL.md](../DATA_MODEL.md).

## Files

**Created**

```
shared/src/lib/graph/primitives.ts        value objects + shared constants
shared/src/lib/graph/imports.ts           instance paths, cycle/depth rules, aliases
shared/src/schema/graph.ts
shared/src/schema/graph-node.ts
shared/src/schema/graph-import.ts
shared/src/schema/graph-edge-override.ts
shared/src/schema/port-kind.ts
shared/src/mutators/graph.ts
shared/src/mutators/graph-node.ts
shared/src/mutators/graph-import.ts
shared/src/mutators/graph-edge-override.ts
shared/src/mutators/port-kind.ts
pocketbase/pb_hooks/graph-imports.pb.js   create/update handlers
pocketbase/pb_hooks/graph-imports-guard.js  the shared ES5 guard
pocketbase/pb_migrations/*_created_*.js   generated
scripts/seed-graphs.mjs
```

**Modified** — `schema/index.ts`, `mutators/index.ts`, `shared/index.ts`,
`lib/types.ts`, `types/index.ts`, root `package.json`.

## Notable decisions

- **Hybrid normalization.** Graphs and nodes are records; ports and attributes
  are validated JSON on the node. Rationale in
  [DESIGN.md](../DESIGN.md#3-records-where-identity-matters-json-where-it-does-not).
- **A join collection, not a relation array.** `GraphImports` exists so the same
  child can be imported twice. That single capability is what forced instance
  paths.
- **Instance paths, not record ids,** for anything derived.
- **No denormalized `owner`** on child collections; rules use nested lookups.
- **The cycle guard is a hook** because API rules cannot walk an ancestor chain,
  mirrored client-side for messaging and tests.

## Fixed along the way

`yarn db:status` and the other `db:*` scripts failed on Node 22 with
`Cannot require() ES Module … in a cycle` — the migrate CLI's tsx loader,
unrelated to any schema change; it reproduced on the untouched boilerplate. The
scripts now preload tsx via `NODE_OPTIONS="--import tsx"`, and `tsx` is declared
as a root devDependency instead of being relied on transitively.

## Acceptance criteria

All verified against a running PocketBase:

- [x] `yarn db:status` reports the five collections, `yarn db:generate`
      round-trips `up()`/`down()`, `yarn db:verify` reports the schema in sync.
- [x] `yarn db:seed` loads the sample data and creates **two** imports of
      `BatterySystem` under the aliases `port_bank` and `starboard_bank`.
- [x] A self-import is rejected.
- [x] A direct cycle (`BatterySystem` → `testDataElement`) is rejected.
- [x] A transitive cycle (`EngineSystem` → `testDataElement`) is rejected.
- [x] A diamond — `EngineSystem` also importing `BatterySystem` — is accepted.
- [x] A chain of 8 graphs is accepted; the 9th link is rejected with a depth
      message.
- [x] A second user sees none of the demo user's private graphs, sees a graph
      flipped to `public`, and still cannot update it.
- [x] A public graph's nodes are readable by a second user through the nested
      rule, with `ports` JSON intact.
- [x] `yarn precommit` passes.

## Open questions

- **Should `namespace` survive?** It is presentation only now. Phase 5 replaces
  it with `Workspaces`; whether the field is then dropped or kept as a label
  within a workspace is undecided.
- **Should overrides be validated on write?** Currently a `pin` naming a
  nonexistent instance path is stored happily and reported as a diagnostic at
  render time. A hook could reject it, at the cost of resolving the tree on
  every write.
