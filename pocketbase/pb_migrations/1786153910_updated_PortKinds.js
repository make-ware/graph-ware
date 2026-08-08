/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_PortKinds_add_workspace_0 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;

  collection_PortKinds_add_workspace_0.fields.add(new RelationField({
    "name": "workspace",
    "id": "relation7t9odlgq5z",
    "required": false,
    "collectionId": "pb_j2bzrzn3vswyd1w",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": true
  }));

  app.save(collection_PortKinds_add_workspace_0);

  const collection_PortKinds_addidx_0 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  collection_PortKinds_addidx_0.indexes.push("CREATE UNIQUE INDEX `idx_port_kinds_workspace_key` ON `PortKinds` (`workspace`, `key`)");
  app.save(collection_PortKinds_addidx_0);

  const collection_PortKinds_addidx_1 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  collection_PortKinds_addidx_1.indexes.push("CREATE INDEX `idx_port_kinds_key_lookup` ON `PortKinds` (`key`)");
  app.save(collection_PortKinds_addidx_1);

  const collection_PortKinds_rmidx_0 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  const collection_PortKinds_rmidx_0_indexToRemove = collection_PortKinds_rmidx_0.indexes.findIndex(idx => idx === "CREATE UNIQUE INDEX `idx_port_kinds_key` ON `PortKinds` (`key`)");
  if (collection_PortKinds_rmidx_0_indexToRemove !== -1) {
    collection_PortKinds_rmidx_0.indexes.splice(collection_PortKinds_rmidx_0_indexToRemove, 1);
  }
  app.save(collection_PortKinds_rmidx_0);

  const collection_PortKinds_rules = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  unmarshal({
    "listRule": "workspace = \"\" || (@request.auth.id != \"\" && (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "workspace = \"\" || (@request.auth.id != \"\" && (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && workspace != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "updateRule": "@request.auth.id != \"\" && workspace != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
  }, collection_PortKinds_rules)
  return app.save(collection_PortKinds_rules);
}, (app) => {
  const collection_PortKinds_revert_rules = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  unmarshal({
    "listRule": "",
    "viewRule": "",
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
  }, collection_PortKinds_revert_rules)
  app.save(collection_PortKinds_revert_rules);

  const collection_PortKinds_restore_idx_0 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  collection_PortKinds_restore_idx_0.indexes.push("CREATE UNIQUE INDEX `idx_port_kinds_key` ON `PortKinds` (`key`)");
  app.save(collection_PortKinds_restore_idx_0);

  const collection_PortKinds_revert_idx_0 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  const collection_PortKinds_revert_idx_0_indexToRemove = collection_PortKinds_revert_idx_0.indexes.findIndex(idx => idx === "CREATE UNIQUE INDEX `idx_port_kinds_workspace_key` ON `PortKinds` (`workspace`, `key`)");
  if (collection_PortKinds_revert_idx_0_indexToRemove !== -1) {
    collection_PortKinds_revert_idx_0.indexes.splice(collection_PortKinds_revert_idx_0_indexToRemove, 1);
  }
  app.save(collection_PortKinds_revert_idx_0);

  const collection_PortKinds_revert_idx_1 = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  const collection_PortKinds_revert_idx_1_indexToRemove = collection_PortKinds_revert_idx_1.indexes.findIndex(idx => idx === "CREATE INDEX `idx_port_kinds_key_lookup` ON `PortKinds` (`key`)");
  if (collection_PortKinds_revert_idx_1_indexToRemove !== -1) {
    collection_PortKinds_revert_idx_1.indexes.splice(collection_PortKinds_revert_idx_1_indexToRemove, 1);
  }
  app.save(collection_PortKinds_revert_idx_1);

  const collection_PortKinds_revert_add_workspace = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;

  collection_PortKinds_revert_add_workspace.fields.removeByName("workspace");

  return app.save(collection_PortKinds_revert_add_workspace);
});
