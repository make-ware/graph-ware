/// <reference path="../pb_data/types.d.ts" />
//
// Every user gets a personal workspace.
//
// `Graphs.workspace` is required and its access rules go through workspace
// membership, so an account with no workspace can read nothing of its own and
// create nothing at all. Provisioning therefore cannot be the client's job:
// signup happens through the auth endpoint, and a client that forgets the
// second call — or crashes between the two — leaves an account in a state with
// no way out.
//
// Handler callbacks run in isolated goja runtimes and cannot close over
// module-scope variables, which is why this require()s the shared guard rather
// than referencing a function defined above it.
//
// The tag is `Users`, capitalized — that is the collection's actual name, and a
// hook tag is matched against it exactly. The lowercase `users` that appears in
// the SDK calls and in PocketBase's own URLs works because *routing* is
// case-insensitive; a hook tag is not, and a mistyped one fails silently by
// simply never firing.

onRecordAfterCreateSuccess((e) => {
  const guard = require(__hooks + '/workspaces-guard.js');

  guard.ensurePersonalWorkspace($app, e.record);

  e.next();
}, 'Users');

// A workspace's creator is admitted by the rules directly (`workspace.owner`),
// so this row is not what keeps them in — it is what makes them appear on the
// roll their teammates see, and what survives if ownership is ever moved.
onRecordAfterCreateSuccess((e) => {
  const roll = $app.findRecordsByFilter(
    'WorkspaceMembers',
    'workspace = {:workspace} && user = {:user}',
    '',
    1,
    0,
    { workspace: e.record.id, user: e.record.getString('owner') }
  );

  if (roll.length === 0) {
    const membership = new Record(
      $app.findCollectionByNameOrId('WorkspaceMembers')
    );
    membership.set('workspace', e.record.id);
    membership.set('user', e.record.getString('owner'));
    membership.set('role', 'admin');
    $app.save(membership);
  }

  e.next();
}, 'Workspaces');
