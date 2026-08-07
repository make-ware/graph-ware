/// <reference path="../pb_data/types.d.ts" />
//
// Guards on the GraphImports collection.
//
// Importing a child graph is the reuse mechanism of graph-ware, and the two
// things that can go wrong with it — a loop, or a tree so deep it can never be
// rendered — are both unexpressible as API rules, which cannot follow a
// relation chain upward. So they live here.
//
// Handler callbacks run in isolated goja runtimes and cannot close over
// module-scope variables, which is why each one require()s the shared guard
// rather than referencing a function defined above it.

onRecordCreateRequest((e) => {
  const guard = require(__hooks + '/graph-imports-guard.js');

  guard.assertImportAllowed(
    $app,
    e.record.getString('parent'),
    e.record.getString('child'),
    ''
  );

  e.next();
}, 'GraphImports');

onRecordUpdateRequest((e) => {
  const guard = require(__hooks + '/graph-imports-guard.js');

  // Exclude this record's own edge: re-pointing an existing import must be
  // checked against the graph *without* the link it is replacing.
  guard.assertImportAllowed(
    $app,
    e.record.getString('parent'),
    e.record.getString('child'),
    e.record.id
  );

  e.next();
}, 'GraphImports');
