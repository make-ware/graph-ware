# Phase 5 — Library and Sharing

**Status: done.** Depends on Phase 4. Independent of Phase 6.

## Goal

Make reuse work across people and across time. A browsable library of published
graphs, the ability to fork one into your own workspace, team ownership instead
of a single owner, and versioned imports so editing a shared component does not
silently rewire everyone who depends on it.

This is where the model stops being single-player.

## In scope

- **Library browse and search** — `/library`, over `visibility = "public"`,
  filtered by tags, port kinds present, and node count; "used by N graphs" as a
  quality signal.
- **Clone / fork** — copy a graph and, optionally, its whole import subtree into
  your own space, with a `forkedFrom` link back to the original.
- **Workspaces** — a `Workspaces` collection with members and roles, replacing
  `Graphs.owner` as the ownership anchor. Access rules move from
  `owner = @request.auth.id` to a membership lookup.
- **Versions** — `GraphVersions` snapshots (nodes plus imports, as JSON) taken
  on publish and before destructive edits.
- **Pinned imports** — an optional `version` on `GraphImports`. Unpinned means
  "always current", pinned means "this snapshot"; the editor surfaces "3 newer
  versions available".
- **Per-import overrides** — an `attributeOverrides` JSON field on
  `GraphImports` so one instance can differ (`starboard_bank` at 24 V) without
  forking the child.
- **User-defined port kinds** — `PortKinds` gains an optional `workspace`, and
  writes open up from superuser-only to workspace members.

## Out of scope

- A public marketplace, ratings, or payments.
- Real-time collaborative editing (OT/CRDT). Last-write-wins stands.
- Cross-workspace permissions finer than member/admin.

## Data and API surface

The largest schema change since Phase 1, and the first one that rewrites
existing rules.

**New collections**

| Collection | Purpose |
|---|---|
| `Workspaces` | name, slug, plus a `WorkspaceMembers` join with a role |
| `WorkspaceMembers` | workspace, user, role (`admin` \| `member` \| `viewer`) |
| `GraphVersions` | graph, version, snapshot JSON, note, createdBy |

**Changed fields**

- `Graphs.workspace` — relation, replacing `owner` as the scope anchor.
  `owner` stays as "who created it".
- `Graphs.forkedFrom` — optional self-relation.
- `GraphImports.version` — optional relation to `GraphVersions`; null means
  live.
- `GraphImports.attributeOverrides` — JSON.
- `PortKinds.workspace` — optional; null rows stay global.
- `Graphs.namespace` — decide its fate. It has been presentation-only since
  Phase 1 and workspaces subsume its grouping role.

**Rule rewrite.** Every collection's rules move from
`owner = @request.auth.id` to a workspace-membership lookup, e.g.
`workspace.members_via_workspace.user ?= @request.auth.id`. Get this wrong and
private data leaks; it deserves its own test pass with at least three users in
two workspaces.

**Migration.** Existing graphs need a personal workspace per user, backfilled
from `owner`, before the rules can switch over. Two migrations, not one:
create-and-backfill, then swap the rules.

> Built as **three**, plus two more that the generator's ordering could not
> express. In file order:
>
> | Migration | What it does |
> |---|---|
> | `…900_created_Workspaces` | owner-only rules |
> | `…901_created_WorkspaceMembers` | owner-only rules |
> | `…902_updated_workspace_rules` | closes the loop between them |
> | `…903_updated_Graphs_workspace` | adds `workspace` (**not required**) and `forkedFrom` |
> | `…904_backfill_workspaces` | a personal workspace per user; every graph pointed at it |
> | `…905_updated_Graphs_rules` | `workspace` required, index swap, rule swap |
> | `…906`–`…910` | `GraphVersions`, then the remaining field and rule changes |
>
> Two constraints forced the shape, and neither is visible from the schema:
>
> - **PocketBase validates an API rule against the schema when the collection is
>   saved.** `Workspaces` and `WorkspaceMembers` reference each other — the
>   workspace rules look up the roll through `WorkspaceMembers_via_workspace`,
>   the membership rules look up `workspace.owner` — so neither can be created
>   carrying its final rules. Both are created owner-only and `…902` closes the
>   loop. The same constraint puts `GraphVersions` *after* `Graphs.workspace`
>   exists, because its rules traverse `graph.workspace`.
> - **An index name cannot be reused across a swap in the same migration.**
>   `PortKinds` was replacing `UNIQUE (key)` with a non-unique `(key)`; adding
>   before dropping failed with "The index name already exists". The replacement
>   is now `idx_port_kinds_key_lookup`, which also stops one name meaning
>   `UNIQUE` before the migration and non-unique after.

