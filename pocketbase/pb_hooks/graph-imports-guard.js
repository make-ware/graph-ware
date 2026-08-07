// Cycle and depth guard for the GraphImports collection.
//
// Required by graph-imports.pb.js. Not a *.pb.js file, so PocketBase does not
// auto-load it as a hook — it is only reachable through require().
//
// PocketBase API rules cannot walk an ancestor chain, so "does this import
// close a loop?" has to be answered in a hook. This module is the authority;
// webapp/src/lib/graph/imports.ts mirrors the same rules client-side for
// pre-flight UX. Change one, change the other.
//
// Written for goja: no arrow functions, template literals, spread, or
// destructuring. `yarn db:lint` enforces that.

var MAX_IMPORT_DEPTH = 8;

// Direct children of a graph, i.e. the graphs it imports.
function childrenOf(app, graphId, excludeId) {
  var filter = 'parent = {:id}';
  var params = { id: graphId };

  if (excludeId) {
    filter = filter + ' && id != {:exclude}';
    params.exclude = excludeId;
  }

  var records = app.findRecordsByFilter('GraphImports', filter, '', 0, 0, params);
  var ids = [];
  for (var i = 0; i < records.length; i++) {
    ids.push(records[i].getString('child'));
  }
  return ids;
}

// Direct parents of a graph, i.e. the graphs that import it.
function parentsOf(app, graphId, excludeId) {
  var filter = 'child = {:id}';
  var params = { id: graphId };

  if (excludeId) {
    filter = filter + ' && id != {:exclude}';
    params.exclude = excludeId;
  }

  var records = app.findRecordsByFilter('GraphImports', filter, '', 0, 0, params);
  var ids = [];
  for (var i = 0; i < records.length; i++) {
    ids.push(records[i].getString('parent'));
  }
  return ids;
}

// Is `target` reachable from `start` by following `step` repeatedly?
function reaches(app, start, target, excludeId, step) {
  var queue = [start];
  var seen = {};

  while (queue.length > 0) {
    var current = queue.shift();
    if (seen[current]) {
      continue;
    }
    seen[current] = true;

    if (current === target) {
      return true;
    }

    var next = step(app, current, excludeId);
    for (var i = 0; i < next.length; i++) {
      queue.push(next[i]);
    }
  }

  return false;
}

// Longest chain of graphs strictly beyond `start`, counting graphs not edges.
// `onPath` keeps a pre-existing cycle in the data from spinning forever.
function longestChain(app, start, excludeId, step, onPath) {
  if (onPath[start]) {
    return 0;
  }
  onPath[start] = true;

  var longest = 0;
  var next = step(app, start, excludeId);
  for (var i = 0; i < next.length; i++) {
    var candidate = 1 + longestChain(app, next[i], excludeId, step, onPath);
    if (candidate > longest) {
      longest = candidate;
    }
  }

  delete onPath[start];
  return longest;
}

/**
 * Throw a BadRequestError if parent -> child may not be added.
 *
 * `excludeId` is the id of the record being updated, so its own current edge
 * does not count against the check.
 *
 * A diamond — two parents importing the same child — is not a cycle and is
 * allowed. That is the reuse this model exists for.
 */
function assertImportAllowed(app, parentId, childId, excludeId) {
  if (!parentId || !childId) {
    throw new BadRequestError('An import needs both a parent and a child graph.');
  }

  if (parentId === childId) {
    throw new BadRequestError('A graph cannot import itself.');
  }

  if (reaches(app, childId, parentId, excludeId, childrenOf)) {
    throw new BadRequestError(
      'That import would create a loop - the child graph already imports this graph, directly or through another graph.'
    );
  }

  var above = longestChain(app, parentId, excludeId, parentsOf, {});
  var below = longestChain(app, childId, excludeId, childrenOf, {});
  var depth = above + 2 + below;

  if (depth > MAX_IMPORT_DEPTH) {
    throw new BadRequestError(
      'That import would nest graphs ' +
        depth +
        ' deep; the limit is ' +
        MAX_IMPORT_DEPTH +
        '.'
    );
  }
}

module.exports = {
  MAX_IMPORT_DEPTH: MAX_IMPORT_DEPTH,
  assertImportAllowed: assertImportAllowed,
};
