/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "id": "pb_tzswt8fx0msckzy",
    "name": "PortKinds",
    "type": "base",
    "system": false,
    "listRule": "",
    "viewRule": "",
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
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
      "name": "key",
      "id": "textiejhog878n",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 100,
      "pattern": "^[a-z0-9/_-]+$",
    },
    {
      "name": "label",
      "id": "text0wuqbuulp5",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 100,
    },
    {
      "name": "color",
      "id": "textiefnxyjc6v",
      "type": "text",
      "required": true,
      "min": 1,
      "max": 32,
    },
    {
      "name": "description",
      "id": "textvedot3ox0p",
      "type": "text",
      "required": false,
      "max": 500,
    },
    {
      "name": "compatibleWith",
      "id": "jsonzktffmhdho",
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
    "CREATE UNIQUE INDEX `idx_port_kinds_key` ON `PortKinds` (`key`)",
  ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pb_tzswt8fx0msckzy") // PortKinds;
  return app.delete(collection);
});
