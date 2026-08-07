# Phase 5 — Library and Sharing

**Status: planned.** Depends on Phase 4. Independent of Phase 6.

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

## Files

```
webapp/src/schema/workspace.ts
webapp/src/schema/workspace-member.ts
webapp/src/schema/graph-version.ts
webapp/src/mutators/workspace.ts
webapp/src/mutators/graph-version.ts
webapp/src/lib/graph/clone.ts            deep or shallow fork
webapp/src/lib/graph/snapshot.ts         serialize/restore a graph version
webapp/src/app/library/page.tsx
webapp/src/app/workspaces/[slug]/…
webapp/src/components/graph/editor/version-panel.tsx
webapp/src/components/graph/editor/import-version-picker.tsx
pocketbase/pb_migrations/*               generated, incl. the backfill
```

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

## Acceptance criteria

- [ ] A user in two workspaces sees exactly the graphs of both and nothing else.
- [ ] Removing a member revokes access immediately.
- [ ] A public graph can be forked; the fork is independent and records
      `forkedFrom`.
- [ ] Deep-forking `testDataElement` copies `BatterySystem` once and rewires
      both import instances to the copy.
- [ ] Publishing a graph creates a `GraphVersions` snapshot.
- [ ] A pinned import keeps rendering the pinned snapshot after the child is
      edited; an unpinned one picks the change up.
- [ ] The editor shows "newer version available" on a stale pinned import.
- [ ] `starboard_bank` with a `voltage` override renders differently from
      `port_bank`, including in filter-driven connections.
- [ ] A workspace-scoped port kind is invisible to other workspaces; global
      kinds stay visible to all.
- [ ] The rule-rewrite migration leaves no graph unreachable by its original
      owner.
- [ ] `yarn precommit` passes.

## Open questions

- **What does deleting a published graph do to its forks and importers?** Forks
  are copies and survive. Importers break. Soft delete with a tombstone may be
  kinder than a cascade.
- **Does a version pin the imports too, or only the nodes?** Pinning only nodes
  makes a "pinned" tree still shift underneath. Snapshotting transitively is
  correct but expensive.
- **Workspace-scoped uniqueness.** Today `UNIQUE (owner, namespace, uid)`. With
  workspaces it becomes `(workspace, uid)` — and every existing row has to
  satisfy it before the index can be created.
