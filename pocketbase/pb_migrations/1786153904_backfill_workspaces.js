/// <reference path="../pb_data/types.d.ts" />
//
// Step two of three: the data migration that makes the ownership move safe.
//
// Before Phase 5 a graph belonged to a `Users` record. Afterwards it belongs to
// a `Workspaces` record, and the access rules ask the workspace, not the owner.
// Between those two states every existing graph has a blank `workspace` and is
// therefore invisible to everybody — so the values have to be in place before
// 1786153905 swaps the rules over.
//
// Every user gets a **personal workspace** (`personal = true`) with themselves
// as its `admin`, and every graph they own is pointed at it. One workspace per
// user is what keeps the old `UNIQUE (owner, namespace, uid)` index and the new
// `UNIQUE (workspace, namespace, uid)` index equivalent: no row that satisfied
// the first can violate the second, so nobody's graph has to be renamed.
//
// Idempotent — it reuses a personal workspace the user already has and skips a
// graph that already points somewhere. Re-running it is a no-op, which matters
// because a partially applied migration is a thing that happens.
//
// Written for goja: ES5 only, no arrow functions, template literals, spread or
// destructuring. `yarn db:lint` enforces that.

// The longest slug the schema allows, and the pattern it has to match:
// ^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$
var SLUG_MAX = 40;

function slugify(input) {
  var value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (value.length > SLUG_MAX) {
    value = value.slice(0, SLUG_MAX).replace(/-+$/g, '');
  }

  return value;
}

// A slug free of `taken`, appending -2, -3, … and trimming so the suffix always
// fits inside the 40-character limit.
function uniqueSlug(base, taken) {
  var root = base || 'workspace';
  if (!taken[root]) {
    taken[root] = true;
    return root;
  }

  var suffix = 2;
  while (true) {
    var tail = '-' + suffix;
    var head = root;
    if (head.length + tail.length > SLUG_MAX) {
      head = head.slice(0, SLUG_MAX - tail.length).replace(/-+$/g, '');
    }

    var candidate = head + tail;
    if (!taken[candidate]) {
      taken[candidate] = true;
      return candidate;
    }
    suffix++;
  }
}

// "Ada Lovelace" if they set a name, otherwise the local part of their email.
function personalName(user) {
  var name = user.getString('name');
  if (name) {
    return name.slice(0, 100);
  }

  var email = user.getString('email');
  var local = email.split('@')[0];
  return (local || 'Personal').slice(0, 100);
}

migrate((app) => {
  const workspaces = app.findCollectionByNameOrId('Workspaces');
  const members = app.findCollectionByNameOrId('WorkspaceMembers');

  // Slugs are globally unique, so the whole existing set has to be in hand
  // before any are minted.
  const taken = {};
  const existing = app.findAllRecords('Workspaces');
  for (let i = 0; i < existing.length; i++) {
    taken[existing[i].getString('slug')] = true;
  }

  // `Users`, capitalized — the collection's actual name. The lowercase spelling
  // that appears in URLs and SDK calls is routing sugar, not the name.
  const users = app.findAllRecords('Users');

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    let workspace = null;
    const mine = app.findRecordsByFilter(
      'Workspaces',
      'owner = {:owner} && personal = true',
      'created',
      1,
      0,
      { owner: user.id }
    );
    if (mine.length > 0) {
      workspace = mine[0];
    } else {
      workspace = new Record(workspaces);
      workspace.set('owner', user.id);
      workspace.set('name', personalName(user));
      workspace.set('slug', uniqueSlug(slugify(personalName(user)), taken));
      workspace.set('personal', true);
      app.save(workspace);
    }

    // The rules admit `workspace.owner` directly, so this row is not what keeps
    // the user in. It exists so the workspace page can list them, and so the
    // roll is complete if ownership is ever transferred.
    const roll = app.findRecordsByFilter(
      'WorkspaceMembers',
      'workspace = {:workspace} && user = {:user}',
      '',
      1,
      0,
      { workspace: workspace.id, user: user.id }
    );
    if (roll.length === 0) {
      const membership = new Record(members);
      membership.set('workspace', workspace.id);
      membership.set('user', user.id);
      membership.set('role', 'admin');
      app.save(membership);
    }

    const orphans = app.findRecordsByFilter(
      'Graphs',
      'owner = {:owner} && workspace = ""',
      '',
      0,
      0,
      { owner: user.id }
    );
    for (let g = 0; g < orphans.length; g++) {
      orphans[g].set('workspace', workspace.id);
      app.save(orphans[g]);
    }
  }
}, (app) => {
  // Unpoint the graphs first: deleting a workspace cascades to them, and losing
  // somebody's graphs while rolling back a migration would be unforgivable.
  const attached = app.findAllRecords('Graphs');
  for (let i = 0; i < attached.length; i++) {
    attached[i].set('workspace', '');
    app.save(attached[i]);
  }

  const personal = app.findRecordsByFilter(
    'Workspaces',
    'personal = true',
    '',
    0,
    0,
    {}
  );
  for (let i = 0; i < personal.length; i++) {
    app.delete(personal[i]);
  }
});
