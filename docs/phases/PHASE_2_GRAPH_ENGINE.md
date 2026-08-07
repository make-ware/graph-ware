# Phase 2 — Graph Engine

**Status: next.**

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
webapp/src/lib/graph/resolver.ts       ResolvedGraph from a graph id
webapp/src/lib/graph/engine.ts         flatten → connect → override → validate → layout
webapp/src/lib/graph/filters.ts        FilterGroup evaluation, extracted for testing
webapp/src/lib/graph/layout.ts         dagre wrapper
webapp/src/lib/graph/types.ts          FlatNode, FlatEdge, GraphDiagnostic, ResolvedGraph
webapp/src/hooks/use-port-kinds.ts
webapp/src/test/__tests__/graph-engine-*.test.ts
```

Add `@dagrejs/dagre` to `webapp/package.json`. `@xyflow/react` is already there.

Export the pure pieces from `@project/shared` (`webapp/src/shared/index.ts`);
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

- [ ] Resolving `testDataElement` yields three children, two of them the same
      `BatterySystem` under different aliases, with distinct instance ids for
      every node.
- [ ] `enabled: false` on an import omits that subtree and produces an
      `import-disabled` diagnostic.
- [ ] A graph nested past `MAX_IMPORT_DEPTH` truncates with
      `resolution-truncated` rather than looping.
- [ ] A resolver run against a tree containing a cycle (constructed directly,
      bypassing the hook) terminates with a warning.
- [ ] The Cerbo GX `supply` input connects only to sources with
      `10 <= voltage <= 15`, and its `isRequired` diagnostic clears once one is
      present.
- [ ] Ordering operators against a non-numeric attribute fail the condition
      rather than comparing strings.
- [ ] `house_fuse` fans out to every compatible input (`many`) while a `one`
      output stops after its first edge.
- [ ] Shuffling the input node order produces byte-identical engine output.
- [ ] A `pin` satisfies an `isRequired` input; a `suppress` removes exactly one
      edge and does not reopen matching.
- [ ] An override naming a nonexistent path yields `stale-override`, not a
      crash.
- [ ] `yarn precommit` passes.

## Open questions

- **Where do resolved trees get cached?** A React context per viewer page is the
  obvious answer, but a shared module-level cache would survive navigation. Defer
  until Phase 3 shows the access pattern.
- **Should `compatibleWith` be symmetric?** If `power/12v` lists `power`, does
  `power` accept `power/12v`? Currently one-directional from the output's kind.
  Nothing exercises it yet.
- **Layout for very wide graphs.** Dagre handles the sample data fine; a
  hundred-node tree may want ELK instead. Measure before switching.
