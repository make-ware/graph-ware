# Roadmap

Graph-Ware is built in phases. Each phase is independently shippable, has its
own document, and states explicitly what it does *not* cover so scope stays put.

| Phase | Document | Status |
|---|---|---|
| 1 | [Data model](PHASE_1_DATA_MODEL.md) | **Done** |
| 2 | [Graph engine](PHASE_2_GRAPH_ENGINE.md) | **Done** |
| 3 | [Viewer](PHASE_3_VIEWER.md) | **Done** |
| 4 | [Editor](PHASE_4_EDITOR.md) | **Done** |
| 5 | [Library and sharing](PHASE_5_LIBRARY_AND_SHARING.md) | **Done** |
| 6 | [Interop](PHASE_6_INTEROP.md) | Next |

## Shape of a phase document

Every one follows the same layout, so they can be skimmed side by side:

- **Goal** — one paragraph on what exists at the end that did not before.
- **In scope / Out of scope** — the second list is the load-bearing one.
- **Data and API surface** — collections, fields and rules touched.
- **Files** — what gets created or changed.
- **Acceptance criteria** — checkable statements, not aspirations.
- **Open questions** — decisions deliberately deferred.

## Dependencies

```
1 Data model
    └── 2 Graph engine
            ├── 3 Viewer
            │       └── 4 Editor
            │               ├── 5 Library and sharing
            │               └── 6 Interop
            └── 6 Interop  (import/export needs the engine for validation)
```

Phase 5 and 6 are independent of each other and can be reordered by whichever
is more useful at the time.

## Background

Read [DESIGN.md](../DESIGN.md) first for the principles the phases are built
on, then [DATA_MODEL.md](../DATA_MODEL.md) for the collections. The upstream
Node-Ware documentation in [`example/`](../../example/) is the original design
these phases adapt.
