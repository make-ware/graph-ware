// Personal-workspace provisioning for new users.
//
// Required by workspaces.pb.js. Not a *.pb.js file, so PocketBase does not
// auto-load it as a hook — it is only reachable through require().
//
// Since Phase 5 a graph belongs to a workspace, not to a user, and
// `Graphs.workspace` is required. A user with no workspace therefore cannot
// create anything at all, which makes provisioning one part of signing up
// rather than something the client is trusted to remember. The same rule is
// applied to pre-existing users by
// `pb_migrations/1786153904_backfill_workspaces.js`; keep the two in step.
//
// Written for goja: no arrow functions, template literals, spread, or
// destructuring. `yarn db:lint` only checks migrations, so this file's
// compatibility is verified by actually booting PocketBase.

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

// A slug no workspace is using. Checked against the database rather than an
// in-memory set, because signups are concurrent; the unique index is still the
// real guard, and a loser retries on the next request.
function availableSlug(app, base) {
  var root = base || 'workspace';

  for (var suffix = 1; suffix < 100; suffix++) {
    var tail = suffix === 1 ? '' : '-' + suffix;
    var head = root;
    if (head.length + tail.length > SLUG_MAX) {
      head = head.slice(0, SLUG_MAX - tail.length).replace(/-+$/g, '');
    }

    var candidate = head + tail;
    var clash = app.findRecordsByFilter(
      'Workspaces',
      'slug = {:slug}',
      '',
      1,
      0,
      { slug: candidate }
    );
    if (clash.length === 0) {
      return candidate;
    }
  }

  return root.slice(0, 20) + '-' + Math.floor(Math.random() * 1e9);
}

function personalName(user) {
  var name = user.getString('name');
  if (name) {
    return name.slice(0, 100);
  }

  var local = user.getString('email').split('@')[0];
  return (local || 'Personal').slice(0, 100);
}

/**
 * Give `user` a personal workspace and an admin seat on it, unless they already
 * have one.
 *
 * Idempotent, and deliberately quiet: a signup that succeeds and then fails to
 * provision would leave an account that cannot create anything, so the caller
 * treats a failure here as fatal to the signup rather than logging and
 * continuing.
 */
function ensurePersonalWorkspace(app, user) {
  var mine = app.findRecordsByFilter(
    'Workspaces',
    'owner = {:owner} && personal = true',
    'created',
    1,
    0,
    { owner: user.id }
  );

  var workspace;
  if (mine.length > 0) {
    workspace = mine[0];
  } else {
    var name = personalName(user);
    workspace = new Record(app.findCollectionByNameOrId('Workspaces'));
    workspace.set('owner', user.id);
    workspace.set('name', name);
    workspace.set('slug', availableSlug(app, slugify(name)));
    workspace.set('personal', true);
    app.save(workspace);
  }

  var roll = app.findRecordsByFilter(
    'WorkspaceMembers',
    'workspace = {:workspace} && user = {:user}',
    '',
    1,
    0,
    { workspace: workspace.id, user: user.id }
  );
  if (roll.length === 0) {
    var membership = new Record(
      app.findCollectionByNameOrId('WorkspaceMembers')
    );
    membership.set('workspace', workspace.id);
    membership.set('user', user.id);
    membership.set('role', 'admin');
    app.save(membership);
  }

  return workspace;
}

module.exports = {
  ensurePersonalWorkspace: ensurePersonalWorkspace,
  availableSlug: availableSlug,
  slugify: slugify,
};
