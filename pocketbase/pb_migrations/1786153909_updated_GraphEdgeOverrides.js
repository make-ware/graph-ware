/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_GraphEdgeOverrides_rules = app.findCollectionByNameOrId("pb_m4jsdtbz0krc6t3") // GraphEdgeOverrides;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "updateRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "deleteRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
  }, collection_GraphEdgeOverrides_rules)
  return app.save(collection_GraphEdgeOverrides_rules);
}, (app) => {
  const collection_GraphEdgeOverrides_revert_rules = app.findCollectionByNameOrId("pb_m4jsdtbz0krc6t3") // GraphEdgeOverrides;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "viewRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "createRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
  }, collection_GraphEdgeOverrides_revert_rules)
  return app.save(collection_GraphEdgeOverrides_revert_rules);
});
