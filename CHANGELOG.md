# Changelog

## 1.0.0 (2026-08-31)


### ⚠ BREAKING CHANGES

* make @project/shared a real workspace instead of a tsconfig alias
* `Graphs.workspace` is required and every collection's access rules go through workspace membership. Existing databases are migrated by `1786153904_backfill_workspaces.js`, which gives each user a personal workspace and points their graphs at it.
* replace boilerplate schema with the graph-ware data model

### Features

* add the editor's write layer over the viewer context ([f5e3170](https://github.com/make-ware/graph-ware/commit/f5e3170812dfe2cdf768c13c54a0052229000a5a))
* build a graph from inside the app ([740f2a3](https://github.com/make-ware/graph-ware/commit/740f2a39d1390d0705ea7606f65b45d0c111649e))
* **cli:** add graphware, a PocketBase client for humans and agents ([5ef3a52](https://github.com/make-ware/graph-ware/commit/5ef3a5203cadea38765c382748649ae7e087e760))
* derive graph edges from port compatibility ([991d45f](https://github.com/make-ware/graph-ware/commit/991d45fb13c0746e883801256e6b2b35c10f8c1d))
* derive graph edges from port compatibility ([8c62cd5](https://github.com/make-ware/graph-ware/commit/8c62cd5a2496a0163ae630d6ea9d32e1539b26ec))
* make graphs belong to workspaces, and reuse survive time ([a1f72ac](https://github.com/make-ware/graph-ware/commit/a1f72ace19cdfea62797d61daa8fa49abb810b1d))
* make the canvas draggable and the editor reachable ([bb5474a](https://github.com/make-ware/graph-ware/commit/bb5474af7b99b2fabe28f198229e385852d7a924))
* Phase 4 — build a graph from inside the app ([d218549](https://github.com/make-ware/graph-ware/commit/d218549474c678dd1a0a4ff15ff88baca7d57adf))
* render resolved graphs on a read-only canvas ([237e116](https://github.com/make-ware/graph-ware/commit/237e1165e50f347bfad04c7373e4b6062b114e8b))
* replace boilerplate schema with the graph-ware data model ([f60eb2b](https://github.com/make-ware/graph-ware/commit/f60eb2bd4ef568957b947c39f8e83858cb3cd7e9))
* shared workspace and cli ([61379e0](https://github.com/make-ware/graph-ware/commit/61379e09d1f148adac8b72e76a588b345c70875f))
* TanStack Query caching + realtime for PocketBase ([36ef2c3](https://github.com/make-ware/graph-ware/commit/36ef2c38fae52b3948c87252b7cb389549c782bb))
* TanStack Query caching + realtime for PocketBase ([#8](https://github.com/make-ware/graph-ware/issues/8)) ([36ef2c3](https://github.com/make-ware/graph-ware/commit/36ef2c38fae52b3948c87252b7cb389549c782bb))
* **webapp:** add TanStack Query with PocketBase realtime cache ([0f4d814](https://github.com/make-ware/graph-ware/commit/0f4d8147a4ba9291bc34ee2d143d45c6b24706a7))


### Bug Fixes

* add dark mode and seed data ([8b53a27](https://github.com/make-ware/graph-ware/commit/8b53a2746a60393202b0b8499d6cb620fe98df13))
* **docker:** make the all-in-one image buildable again ([2879985](https://github.com/make-ware/graph-ware/commit/2879985f597e848b0cd4af644750146a9d8623ce))
* let GraphImports.enabled actually be false ([d925ae6](https://github.com/make-ware/graph-ware/commit/d925ae61f74e7c8e7d449d71b4cf66a78af9cb6e))
* stage 1 query landmines and wire port-kinds ([97c6c53](https://github.com/make-ware/graph-ware/commit/97c6c538fd84acef855f59865a80f3cbc0b0dc15))
* stage 1 query landmines and wire port-kinds ([0eb366c](https://github.com/make-ware/graph-ware/commit/0eb366cb20474a1dae2ba8f53c5996ff665dfdb4))
* stage 2 memoize contexts and stabilize realtime subscriptions ([89cee71](https://github.com/make-ware/graph-ware/commit/89cee71a973caa38da056d7696b5ac63597ad55d))
* stage 2 memoize contexts and stabilize realtime subscriptions ([05e3c14](https://github.com/make-ware/graph-ware/commit/05e3c14965a4e5b7f3a46f4485138d6fe5530eed))
* stage 3 cut /graphs payload and dedupe port-kinds ([ad0748b](https://github.com/make-ware/graph-ware/commit/ad0748bcd71056714c3aa15ad837c954d755becc))
* stage 3 cut /graphs payload and dedupe port-kinds ([e86e26b](https://github.com/make-ware/graph-ware/commit/e86e26ba38cba9c322f1ab4715db14351049ff63))
* upgrade cli ([4a417fd](https://github.com/make-ware/graph-ware/commit/4a417fd81c7f3b7850def4cc242734ea0c037961))
* User PW Error ([1afa3c3](https://github.com/make-ware/graph-ware/commit/1afa3c328cca3212c12970616b86b51efff84ff7))


### Code Refactoring

* make @project/shared a real workspace instead of a tsconfig alias ([5948000](https://github.com/make-ware/graph-ware/commit/59480004e512b3d6359663a8e84d6b7bd1f32640))
