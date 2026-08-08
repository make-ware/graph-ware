# Graph-Ware Data Model

Reference for the collections, their rules, and the JSON value objects stored on
them. Source of truth: `shared/src/schema/*.ts` (collections and access rules)
and `shared/src/lib/graph/primitives.ts` (value objects). The database is built
from the generated migrations in `pocketbase/pb_migrations/` — see
[Schema vs. migrations](#schema-vs-migrations).

Companion documents: [DESIGN.md](DESIGN.md) for *why*, [IMPORTS.md](IMPORTS.md)
for child-graph reuse, [GRAPH_ENGINE.md](GRAPH_ENGINE.md) for the derived model.

## Core invariants

- **Edges are not stored.** Connections are computed at render time from port
  compatibility. The only persisted edge data is `GraphEdgeOverrides`, which
  patches the derived result rather than replacing it.
- **Graphs compose by reference.** A parent never embeds a child; it points at
  one through a `GraphImports` record. A subgraph is a first-class graph —
  viewable, editable, and reusable by any number of parents.
- **A graph may be imported more than once.** Two `GraphImports` rows may name
  the same child under different aliases. Consequently a record id is *not* a
  unique handle on a node in a resolved tree — see
  [Instance identity](#instance-identity).
- **Ports and attributes are JSON on the node.** They have no independent
  identity and are never referenced from elsewhere, so they are stored as
  validated JSON rather than as collections of their own.
- **Authorization lives in PocketBase rules.** Mutators set no user filter;
  scoping is enforced by the collection rules, which is why a mutator's `create`
  must inject `owner` and `workspace` itself.
- **A workspace owns a graph; a user created it.** Since Phase 5 every access
  decision goes through `Graphs.workspace` and its membership roll. `owner`
  survives as provenance and grants nothing on its own.

## Collections

| Collection | Purpose | Scoped via |
|---|---|---|
| `Workspaces` | A person or a team, and everything they build | `owner` + its roll |
| `WorkspaceMembers` | One person's seat on one workspace, with a role | `workspace` |
| `Graphs` | A system, subsystem, or reusable library | `workspace` |
| `GraphNodes` | An element inside a graph | `graph.workspace` |
| `GraphImports` | One graph importing another | `parent.workspace` |
| `GraphEdgeOverrides` | A pinned or suppressed connection | `graph.workspace` |
| `GraphVersions` | An immutable snapshot of a graph | `graph.workspace` |
| `PortKinds` | Registry of connection types | `workspace`, or global |

### Workspaces and access

`shared/src/schema/workspace.ts`, `shared/src/schema/workspace-member.ts`

| field | type | notes |
|---|---|---|
| `owner` | relation → `Users`, cascade | who created it; admitted by the rules directly |
| `name` | text | display name |
| `slug` | text, unique | `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$` — the URL segment |
| `description` | text, optional | |
| `personal` | bool, **not required** | the one provisioned on signup |

`WorkspaceMembers` is `workspace` + `user` + `role`, uniquely indexed on
`(workspace, user)`. Three roles and no more: `admin` manages the roll and the
workspace record, `member` reads and writes graphs, `viewer` reads only.

Every user gets a **personal workspace** — created by
`pocketbase/pb_hooks/workspaces.pb.js` on signup, and backfilled for users who
predate Phase 5. So the single-player case is unchanged from outside: one
workspace, one member, and the switcher hides itself entirely.

The workspace's creator is admitted by `workspace.owner` directly rather than
through a roll row, so deleting the last membership row cannot strand a
workspace. The row is still created, because the roll is what teammates see.

**Rule fragments are built, not typed out.** `shared/src/schema/permissions.ts`
exports `memberOf(path)`, `writerOf(path)` and `adminOf(path)`, and every
collection composes its rules from them at the relation depth it needs — `''`
on `Workspaces`, `'workspace'` on `Graphs`, `'graph.workspace'` on a child. The
expression is long, appears on six collections, and a typo in it leaks somebody
else's private graph; there should be one place to be wrong. That file is on
`pocketbase-migrate`'s default `schema.exclude` list, which is one more reason
that list must stay at its default.

**`?=` and `?!=` are load-bearing.** A back-relation matches many rows, and

```
workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id &&
workspace.WorkspaceMembers_via_workspace.role ?!= "viewer"
```

only means what it looks like because both conditions resolve against the *same*
join, and therefore the same roll row. Written with non-`?` operators — or read
as two independent questions — it would say "I am a member, and somebody here is
not a viewer", and every viewer would have write access. This is not a property
any unit test can assert, so `yarn db:verify-rules` walks a three-user,
two-workspace matrix against a running server.

### `Graphs`

`shared/src/schema/graph.ts`

| field | type | notes |
|---|---|---|
| `workspace` | relation → `Workspaces`, cascade | **the access anchor** |
| `owner` | relation → `Users`, cascade | who created it; must equal the caller on create |
| `forkedFrom` | relation → `Graphs`, optional, **no cascade** | provenance of a copy |
| `uid` | text | `^[A-Za-z0-9_-]{1,64}$` — the human reference key, kept for import/export |
| `name` | text | machine name, `^[a-z0-9_]+$` |
| `label` | text | display name |
| `namespace` | text, optional | `^[a-z0-9]{1,32}$` — a flat grouping label |
| `description` | text, optional | |
| `visibility` | select | `private` · `unlisted` · `public` |
| `tags` | json | `string[]`, for library search |

Indexes: `UNIQUE (workspace, namespace, uid)`, `(workspace)`, `(owner)`,
`(visibility)`, `(forkedFrom)`.

```
list/view:      signed in && (visibility != "private" || memberOf(workspace))
create:         signed in && owner = @request.auth.id && writerOf(workspace)
update/delete:  signed in && writerOf(workspace)
```

`namespace` is presentation only. In the file-based original it was a directory
and carried lookup semantics — child graphs were searched for in the parent's
namespace first. Nothing here depends on it, and Phase 5 considered dropping it
since workspaces subsume the grouping. It stayed because it is still half the
uniqueness key: one personal workspace per user makes
`(owner, namespace, uid)` and `(workspace, namespace, uid)` exactly equivalent,
so the backfill could build the new index without renaming anybody's graphs.
`(workspace, uid)` has no such guarantee.

`forkedFrom` is `cascadeDelete: false`, and that is the whole semantics of a
fork: deleting the original must not delete the copies. It records provenance,
not a relationship — there is no merge and no sync. See
[IMPORTS.md § Forking](IMPORTS.md#forking).

### `GraphNodes`

`shared/src/schema/graph-node.ts`

| field | type | notes |
|---|---|---|
| `graph` | relation → `Graphs`, cascade | |
| `name` | text | machine name; unique within the graph |
| `label` | text | display name |
| `attributes` | json | `Attribute[]` |
| `ports` | json | `Port[]` |
| `position` | json, optional | `{x, y}` manual layout override |

Indexes: `(graph)`, `UNIQUE (graph, name)`.

Rules resolve scope through the parent rather than a denormalized column —
`writerOf(graph.workspace)` for writes, and for reads that plus
`graph.visibility != "private"`. Nested relation lookups are supported by
PocketBase ([PB_COLLECTIONS.md](PB_COLLECTIONS.md)) and cannot drift the way a
copied column can. Phase 5 added a hop to the chain and changed nothing else
about the shape.

`position` is absent by default; the engine's auto-layout decides where a node
goes unless a position is set.

### `GraphImports`

`shared/src/schema/graph-import.ts`

| field | type | notes |
|---|---|---|
| `parent` | relation → `Graphs`, cascade | the importing graph |
| `child` | relation → `Graphs`, cascade | the imported graph |
| `alias` | text | `^[a-z0-9_]{1,40}$` — **the instance key**, unique per parent |
| `label` | text, optional | display override, e.g. "Port Battery Bank" |
| `order` | number | display order |
| `enabled` | bool, **not required** | exclude a subtree from resolution without deleting the link |
| `version` | relation → `GraphVersions`, optional, **no cascade** | pin this instance to a snapshot; absent means live |
| `attributeOverrides` | json, optional | attribute values this instance replaces |

Indexes: `UNIQUE (parent, alias)`, `(child)`.

`enabled` is deliberately declared `BoolField().optional()`. A *required* bool in
PocketBase means "must be true" — `false` fails validation as blank — so a
required `enabled` could be switched on and never off, which is the one thing the
field exists to do. Records still always carry a value: PocketBase stores `false`
rather than null, and `GraphImportInputSchema` defaults it to `true`.

```
list/view:  signed in && (parent.visibility != "private" || memberOf(parent.workspace))
create:     signed in && writerOf(parent.workspace)
              && (child.visibility != "private" || memberOf(child.workspace))
update:     same as create
delete:     signed in && writerOf(parent.workspace)
```

`version` and `attributeOverrides` are what make two instances of one child
differ without forking it. Both are covered in
[IMPORTS.md](IMPORTS.md#pinned-imports); the engine-facing half — overrides are
applied during flatten, *before* auto-connect — is in
[GRAPH_ENGINE.md](GRAPH_ENGINE.md#1-flatten).

Cycles and nesting depth are enforced by `pocketbase/pb_hooks/graph-imports.pb.js`,
not by rules — an API rule cannot walk an ancestor chain. Full semantics in
[IMPORTS.md](IMPORTS.md).

### `GraphEdgeOverrides`

`shared/src/schema/graph-edge-override.ts`

| field | type | notes |
|---|---|---|
| `graph` | relation → `Graphs`, cascade | the graph this override applies *in* |
| `mode` | select | `pin` (force a connection) · `suppress` (remove one) |
| `sourcePath` / `targetPath` | text | **instance paths**, not record ids |
| `sourcePort` / `targetPort` | text | port names on those nodes |
| `reason` | text, optional | why the derived wiring was wrong |

Indexes: `(graph)`, `UNIQUE (graph, sourcePath, sourcePort, targetPath, targetPort)`.

Rules follow `graph.workspace`, exactly as `GraphNodes` does.

Overrides do not inherit. One recorded against `BatterySystem` does not follow
that graph into a parent that imports it, because the instance paths differ.
The engine only ever loads the overrides of the root graph being rendered.

### `GraphVersions`

`shared/src/schema/graph-version.ts`

| field | type | notes |
|---|---|---|
| `graph` | relation → `Graphs`, cascade | |
| `version` | number | monotonic per graph |
| `snapshot` | json | the frozen picture — see below |
| `note` | text, optional | what changed |
| `createdBy` | relation → `Users` | |

Indexes: `UNIQUE (graph, version)`, `(graph)`.

```
list/view:  same reach as the graph — a pinned importer has to be able to read it
create:     signed in && writerOf(graph.workspace) && createdBy = @request.auth.id
update:     null — a version that can be edited is not a version
delete:     signed in && writerOf(graph.workspace)
```

There is no update rule, and that is deliberate rather than an oversight: a pin
points at a version by id, so an editable snapshot would let a version silently
change meaning underneath everyone who depended on it.

The snapshot payload is `GraphSnapshotSchema` in `lib/graph/primitives.ts`:

```ts
{
  format: number                     // refuses a payload from a newer writer
  graph: { uid, name, label, namespace?, description?, tags? }
  nodes:   SnapshotNode[]            // id, name, label, attributes, ports, position
  imports: SnapshotImport[]          // id, child, alias, label, order, enabled,
                                     // version, attributeOverrides
}
```

**The record ids are the originals, and that is load-bearing.** An instance path
ends in a `GraphNodes` id, and so does every `GraphEdgeOverride` endpoint on
every graph importing this one. Preserving the ids is what lets an import be
pinned to an old version without every override underneath it going stale — and
it is why `GraphVersionMutator.restore` *matches* existing nodes by id rather
than recreating them.

A snapshot is one level deep: it captures this graph's nodes and its own import
rows, not the graphs those rows name. See
[IMPORTS.md § Pinned imports](IMPORTS.md#pinned-imports) for what that means in
practice.

### `PortKinds`

`shared/src/schema/port-kind.ts`

`workspace` (optional), `key`, `label`, `color`, `description`,
`compatibleWith: string[]`. Indexes: `UNIQUE (workspace, key)`, `(key)`.

Two flavours since Phase 5. A row with **no** `workspace` is global: readable by
everyone including signed-out visitors, writable only by a superuser, because
letting one user rename `power` under another's feet is worse than an
admin-managed list. A row **with** a workspace is that workspace's own
vocabulary — invisible elsewhere, writable by its members, and it shadows a
global row of the same key for them. `PortKindMutator` sorts global rows first
so the shadowing falls out of the merge order.

`compatibleWith` is read symmetrically: `power/12v` listing `power` lets a
`power` output reach a `power/12v` input *and* the other way round. One-way
compatibility would mean declaring the same relationship twice to get the
behaviour anyone would expect from it.

The registry is **not a validation gate**. A port may name a kind with no row
here — it still connects to ports of the same kind and simply renders with the
neutral fallback colour. Its job is to stop the kind→colour map from being
hardcoded in components, which is what it was before.

Defaults are seeded from `DEFAULT_PORT_KINDS` in the schema file and by
`yarn db:seed`.

## Value objects

Defined in `shared/src/lib/graph/primitives.ts`. Stored as JSON on `GraphNodes`.

> These deliberately live in `lib/`, not in `shared/src/schema/`.
> `pocketbase-migrate` imports every file in the schema directory looking for a
> collection definition, and the exclude list must stay at its default.

### `Attribute`

```ts
{ name: string; value: string; unit?: string; kind: string }
```

`value` is always a string. The engine parses it as a float when a comparison
needs to be numeric and falls back to string comparison otherwise.

### `Port`

```ts
{
  name: string
  direction: "input" | "output"
  kind: string                       // the compatibility key
  relationship?: "one" | "many"      // absent means "one"
  isRequired?: boolean               // inputs only
  attributes?: PortAttribute[]
}
```

- `kind` is what makes two ports connectable: an output reaches only inputs of
  the same kind, or of a kind related to it by `compatibleWith`. That relation
  is **symmetric** — either kind listing the other is enough.
- `relationship` on an **output** caps fan-out — `one` stops after a single
  edge, `many` connects to every match.
- `relationship` on an **input** controls whether more than one output may claim
  it — `one` is claimed by its first connection.
- `isRequired` on an input that ends with zero connections produces an
  error-level diagnostic.

Port names are unique per direction, not per node: `supply` may exist once as an
input and once as an output, which is exactly how the sample `house_fuse` is
modelled.

### `PortAttribute` and filters

```ts
type PortAttribute = Attribute & { filter?: FilterGroup }

type ComparisonOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte"

interface FilterCondition { attribute: string; value: string; operator: ComparisonOperator }
interface FilterGroup     { logicalOperator: "AND" | "OR"; conditions: FilterCondition[] }
```

Filters live on **input** port attributes and are evaluated against the
candidate **source node's** attributes — not the source port's. `attribute`
names an attribute on that node. Comparison is numeric when both sides parse as
floats; otherwise only `eq`/`neq` apply and the ordering operators fail. A
missing attribute fails the condition.

Example, from the sample data: the Cerbo GX `supply` input accepts only sources
where `10 <= voltage <= 15`.

## Instance identity

A child graph can be imported more than once, so the same `GraphNodes` record
can appear several times in one resolved tree. Its record id therefore does not
identify it. The **instance path** does: the chain of `GraphImports.alias`
values from the root graph down to the graph that owns the node.

```
instancePath = ["port_bank", "cells"]
instanceId   = "port_bank/cells/<nodeId>"       // buildInstanceId()
instanceId   = "<nodeId>"                       // a node on the root graph
```

Everything derived is keyed by `instanceId`: flat nodes, edges, diagnostics,
layout positions, canvas selection, and the endpoints of `GraphEdgeOverrides`.
Helpers are in `shared/src/lib/graph/imports.ts`.

This is the single easiest thing to get wrong. Using a record id anywhere in the
derived layer looks correct until a graph is imported twice, at which point two
different components silently collapse into one.

## Schema vs. migrations

`shared/src/schema/*.ts` is where fields and rules are *authored*.
`pocketbase/pb_migrations/*.js` is what PocketBase applies on boot. **Editing a
schema file does not change the database.**

```bash
yarn db:status        # what has drifted
yarn db:generate      # write the migration (round-trips up()/down() before saving)
yarn db:verify        # what the local database actually applied
yarn db:verify-rules  # walk the access matrix against a *running* server
yarn typegen          # regenerate shared/src/types/pocketbase-types.ts
```

Two things the generator cannot work out on its own, both learned the hard way
in Phase 5:

- **A rule is validated against the schema when its collection is saved.** So a
  collection whose rules traverse a relation cannot be created before that
  relation exists, and two collections that reference each other have to be
  created with placeholder rules and joined up afterwards. The generator emits
  files in its own order; reordering and splitting them is a normal part of
  writing a migration that changes rules.
- **A data migration has to sit between the schema change and the rule swap.**
  Adding a required column, backfilling it, and switching the rules onto it is
  three migrations, not one — see
  [PHASE_5](phases/PHASE_5_LIBRARY_AND_SHARING.md) for the actual sequence.

`db:status` exits 0 even when it reports drift — parse
`pocketbase-migrate status --json` for `"status": "changes-pending"` if you need
a gate. `db:verify` and `db:lint` do exit non-zero.

## Sample data

`example/data/*.json` holds the original file-based dataset and
`yarn db:seed` loads it into a personal workspace for the demo user. The seed
deliberately imports `BatterySystem` **twice** — as `port_bank` and
`starboard_bank` — because that is the case the old model could not express and
the one every instance-path assumption has to survive.
