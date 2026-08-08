/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_GraphImports_add_version_0 = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;

  collection_GraphImports_add_version_0.fields.add(new RelationField({
    "name": "version",
    "id": "relationuu1zmyp054",
    "required": false,
    "collectionId": "pb_4ybdea4qzdal16z",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": false
  }));

  app.save(collection_GraphImports_add_version_0);

  const collection_GraphImports_add_attributeOverrides_1 = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;

  collection_GraphImports_add_attributeOverrides_1.fields.add(new JSONField({
    "name": "attributeOverrides",
    "id": "json021teggm90",
    "required": false
  }));

  app.save(collection_GraphImports_add_attributeOverrides_1);

  const collection_GraphImports_rules = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (parent.visibility != \"private\" || (parent.workspace.owner = @request.auth.id || parent.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "@request.auth.id != \"\" && (parent.visibility != \"private\" || (parent.workspace.owner = @request.auth.id || parent.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && (parent.workspace.owner = @request.auth.id || (parent.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && parent.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\")) && (child.visibility != \"private\" || (child.workspace.owner = @request.auth.id || child.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "updateRule": "@request.auth.id != \"\" && (parent.workspace.owner = @request.auth.id || (parent.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && parent.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\")) && (child.visibility != \"private\" || (child.workspace.owner = @request.auth.id || child.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "deleteRule": "@request.auth.id != \"\" && (parent.workspace.owner = @request.auth.id || (parent.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && parent.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
  }, collection_GraphImports_rules)
  return app.save(collection_GraphImports_rules);
}, (app) => {
  const collection_GraphImports_revert_rules = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;
  unmarshal({
    "listRule": "@request.auth.id != \"\" && (parent.owner = @request.auth.id || parent.visibility != \"private\")",
    "viewRule": "@request.auth.id != \"\" && (parent.owner = @request.auth.id || parent.visibility != \"private\")",
    "createRule": "@request.auth.id != \"\" && parent.owner = @request.auth.id && (child.owner = @request.auth.id || child.visibility != \"private\")",
    "updateRule": "@request.auth.id != \"\" && parent.owner = @request.auth.id && (child.owner = @request.auth.id || child.visibility != \"private\")",
    "deleteRule": "@request.auth.id != \"\" && parent.owner = @request.auth.id",
  }, collection_GraphImports_revert_rules)
  app.save(collection_GraphImports_revert_rules);

  const collection_GraphImports_revert_add_version = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;

  collection_GraphImports_revert_add_version.fields.removeByName("version");

  app.save(collection_GraphImports_revert_add_version);

  const collection_GraphImports_revert_add_attributeOverrides = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;

  collection_GraphImports_revert_add_attributeOverrides.fields.removeByName("attributeOverrides");

  return app.save(collection_GraphImports_revert_add_attributeOverrides);
});
