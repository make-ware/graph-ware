/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "id": "pb_4ybdea4qzdal16z",
    "name": "GraphVersions",
    "type": "base",
    "system": false,
    "listRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "viewRule": "@request.auth.id != \"\" && (graph.visibility != \"private\" || (graph.workspace.owner = @request.auth.id || graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id))",
    "createRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\")) && createdBy = @request.auth.id",
    "updateRule": null,
    "deleteRule": "@request.auth.id != \"\" && (graph.workspace.owner = @request.auth.id || (graph.workspace.WorkspaceMembers_via_workspace.user ?= @request.auth.id && graph.workspace.WorkspaceMembers_via_workspace.role ?!= \"viewer\"))",
    "fields": [
    {
      "name": "id",
      "id": "text3208210256",
      "type": "text",
      "required": true,
      "autogeneratePattern": "[a-z0-9]{15}",
      "hidden": false,
      "max": 15,
      "min": 15,
      "pattern": "^[a-z0-9]+$",
      "presentable": false,
      "primaryKey": true,
      "system": true,
    },
    {
      "name": "graph",
      "id": "relationw703uaeedt",
      "type": "relation",
      "required": true,
      "collectionId": "pb_59pj54cwk2o7xty",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": true,
    },
    {
      "name": "version",
      "id": "numberuu1zmyp054",
      "type": "number",
      "required": true,
      "min": 1,
      "onlyInt": true,
    },
    {
      "name": "snapshot",
      "id": "jsonwqw6n1ac75",
      "type": "json",
      "required": true,
      "maxSize": 5242880,
    },
    {
      "name": "note",
      "id": "textva304bmfya",
      "type": "text",
      "required": false,
      "max": 500,
    },
    {
      "name": "createdBy",
      "id": "relation6v04dvzrxq",
      "type": "relation",
      "required": true,
      "collectionId": "_pb_users_auth_",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": false,
    },
    {
      "name": "created",
      "id": "autodate2990389176",
      "type": "autodate",
      "required": false,
      "hidden": false,
      "onCreate": true,
      "onUpdate": false,
      "presentable": false,
      "system": true,
    },
    {
      "name": "updated",
      "id": "autodate3332085495",
      "type": "autodate",
      "required": false,
      "hidden": false,
      "onCreate": true,
      "onUpdate": true,
      "presentable": false,
      "system": true,
    },
  ],
    "indexes": [
    "CREATE UNIQUE INDEX `idx_graph_versions_graph_version` ON `GraphVersions` (`graph`, `version`)",
    "CREATE INDEX `idx_graph_versions_graph` ON `GraphVersions` (`graph`)",
  ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_4ybdea4qzdal16z") // GraphVersions;
  return app.delete(collection);
});