## Files

```
webapp/src/schema/workspace.ts
webapp/src/schema/workspace-member.ts
webapp/src/schema/graph-version.ts
webapp/src/mutators/workspace.ts
webapp/src/mutators/graph-version.ts
webapp/src/lib/graph/clone.ts            deep or shallow fork
webapp/src/lib/graph/snapshot.ts         serialize/restore a graph version
webapp/src/app/(shell)/library/page.tsx
webapp/src/app/(shell)/workspaces/[slug]/…
webapp/src/components/graph/editor/version-panel.tsx
webapp/src/components/graph/editor/import-version-picker.tsx
pocketbase/pb_migrations/*               generated, incl. the backfill
```

The route paths gained their `(shell)` prefix — the sketch predates Phase 3's
`(shell)` / `(viewer)` split, and both of these are ordinary pages with nav
chrome.

Built as planned, plus these the sketch did not anticipate:

```
webapp/src/schema/permissions.ts                  shared access-rule fragments
webapp/src/mutators/workspace-member.ts
webapp/src/contexts/workspace-context.tsx
webapp/src/hooks/use-workspaces.ts
webapp/src/components/layout/workspace-switcher.tsx
webapp/src/components/graph/fork-dialog.tsx
webapp/src/components/graph/editor/import-override-editor.tsx
pocketbase/pb_hooks/workspaces.pb.js              personal workspace on signup
pocketbase/pb_hooks/workspaces-guard.js
scripts/verify-workspace-rules.mjs                yarn db:verify-rules
```

Three of those are worth a sentence each.

**`schema/permissions.ts`** exists because the membership expression is long,
appears on six collections at three relation depths, and a typo in it leaks
somebody else's private graph. Building it from `memberOf` / `writerOf` /
`adminOf` means there is one place to be wrong. It lands in `schema/` and stays
out of collection discovery because `permissions.ts` is already on
`pocketbase-migrate`'s default `schema.exclude` list — which is another reason
that list must stay at its default.

**`pb_hooks/workspaces.pb.js`** provisions the personal workspace on signup.
This cannot be the client's job: signup goes through the auth endpoint, and a
client that forgets the second call — or crashes between the two — leaves an
account that can read nothing of its own and create nothing at all, because
`Graphs.workspace` is required. Its tag is `Users`, capitalized: that is the
collection's real name, and a hook tag is matched exactly. The lowercase
spelling that works everywhere else is routing sugar, and a mistyped tag fails
by silently never firing — which is exactly how this was found.

**`restore` went on `GraphVersionMutator`, not in `snapshot.ts`.** The sketch
put "serialize/restore" in one file, but restoring writes records and therefore
needs a PocketBase client, while `snapshot.ts` is pure and exported through
`@project/shared`. Serialization, parsing and the record-shaped views of a
snapshot live in `snapshot.ts`; the two operations that touch the network live
with the other network code.

## Design notes

**Pinning is opt-in.** Defaulting to pinned would freeze every existing import
at its current state and make the library feel dead. Defaulting to live keeps
today's behaviour and makes pinning a deliberate act for systems that need
stability.

**A fork is a copy, and copies drift.** `forkedFrom` records provenance, not a
relationship — there is no merge. Say so in the UI so nobody expects one.

**Deep fork needs a depth guard too.** Cloning a subtree walks the same import
graph the resolver does, with the same cycle and depth risks. Reuse
`checkImport` and `MAX_IMPORT_DEPTH` rather than writing a second traversal.

