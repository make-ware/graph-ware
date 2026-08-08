/// <reference path="../pb_data/types.d.ts" />
//
// Owner-only rules for now; see the note in 1786153900_created_Workspaces.js.
migrate((app) => {
  const collection = new Collection({
    "id": "pb_83a1st51rk6r14r",
    "name": "WorkspaceMembers",
    "type": "base",
    "system": false,
    "listRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "viewRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && workspace.owner = @request.auth.id",
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
      "name": "workspace",
      "id": "relation7t9odlgq5z",
      "type": "relation",
      "required": true,
      "collectionId": "pb_j2bzrzn3vswyd1w",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": true,
    },
    {
      "name": "user",
      "id": "relatione6jbx1dz77",
      "type": "relation",
      "required": true,
      "collectionId": "_pb_users_auth_",
      "maxSelect": 1,
      "minSelect": 0,
      "cascadeDelete": true,
    },
    {
      "name": "role",
      "id": "selectdw72e1gllo",
      "type": "select",
      "required": true,
      "maxSelect": 1,
      "values": ["admin", "member", "viewer"],
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
    "CREATE UNIQUE INDEX `idx_workspace_members_workspace_user` ON `WorkspaceMembers` (`workspace`, `user`)",
    "CREATE INDEX `idx_workspace_members_user` ON `WorkspaceMembers` (`user`)",
  ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_83a1st51rk6r14r") // WorkspaceMembers;
  return app.delete(collection);
});
