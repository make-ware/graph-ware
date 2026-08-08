/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_GraphNodes_rules = app.findCollectionByNameOrId("pb_f1tx0kvp1sizaqd") // GraphNodes;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "updateRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "deleteRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
  }, collection_GraphNodes_rules)
  return app.save(collection_GraphNodes_rules);
}, (app) => {
  const collection_GraphNodes_revert_rules = app.findCollectionByNameOrId("pb_f1tx0kvp1sizaqd") // GraphNodes;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "viewRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "createRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
  }, collection_GraphNodes_revert_rules)
  return app.save(collection_GraphNodes_revert_rules);
});
