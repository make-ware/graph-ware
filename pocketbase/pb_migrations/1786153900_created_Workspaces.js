/// <reference path="../pb_data/types.d.ts" />
//
// Workspaces and WorkspaceMembers reference each other: the membership rules
// look up `workspace.owner`, and the workspace rules look up the roll through
// `WorkspaceMembers_via_workspace`. PocketBase validates a rule against the
// schema at save time, so neither collection can be created carrying its final
// rules. Both are created owner-only here and in the migration that follows,
// and `1786153902_updated_workspace_rules.js` closes the loop.
migrate((app) => {
  const collection = new Collection({
    "id": "pb_j2bzrzn3vswyd1w",
    "name": "Workspaces",
    "type": "base",
    "system": false,
    "listRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && owner = @request.auth.id",
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
      "name": "owner",
      "id": "relationeqf7slqfvw",
      "type": "relation",
      "required": true,
      "collectionId": "_pb_users_auth_",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": true,
    },
    {
      "name": "name",
      "id": "textwtltyd0sur",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 100,
    },
    {
      "name": "slug",
      "id": "textzd05p6cgdp",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 40,
      "pattern": "^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$",
    },
    {
      "name": "description",
      "id": "textvedot3ox0p",
      "type": "text",
      "required": false,
      "max": 2000,
    },
    {
      "name": "personal",
      "id": "boolckplmbfl3l",
      "type": "bool",
      "required": false,
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
    "CREATE UNIQUE INDEX `idx_workspaces_slug` ON `Workspaces` (`slug`)",
    "CREATE INDEX `idx_workspaces_owner` ON `Workspaces` (`owner`)",
  ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_j2bzrzn3vswyd1w") // Workspaces;
  return app.delete(collection);
});
