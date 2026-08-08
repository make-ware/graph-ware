# Phase 2 — Graph Engine

**Status: done.**

## Goal

Turn stored records into a picture's worth of data. At the end of this phase a
function takes a graph id and returns flat nodes, derived edges, diagnostics and
positions — fully tested, with no DOM and no canvas. Phase 3 renders it.

The contract is already written: [GRAPH_ENGINE.md](../GRAPH_ENGINE.md). This
document is the build plan for it.

## In scope

- **Resolver** — breadth-first load of a graph and its import tree, batched one
  request per depth level, memoized by graph id, guarded by `MAX_IMPORT_DEPTH`
  and `MAX_RESOLVED_NODES`.
- **Flatten** — every node in the tree with its instance path, breadcrumb and
  per-instance colour index.
- **Auto-connect** — kind matching, `one`/`many` budgets, filter evaluation.
- **Override application** — `pin` and `suppress` against the root graph's
  overrides.
- **Validation** — the diagnostic codes listed in the contract.
- **Layout** — dagre, left-to-right, honouring stored `position` overrides.
- A `usePortKinds` hook wrapping `PortKindMutator.colorMap()` so the canvas
  never hardcodes a colour.

## Out of scope

- Rendering. No XYFlow, no components, no routes.
- Realtime. The engine recomputes from data handed to it; who subscribes is
  Phase 3's problem.
- Caching resolved trees across navigations.
- A server-side resolved endpoint — Phase 6, once the shape has settled.

## Data and API surface

Reads only, through the Phase 1 mutators:

- `GraphMutator.getById`
- `GraphImportMutator.listForParents` (batched, one call per depth level)
- `GraphNodeMutator.listForGraphs` (batched)
- `GraphEdgeOverrideMutator.listForGraph` (root graph only)
- `PortKindMutator.colorMap`

No schema changes. No new collections.

## Files

```
shared/src/lib/graph/resolver.ts       ResolvedGraph from a graph id
shared/src/lib/graph/engine.ts         flatten → connect → override → validate → layout
shared/src/lib/graph/filters.ts        FilterGroup evaluation, extracted for testing
shared/src/lib/graph/layout.ts         dagre wrapper
shared/src/lib/graph/types.ts          FlatNode, FlatEdge, GraphDiagnostic, ResolvedGraph
webapp/src/hooks/use-port-kinds.ts
webapp/src/test/__tests__/graph-engine-*.test.ts
```

Add `@dagrejs/dagre` to `webapp/package.json`. `@xyflow/react` is already there.

Export the pure pieces from `@project/shared` (`shared/src/index.ts`);
keep the resolver out of it, since it takes a PocketBase client.

## Design notes

**Keep the resolver and the engine separate.** The resolver touches the network;
the engine is pure. Only the second one is worth testing exhaustively, and it
can only be tested that way if the split holds.

**Colour indices are per instance, not per graph.** `port_bank` and
`starboard_bank` are two visual groups even though they are one `BatterySystem`.
Assign in traversal order for stability.

**Suppression is single-pass.** Removing an edge does not free its target input
for the runner-up. Re-running matching after suppression would make the result
depend on override order; predictability wins.

**Determinism is a requirement, not a nicety.** Name-sorted nodes, declaration-
ordered ports, greedy first-match. There should be a test that shuffles the
input and asserts identical output.

## Acceptance criteria

- [x] Resolving `testDataElement` yields three children, two of them the same
      `BatterySystem` under different aliases, with distinct instance ids for
      every node.
- [x] `enabled: false` on an import omits that subtree and produces an
      `import-disabled` diagnostic.
- [x] A graph nested past `MAX_IMPORT_DEPTH` truncates with
      `resolution-truncated` rather than looping.
- [x] A resolver run against a tree containing a cycle (constructed directly,
      bypassing the hook) terminates with a warning.
- [x] The Cerbo GX `supply` input connects only to sources with
      `10 <= voltage <= 15`, and its `isRequired` diagnostic clears once one is
      present.
- [x] Ordering operators against a non-numeric attribute fail the condition
      rather than comparing strings.
- [x] `house_fuse` fans out to every compatible input (`many`) while a `one`
      output stops after its first edge.
- [x] Shuffling the input node order produces byte-identical engine output.
- [x] A `pin` satisfies an `isRequired` input; a `suppress` removes exactly one
      edge and does not reopen matching.
- [x] An override naming a nonexistent path yields `stale-override`, not a
      crash.
- [x] `yarn precommit` passes.

## Open questions

- **Where do resolved trees get cached?** A React context per viewer page is the
  obvious answer, but a shared module-level cache would survive navigation. Defer
  until Phase 3 shows the access pattern.
- **Should `compatibleWith` be symmetric?** *Resolved: yes.* An output reaches
  an input when either kind's row lists the other. One-way compatibility would
  have meant declaring the same relationship twice to get the behaviour anyone
  would expect from it. `docs/GRAPH_ENGINE.md` and `docs/DATA_MODEL.md` say so
  now; the sample data still declares no `compatibleWith`, so the unit tests are
  what exercise it.
- **Layout for very wide graphs.** Dagre handles the sample data fine; a
  hundred-node tree may want ELK instead. Measure before switching.

## Decisions taken while building

Four points the contract left open, each now written into
[GRAPH_ENGINE.md](../GRAPH_ENGINE.md):

- **No self-edges.** An output never reaches an input on the same node
  instance. `house_fuse` declares `supply` in both directions; a self-loop
  there means nothing and would spend its budget.
- **`portIndex` counts the node's full `ports` array**, so `house_fuse` yields
  `supply-out-0` and `supply-in-1`. Phase 3 must derive handle ids the same way.
- **`import-cycle`** joins the diagnostic table as a warning. The hook makes it
  unreachable in practice; it exists so a malformed database prunes a branch
  instead of hanging.
- **A stored `position` applies only to root-graph nodes.** It lives on the
  `GraphNodes` record, so an imported node reports the same coordinates under
  every alias — honouring it below the root would stack `port_bank` and
  `starboard_bank` exactly on top of each other. A per-instance position store
  is Phase 4's problem.
