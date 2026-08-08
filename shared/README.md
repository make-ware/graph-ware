# @project/shared

The domain layer of graph-ware: PocketBase collection schemas, the graph value
objects and engine, the mutators, and the auth service. Consumed by
`@project/webapp` and `@project/cli`, and read directly off disk by
`pocketbase-migrate` (see `pocketbase-migrate.config.mjs` at the repo root).

## Source-only — there is no build step

The `exports` map points at raw `.ts` files. Consumers compile them:

- the webapp declares `transpilePackages: ['@project/shared']` in `next.config.ts`
- the CLI registers tsx's ESM loader in `cli/bin/graphware.js`
- `pocketbase-migrate` runs under `NODE_OPTIONS="--import tsx"`

That is deliberate. A `dist/` would add build ordering to `yarn dev`, both
Dockerfiles and every typecheck, and a stale one is a real failure mode.

## Entry points

| Specifier | Contents |
| --- | --- |
| `@project/shared` | schemas, graph primitives, import helpers, engine, snapshot, layout, `errors`/`retry`/`loading-manager` |
| `@project/shared/schema` | the collection definitions alone |
| `@project/shared/mutators` | the `BaseMutator` subclasses |
| `@project/shared/graph` | `resolver` + `clone` — the two graph operations that take a PocketBase client |
| `@project/shared/types` | `TypedPocketBase` and response/utility types |
| `@project/shared/client` | `createPocketBaseClient(url, options)` |
| `@project/shared/services` | `AuthService` / `createAuthService` |
| `@project/shared/test-fixtures` | mock PocketBase + sample graphs, for consumers' tests |

`resolver` and `clone` are kept off the bare barrel so importing
`@project/shared` never drags the SDK in — the same rule that applied before
this package existed, when they lived at `@/lib/graph/…`.

## Rules

- **Stay headless.** No `react`, no `next`, no `'use client'`, no
  `process.env.NEXT_PUBLIC_*`. The webapp owns the env var and the client
  singleton; this package owns the factory.
- **Never import `@project/shared` from inside `shared/`.** Self-referencing
  would break `pocketbase-migrate`, which loads `src/schema/*.ts` through tsx
  from the repo root where the resolution root is the repo, not the package.
- **Keep `zod` and `pocketbase` versions byte-identical to the other
  workspaces.** Two copies break cross-boundary `instanceof` — a second
  `ClientResponseError` class would silently degrade every error
  `parseAuthError` touches.
- **`src/lib/graph/primitives.ts` must stay out of `src/schema/`**, which
  `pocketbase-migrate` scans for `defineCollection` exports.
