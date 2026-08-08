/// <reference path="../pb_data/types.d.ts" />
//
// Close the loop the two create migrations left open: now that both
// collections exist, the membership back-relation resolves and each can carry
// its real rules.
//
// The `?=` / `?!=` operators are load-bearing. Each pair of membership
// conditions has to be satisfied by the *same* roll row — otherwise "I am a
// member" and "somebody here is an admin" would be independent questions and
// every member would administer. Verified against a live server by
// `scripts/verify-workspace-rules.mjs`.
migrate((app) => {
  const workspaces = app.findCollectionByNameOrId("pb_j2bzrzn3vswyd1w") // Workspaces;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (owner = @request.auth.id || WorkspaceMembers_via_workspace.user ?= @request.auth.id)",
    "viewRule": "@request.auth.id != \"\" && (owner = @request.auth.id || WorkspaceMembers_via_workspace.user ?= @request.auth.id)",
    "createRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && (owner = @request.auth.id || (WorkspaceMembers_via_workspace.user ?= @request.auth.id && WorkspaceMembers_via_workspace.role ?= \"admin\"))",
    "deleteRule": "@request.auth.id != \"\" && owner = @request.auth.id",
  }, workspaces)
  app.save(workspaces);

  const members = app.findCollectionByNameOrId("pb_83a1st51rk6r14r") // WorkspaceMembers;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id)",
    "viewRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id)",
    "createRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?= \"admin\"))",
    "updateRule": "@request.auth.id != \"\" && (workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?= \"admin\"))",
    "deleteRule": "@request.auth.id != \"\" && ((workspace.owner = @request.auth.id || (workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && workspace.WorkspaceMembers_via_workspace.role ?= \"admin\")) || user = @request.auth.id)",
  }, members)
  return app.save(members);
}, (app) => {
  const members = app.findCollectionByNameOrId("pb_83a1st51rk6r14r") // WorkspaceMembers;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
  }, members)
  app.save(members);

  const workspaces = app.findCollectionByNameOrId("pb_j2bzrzn3vswyd1w") // Workspaces;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && owner = @request.auth.id",
  }, workspaces)
  return app.save(workspaces);
});
