/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_GraphImports_modify_enabled = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;
  const collection_GraphImports_modify_enabled_field = collection_GraphImports_modify_enabled.fields.getByName("enabled");

  collection_GraphImports_modify_enabled_field.required = false;

  return app.save(collection_GraphImports_modify_enabled);
}, (app) => {
  const collection_GraphImports_revert_enabled = app.findCollectionByNameOrId("pb_pjjdia303pr1eeu") // GraphImports;
  const collection_GraphImports_revert_enabled_field = collection_GraphImports_revert_enabled.fields.getByName("enabled");

  collection_GraphImports_revert_enabled_field.required = true;

  return app.save(collection_GraphImports_revert_enabled);
});
