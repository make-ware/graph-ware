/// <reference path="../pb_data/types.d.ts" />
//
// Step three of three. Every graph now carries a workspace, so the column can
// be required, the unique key can move onto it, and the rules can stop asking
// about `owner`.
//
// Nothing below is safe before 1786153904 has run.
migrate((app) => {
  const collection_Graphs_require_workspace = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  const collection_Graphs_require_workspace_field = collection_Graphs_require_workspace.fields.getByName("workspace");
  collection_Graphs_require_workspace_field.required = true;
  app.save(collection_Graphs_require_workspace);

  const collection_Graphs_addidx_0 = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  collection_Graphs_addidx_0.indexes.push("CREATE UNIQUE INDEX `idx_graphs_workspace_namespace_uid` ON `Graphs` (`workspace`, `namespace`, `uid`)");
  collection_Graphs_addidx_0.indexes.push("CREATE INDEX `idx_graphs_workspace` ON `Graphs` (`workspace`)");
  collection_Graphs_addidx_0.indexes.push("CREATE INDEX `idx_graphs_forked_from` ON `Graphs` (`forkedFrom`)");
  app.save(collection_Graphs_addidx_0);

  const collection_Graphs_rmidx_0 = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  const collection_Graphs_rmidx_0_indexToRemove = collection_Graphs_rmidx_0.indexes.findIndex(idx => idx === "CREATE UNIQUE INDEX `idx_graphs_owner_namespace_uid` ON `Graphs` (`owner`, `namespace`, `uid`)");
  if (collection_Graphs_rmidx_0_indexToRemove !== -1) {
    collection_Graphs_rmidx_0.indexes.splice(collection_Graphs_rmidx_0_indexToRemove, 1);
  }
  app.save(collection_Graphs_rmidx_0);

  const collection_Graphs_rules = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (visibility != \"private\" || (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "@request.auth.id != \"\" && (visibility != \"private\" || (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && owner = @request.auth.id && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "updateRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "deleteRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
  }, collection_Graphs_rules)
  return app.save(collection_Graphs_rules);
}, (app) => {
  const collection_Graphs_revert_rules = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (owner = @request.auth.id || visibility != \"private\")",
    "viewRule": "@request.auth.id != \"\" && (owner = @request.auth.id || visibility != \"private\")",
    "createRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && owner = @request.auth.id",
  }, collection_Graphs_revert_rules)
  app.save(collection_Graphs_revert_rules);

  const collection_Graphs_restore_idx = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  collection_Graphs_restore_idx.indexes.push("CREATE UNIQUE INDEX `idx_graphs_owner_namespace_uid` ON `Graphs` (`owner`, `namespace`, `uid`)");
  app.save(collection_Graphs_restore_idx);

  const collection_Graphs_revert_idx = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  const dropped = [
    "CREATE UNIQUE INDEX `idx_graphs_workspace_namespace_uid` ON `Graphs` (`workspace`, `namespace`, `uid`)",
    "CREATE INDEX `idx_graphs_workspace` ON `Graphs` (`workspace`)",
    "CREATE INDEX `idx_graphs_forked_from` ON `Graphs` (`forkedFrom`)",
  ];
  for (let i = 0; i < dropped.length; i++) {
    const at = collection_Graphs_revert_idx.indexes.findIndex(idx => idx === dropped[i]);
    if (at !== -1) {
      collection_Graphs_revert_idx.indexes.splice(at, 1);
    }
  }
  app.save(collection_Graphs_revert_idx);

  const collection_Graphs_revert_required = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;
  const collection_Graphs_revert_required_field = collection_Graphs_revert_required.fields.getByName("workspace");
  collection_Graphs_revert_required_field.required = false;
  return app.save(collection_Graphs_revert_required);
});
