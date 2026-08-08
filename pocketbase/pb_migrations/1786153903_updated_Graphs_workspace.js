/// <reference path="../pb_data/types.d.ts" />
//
// Step one of three for the ownership move. Only the columns land here:
//
//   1786153903  add `workspace` and `forkedFrom`  (this file)
//   1786153904  backfill a personal workspace per user and point every graph at it
//   1786153905  make `workspace` required, swap the unique index, swap the rules
//
// Splitting it is not tidiness. `workspace` is created **not required** because
// every existing row is about to have it blank, the unique index that includes
// it cannot be built until the values are there, and the membership rules would
// make every pre-Phase-5 graph unreachable by its owner if they took effect
// first.
migrate((app) => {
  const collection_Graphs_add_workspace_0 = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;

  collection_Graphs_add_workspace_0.fields.add(new RelationField({
    "name": "workspace",
    "id": "relation7t9odlgq5z",
    "required": false,
    "collectionId": "pb_j2bzrzn3vswyd1w",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": true
  }));

  app.save(collection_Graphs_add_workspace_0);

  const collection_Graphs_add_forkedFrom_1 = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;

  collection_Graphs_add_forkedFrom_1.fields.add(new RelationField({
    "name": "forkedFrom",
    "id": "relationf6tci3gacp",
    "required": false,
    "collectionId": "pb_59pj54cwk2o7xty",
    "maxSelect": 1,
    "minSelect": 0,
    "cascadeDelete": false
  }));

  return app.save(collection_Graphs_add_forkedFrom_1);
}, (app) => {
  const collection_Graphs_revert_add_forkedFrom = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;

  collection_Graphs_revert_add_forkedFrom.fields.removeByName("forkedFrom");

  app.save(collection_Graphs_revert_add_forkedFrom);

  const collection_Graphs_revert_add_workspace = app.findCollectionByNameOrId("pb_59pj54cwk2o7xty") // Graphs;

  collection_Graphs_revert_add_workspace.fields.removeByName("workspace");

  return app.save(collection_Graphs_revert_add_workspace);
});