**Per-import overrides interact with the engine.** An `attributeOverrides` entry
has to be applied during flatten, before auto-connect, or a voltage override
will not affect filter evaluation. That is a Phase 2 contract change — update
[GRAPH_ENGINE.md](../GRAPH_ENGINE.md) alongside.

**Version snapshots are JSON, not records.** A version is an immutable blob,
never queried field-by-field. Restoring one recreates records.

> With one correction that turned out to matter more than the rest of the
> design: **restoring matches existing nodes by record id rather than recreating
> them.** An instance path ends in a `GraphNodes` id, and so does every
> `GraphEdgeOverride` endpoint on every graph that imports this one. Recreating
> the nodes would restore the picture here and quietly break the wiring
> corrections of every parent. For the same reason a snapshot stores the
> original ids, and a pinned import renders with the node ids its importer
> already addresses.

**The rules are verified against a real server, not a mock.** `?=` and `?!=`
carry the whole role model: `members.user ?= me && members.role ?!= "viewer"`
has to be satisfied by *one* roll row, or "I am a member" and "somebody here is
not a viewer" become independent questions and every viewer gets write access.
No unit test can assert that — it is a property of PocketBase's filter engine —
so `yarn db:verify-rules` signs up three users into two workspaces and walks the
matrix through the ordinary API with no superuser credentials anywhere. It is
deliberately not part of `precommit`, which needs no running server.

## Acceptance criteria

The access-rule and migration criteria are verified against a real PocketBase —
`yarn db:verify-rules` for the first group, and a database built at the
pre-Phase-5 migration state and then migrated forward for the last. The rest are
unit tests over the pure layers.

- [x] A user in two workspaces sees exactly the graphs of both and nothing else.
- [x] Removing a member revokes access immediately.
- [x] A public graph can be forked; the fork is independent and records
      `forkedFrom`.
- [x] Deep-forking `testDataElement` copies `BatterySystem` once and rewires
      both import instances to the copy.
- [x] Publishing a graph creates a `GraphVersions` snapshot.
- [x] A pinned import keeps rendering the pinned snapshot after the child is
      edited; an unpinned one picks the change up.
- [x] The editor shows "newer version available" on a stale pinned import.
- [x] `starboard_bank` with a `voltage` override renders differently from
      `port_bank`, including in filter-driven connections.
- [x] A workspace-scoped port kind is invisible to other workspaces; global
      kinds stay visible to all.
- [x] The rule-rewrite migration leaves no graph unreachable by its original
      owner.
- [x] `yarn precommit` passes.

### The migration was tested on data, not on an empty database

A migration that only ever runs against a fresh schema proves nothing about the
case it exists for. The backfill was verified by building a database at the
pre-Phase-5 state, signing users up and creating graphs through the ordinary
API — including **two graphs with the same `uid` in different namespaces owned
by the same user** — and only then migrating forward. Afterwards: one personal
workspace per user with slugs deduplicated (`probe`, `probe-2`), an admin roll
row each, zero graphs with a blank workspace, and each original owner still able
to list, read and edit everything they had. Every migration also rolls back and
forward again cleanly.

That same-uid-two-namespaces row is the one that decided the uniqueness
question below. Under `UNIQUE (workspace, uid)` the migration would have failed
on it.

## Answered questions

- **What does deleting a published graph do to its forks and importers?**
  *Unchanged from Phase 1: the cascade stands, and no tombstone was added.*
  Forks survive by construction — `forkedFrom` is declared
  `cascadeDelete: false`, which is the whole of what "a fork is a copy" means
  mechanically. Importers still break, and still degrade to a `child-unreadable`
  diagnostic on the branch rather than a failed render, which is the behaviour
  the resolver has had since Phase 2 and which the delete dialog already warns
  about by naming the importers. Soft delete is a real improvement and a real
  new state to carry through every rule and query; it did not earn its place
  against "the existing warning already tells you who breaks".
