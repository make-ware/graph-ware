/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "id": "pb_f1tx0kvp1sizaqd",
    "name": "GraphNodes",
    "type": "base",
    "system": false,
    "listRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "viewRule": "@request.auth.id != \"\" && (graph.owner = @request.auth.id || graph.visibility != \"private\")",
    "createRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "updateRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
    "deleteRule": "@request.auth.id != \"\" && graph.owner = @request.auth.id",
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
      "name": "name",
      "id": "textwtltyd0sur",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 100,
      "pattern": "^[a-z0-9_]+$",
    },
    {
      "name": "label",
      "id": "text0wuqbuulp5",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 200,
    },
    {
      "name": "attributes",
      "id": "jsonzads7inpko",
      "type": "json",
      "required": false,
    },
    {
      "name": "ports",
      "id": "json15951xagd5",
      "type": "json",
      "required": false,
    },
    {
      "name": "position",
      "id": "jsons7arixpnk4",
      "type": "json",
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
    "CREATE INDEX `idx_graph_nodes_graph` ON `GraphNodes` (`graph`)",
    "CREATE UNIQUE INDEX `idx_graph_nodes_graph_name` ON `GraphNodes` (`graph`, `name`)",
  ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_f1tx0kvp1sizaqd") // GraphNodes;
  return app.delete(collection);
});
