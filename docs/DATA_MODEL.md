# Graph-Ware Data Model

Reference for the collections, their rules, and the JSON value objects stored on
them. Source of truth: `webapp/src/schema/*.ts` (collections and access rules)
and `webapp/src/lib/graph/primitives.ts` (value objects). The database is built
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
  must inject `owner` itself.

## Collections

| Collection | Purpose | Owned via |
|---|---|---|
| `Graphs` | A system, subsystem, or reusable library | `owner` |
| `GraphNodes` | An element inside a graph | `graph.owner` |
| `GraphImports` | One graph importing another | `parent.owner` |
| `GraphEdgeOverrides` | A pinned or suppressed connection | `graph.owner` |
| `PortKinds` | Registry of connection types | global read, superuser write |

### `Graphs`

`webapp/src/schema/graph.ts`

| field | type | notes |
|---|---|---|
| `owner` | relation → `Users`, cascade | must equal the caller on create |
| `uid` | text | `^[A-Za-z0-9_-]{1,64}$` — the human reference key, kept for import/export |
| `name` | text | machine name, `^[a-z0-9_]+$` |
| `label` | text | display name |
| `namespace` | text, optional | `^[a-z0-9]{1,32}$` — a flat grouping label |
| `description` | text, optional | |
| `visibility` | select | `private` · `unlisted` · `public` |
| `tags` | json | `string[]`, for library search |

Indexes: `UNIQUE (owner, namespace, uid)`, `(owner)`, `(visibility)`.

```
list/view:      @request.auth.id != "" && (owner = @request.auth.id || visibility != "private")
create:         @request.auth.id != "" && owner = @request.auth.id
update/delete:  @request.auth.id != "" && owner = @request.auth.id
```

`namespace` is presentation only. In the file-based original it was a directory
and carried lookup semantics — child graphs were searched for in the parent's
namespace first. Nothing here depends on it.

### `GraphNodes`

`webapp/src/schema/graph-node.ts`

| field | type | notes |
|---|---|---|
| `graph` | relation → `Graphs`, cascade | |
| `name` | text | machine name; unique within the graph |
| `label` | text | display name |
| `attributes` | json | `Attribute[]` |
| `ports` | json | `Port[]` |
| `position` | json, optional | `{x, y}` manual layout override |

Indexes: `(graph)`, `UNIQUE (graph, name)`.

Rules resolve ownership through the parent rather than a denormalized `owner`
column — `graph.owner = @request.auth.id` for writes,
`graph.owner = @request.auth.id || graph.visibility != "private"` for reads.
Nested relation lookups are supported by PocketBase
([PB_COLLECTIONS.md](PB_COLLECTIONS.md)) and cannot drift the way a copied
column can.

`position` is absent by default; the engine's auto-layout decides where a node
goes unless a position is set.

### `GraphImports`

`webapp/src/schema/graph-import.ts`

| field | type | notes |
|---|---|---|
| `parent` | relation → `Graphs`, cascade | the importing graph |
| `child` | relation → `Graphs`, cascade | the imported graph |
| `alias` | text | `^[a-z0-9_]{1,40}$` — **the instance key**, unique per parent |
| `label` | text, optional | display override, e.g. "Port Battery Bank" |
| `order` | number | display order |
| `enabled` | bool | exclude a subtree from resolution without deleting the link |

Indexes: `UNIQUE (parent, alias)`, `(child)`.

```
list/view:  @request.auth.id != "" && (parent.owner = @request.auth.id || parent.visibility != "private")
create:     @request.auth.id != "" && parent.owner = @request.auth.id
              && (child.owner = @request.auth.id || child.visibility != "private")
update:     same as create
delete:     @request.auth.id != "" && parent.owner = @request.auth.id
```

Cycles and nesting depth are enforced by `pocketbase/pb_hooks/graph-imports.pb.js`,
not by rules — an API rule cannot walk an ancestor chain. Full semantics in
[IMPORTS.md](IMPORTS.md).

### `GraphEdgeOverrides`

`webapp/src/schema/graph-edge-override.ts`

| field | type | notes |
|---|---|---|
| `graph` | relation → `Graphs`, cascade | the graph this override applies *in* |
| `mode` | select | `pin` (force a connection) · `suppress` (remove one) |
| `sourcePath` / `targetPath` | text | **instance paths**, not record ids |
| `sourcePort` / `targetPort` | text | port names on those nodes |
| `reason` | text, optional | why the derived wiring was wrong |

Indexes: `(graph)`, `UNIQUE (graph, sourcePath, sourcePort, targetPath, targetPort)`.

Overrides do not inherit. One recorded against `BatterySystem` does not follow
that graph into a parent that imports it, because the instance paths differ.
The engine only ever loads the overrides of the root graph being rendered.

### `PortKinds`

`webapp/src/schema/port-kind.ts`

`key` (unique), `label`, `color`, `description`, `compatibleWith: string[]`.
Readable by everyone including signed-out visitors; writable only by superusers.

The registry is **not a validation gate**. A port may name a kind with no row
here — it still connects to ports of the same kind and simply renders with the
neutral fallback colour. Its job is to stop the kind→colour map from being
hardcoded in components, which is what it was before.

Defaults are seeded from `DEFAULT_PORT_KINDS` in the schema file and by
`yarn db:seed`.

## Value objects

Defined in `webapp/src/lib/graph/primitives.ts`. Stored as JSON on `GraphNodes`.

> These deliberately live in `lib/`, not in `webapp/src/schema/`.
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
  the same kind (or one listed in that kind's `compatibleWith`).
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
Helpers are in `webapp/src/lib/graph/imports.ts`.

This is the single easiest thing to get wrong. Using a record id anywhere in the
derived layer looks correct until a graph is imported twice, at which point two
different components silently collapse into one.

## Schema vs. migrations

`webapp/src/schema/*.ts` is where fields and rules are *authored*.
`pocketbase/pb_migrations/*.js` is what PocketBase applies on boot. **Editing a
schema file does not change the database.**

```bash
yarn db:status      # what has drifted
yarn db:generate    # write the migration (round-trips up()/down() before saving)
yarn db:verify      # what the local database actually applied
yarn typegen        # regenerate webapp/src/types/pocketbase-types.ts
```

`db:status` exits 0 even when it reports drift — parse
`pocketbase-migrate status --json` for `"status": "changes-pending"` if you need
a gate. `db:verify` and `db:lint` do exit non-zero.

## Sample data

`example/data/*.json` holds the original file-based dataset and
`yarn db:seed` loads it. The seed deliberately imports `BatterySystem` **twice**
— as `port_bank` and `starboard_bank` — because that is the case the old model
could not express and the one every instance-path assumption has to survive.