- **Does a version pin the imports too, or only the nodes?** *Both, one level
  deep.* A snapshot captures the graph's own nodes **and** its own import rows —
  including any pins and attribute overrides those rows carried — so a pinned
  import renders the child exactly as it was, with the import structure it had.
  The graphs those rows name are not copied into the snapshot, so a
  grandchild still resolves live unless the snapshotted row pinned it too.
  Freezing transitively is correct in principle and was rejected on cost: every
  publish would copy the whole subtree, and a shared library component would be
  duplicated into every snapshot that reaches it. The consequence is documented
  where someone will hit it — [IMPORTS.md § Pinned
  imports](../IMPORTS.md#pinned-imports) — rather than left to be discovered.
- **Workspace-scoped uniqueness.** *`UNIQUE (workspace, namespace, uid)`, and
  `namespace` stays.* Dropping `namespace` and keying on `(workspace, uid)` is
  tidier and would have broken real data: one personal workspace per user makes
  `(owner, namespace, uid)` and `(workspace, namespace, uid)` exactly
  equivalent, so no row that satisfied the old index can violate the new one and
  nobody's graph has to be renamed by a migration. `(workspace, uid)` has no
  such guarantee — two graphs one user filed under `boats` and `trucks` collide
  — and a backfill that renames somebody's graphs to make an index build is not
  a backfill anyone should run.

  So `namespace` survives, demoted rather than removed: it is half the
  uniqueness key and a label on the card, and it is no longer the organizing
  idea. `/graphs` groups by workspace now, which is what workspaces were for.

### Three bugs only a real server found

None of these had a failing unit test, because in each case the mock agreed
with the code and the server did not.

- **`BaseMutator.isNotFoundError` matched on the error message.** PocketBase's
  `ClientResponseError` reads "The requested resource wasn't found." — no
  `404`, no `not found` — so `getFirstByFilter` threw on every real 404 instead
  of returning `null`. Latent since Phase 1 and harmless until Phase 5 made
  "is there a row matching this filter?" the basis of half the data layer
  (`personal()`, `getBySlug()`, `availableSlug()`, `latestForGraph()`). It now
  checks `status`, and the test fixture grew `notFoundError()` so nobody mocks a
  404 as `new Error('404 not found')` again — which is exactly what let the old
  behaviour pass its tests.
- **`snapshotMatches` compared raw `JSON.stringify` output.** PocketBase stores
  a JSON field by marshalling it in Go, which sorts map keys alphabetically, so
  a snapshot read back off a record never matched the one `serializeGraph` had
  just produced. Every publish minted a version that changed nothing, and the
  "nothing has changed since v3" check could never fire. Fixed with a canonical
  serializer that sorts keys.
- **`cloneGraph` passed `null` into `.optional()` fields.** PocketBase returns
  `null` for an unset optional JSON column; zod's `.optional()` accepts
  `undefined` and rejects `null`. Forking any graph with an unpositioned node —
  which is all of them by default — failed validation before a single record
  was written.

The lesson is not "write more unit tests"; it is that the boundary between the
zod schemas and PocketBase's own conventions is where the bugs are, and the
only thing that exercises it is a running server. `yarn db:verify-rules` covers
the rules half of that boundary permanently.

## Two things worth knowing before touching this again

**`canEdit`, not `isOwner`.** Every "may I change this?" check in the UI moved
from `graph.owner === me` to "am I a non-viewer member of `graph.workspace`?".
`isOwner` still exists and still means what it says — who created it — but it
decides nothing. `GraphViewerProvider` loads membership itself rather than
reading `WorkspaceProvider`, because the viewer lives under `(viewer)`, a bare
full-bleed layout with no navigation chrome to hang a provider off. Neither
flag is the security boundary; the collection rules are.

**Forking is offered from `/graphs` and `/library`, not from the viewer.** Both
of those are under `(shell)`, where `WorkspaceProvider` is mounted and the fork
dialog can ask which workspaces you can write. Putting it in the viewer sidebar
would mean either mounting a second membership fetch on that route or making the
viewer depend on the shell's provider — neither worth it for a button that
already exists one click away. The read-only editor message links to the library
for exactly this reason.
