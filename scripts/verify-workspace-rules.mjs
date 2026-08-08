#!/usr/bin/env node
//
// Prove the Phase 5 access rules against a *running* PocketBase.
//
//   yarn dev                  # in one terminal
//   yarn db:verify-rules      # in another
//
// Why a script and not a unit test: the rules are strings evaluated by
// PocketBase's filter engine, not code this repo runs. The one property they
// most need — that `members.user ?= me && members.role ?!= "viewer"` is
// satisfied by *one* roll row rather than by two different ones — cannot be
// asserted anywhere except against the real engine. Get it wrong and every
// viewer silently gets write access.
//
// Three users, two workspaces, and the matrix between them. Everything is
// created through the ordinary API as those users, with no superuser
// credentials anywhere: a check that ran as an admin would bypass the rules it
// is trying to verify.
//
// Idempotent-ish: each run uses a fresh set of accounts keyed by a timestamp,
// so re-running it does not collide with the last run's data.

import process from 'node:process';
import PocketBase from 'pocketbase';

const URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const PASSWORD = 'verify-password-1234';
const RUN = Date.now().toString(36);

let failures = 0;
let checks = 0;

function ok(label, condition) {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures++;
  console.log(`  ✗ ${label}`);
}

/** Assert that a request is refused. A 404 counts: PocketBase hides what you cannot read. */
async function refused(label, work) {
  checks++;
  try {
    await work();
    failures++;
    console.log(`  ✗ ${label} (the request succeeded)`);
  } catch (error) {
    const status = error?.status ?? 0;
    if (status === 400 || status === 403 || status === 404) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label} (unexpected ${status}: ${error?.message})`);
    }
  }
}

async function signUp(handle) {
  const pb = new PocketBase(URL);
  const email = `${handle}-${RUN}@example.test`;

  await pb.collection('users').create({
    email,
    password: PASSWORD,
    passwordConfirm: PASSWORD,
    name: handle,
  });
  await pb.collection('users').authWithPassword(email, PASSWORD);

  return { pb, email, id: pb.authStore.record.id, handle };
}

/** The personal workspace the signup hook provisions. */
async function personalWorkspace(user) {
  const rows = await user.pb.collection('Workspaces').getFullList({
    filter: `owner = "${user.id}" && personal = true`,
  });
  return rows[0] ?? null;
}

async function makeGraph(user, workspaceId, uid, visibility = 'private') {
  return await user.pb.collection('Graphs').create({
    workspace: workspaceId,
    owner: user.id,
    uid,
    name: uid.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label: uid,
    visibility,
  });
}

async function visibleGraphIds(user) {
  const rows = await user.pb.collection('Graphs').getFullList({ fields: 'id' });
  return new Set(rows.map((row) => row.id));
}

async function main() {
  console.log(`Verifying workspace rules against ${URL}\n`);

  const alice = await signUp('alice');
  const bob = await signUp('bob');
  const carol = await signUp('carol');

  console.log('Signup provisioning');
  const alicePersonal = await personalWorkspace(alice);
  ok('every new user gets a personal workspace', Boolean(alicePersonal));
  ok(
    'the personal workspace carries an admin roll row',
    (
      await alice.pb.collection('WorkspaceMembers').getFullList({
        filter: `workspace = "${alicePersonal.id}" && user = "${alice.id}"`,
      })
    )[0]?.role === 'admin'
  );

  // -------------------------------------------------------------------------
  // Two workspaces, three roles
  // -------------------------------------------------------------------------

  const shipyard = await alice.pb.collection('Workspaces').create({
    owner: alice.id,
    name: `Shipyard ${RUN}`,
    slug: `shipyard-${RUN}`,
  });
  const chandlery = await bob.pb.collection('Workspaces').create({
    owner: bob.id,
    name: `Chandlery ${RUN}`,
    slug: `chandlery-${RUN}`,
  });

  // Bob writes in Alice's workspace; Carol only reads it.
  const bobSeat = await alice.pb.collection('WorkspaceMembers').create({
    workspace: shipyard.id,
    user: bob.id,
    role: 'member',
  });
  await alice.pb.collection('WorkspaceMembers').create({
    workspace: shipyard.id,
    user: carol.id,
    role: 'viewer',
  });

  const shipyardGraph = await makeGraph(alice, shipyard.id, `Hull${RUN}`);
  const chandleryGraph = await makeGraph(bob, chandlery.id, `Rope${RUN}`);
  const published = await makeGraph(
    alice,
    shipyard.id,
    `Anchor${RUN}`,
    'public'
  );

  console.log('\nMembership decides what you can see');
  const bobSees = await visibleGraphIds(bob);
  ok('a user in two workspaces sees both', bobSees.has(shipyardGraph.id) && bobSees.has(chandleryGraph.id));

  const carolSees = await visibleGraphIds(carol);
  ok(
    'a viewer sees the workspace they are on',
    carolSees.has(shipyardGraph.id)
  );
  ok(
    'and nothing from a workspace they are not on',
    !carolSees.has(chandleryGraph.id)
  );
  await refused("a non-member cannot view another workspace's private graph", () =>
    carol.pb.collection('Graphs').getOne(chandleryGraph.id)
  );

  console.log('\nRoles decide what you can change');
  ok(
    'a member can edit a graph they did not create',
    Boolean(
      await bob.pb
        .collection('Graphs')
        .update(shipyardGraph.id, { description: 'edited by bob' })
    )
  );
  // The load-bearing one. If the rule's two membership conditions could be
  // satisfied by different roll rows, Carol would pass on Bob's `member` row.
  await refused('a viewer cannot edit, even with members alongside them', () =>
    carol.pb
      .collection('Graphs')
      .update(shipyardGraph.id, { description: 'edited by carol' })
  );
  await refused('a viewer cannot create in the workspace either', () =>
    makeGraph(carol, shipyard.id, `Sneak${RUN}`)
  );
  await refused('a member cannot administer the roll', () =>
    bob.pb.collection('WorkspaceMembers').create({
      workspace: shipyard.id,
      user: carol.id,
      role: 'admin',
    })
  );

  console.log('\nRevocation');
  await alice.pb.collection('WorkspaceMembers').delete(bobSeat.id);
  const bobSeesAfter = await visibleGraphIds(bob);
  ok(
    'removing a member revokes read access immediately',
    !bobSeesAfter.has(shipyardGraph.id)
  );
  await refused('and write access with it', () =>
    bob.pb.collection('Graphs').update(shipyardGraph.id, { description: 'no' })
  );
  ok(
    'a public graph stays readable to everyone',
    (await visibleGraphIds(bob)).has(published.id)
  );

  console.log('\nChild collections inherit the decision');
  const node = await alice.pb.collection('GraphNodes').create({
    graph: shipyardGraph.id,
    name: 'keel',
    label: 'Keel',
  });
  await refused('a non-member cannot read nodes of a private graph', () =>
    bob.pb.collection('GraphNodes').getOne(node.id)
  );
  await refused('nor write them', () =>
    bob.pb.collection('GraphNodes').update(node.id, { label: 'Nope' })
  );
  await refused('a viewer cannot write them', () =>
    carol.pb.collection('GraphNodes').update(node.id, { label: 'Nope' })
  );

  console.log('\nVersions');
  const version = await alice.pb.collection('GraphVersions').create({
    graph: shipyardGraph.id,
    version: 1,
    snapshot: {
      format: 1,
      graph: { uid: shipyardGraph.uid, name: shipyardGraph.name, label: shipyardGraph.label },
      nodes: [],
      imports: [],
    },
    createdBy: alice.id,
  });
  await refused('a version is immutable, even for its author', () =>
    alice.pb.collection('GraphVersions').update(version.id, { note: 'edited' })
  );
  await refused('a viewer cannot publish a version', () =>
    carol.pb.collection('GraphVersions').create({
      graph: shipyardGraph.id,
      version: 2,
      snapshot: { format: 1, graph: { uid: 'x', name: 'x', label: 'x' }, nodes: [], imports: [] },
      createdBy: carol.id,
    })
  );

  console.log('\nWorkspace-scoped port kinds');
  const scopedKind = await alice.pb.collection('PortKinds').create({
    workspace: shipyard.id,
    key: `hydraulic-${RUN}`,
    label: 'Hydraulic',
    color: '#2563eb',
  });
  const bobKinds = await bob.pb.collection('PortKinds').getFullList();
  ok(
    "a workspace's own kind is invisible to a non-member",
    !bobKinds.some((kind) => kind.id === scopedKind.id)
  );
  ok(
    'global kinds stay visible to everyone',
    bobKinds.length === 0 || bobKinds.every((kind) => !kind.workspace)
  );
  await refused('nobody can write a global kind', () =>
    alice.pb.collection('PortKinds').create({
      key: `global-${RUN}`,
      label: 'Global',
      color: '#000000',
    })
  );

  console.log('\nForking');
  const bobPersonal = await personalWorkspace(bob);
  const fork = await bob.pb.collection('Graphs').create({
    workspace: bobPersonal.id,
    owner: bob.id,
    forkedFrom: published.id,
    uid: `${published.uid}-copy`,
    name: `${published.name}_copy`,
    label: `${published.label} (fork)`,
    visibility: 'private',
  });
  ok('a public graph can be forked into your own workspace', Boolean(fork.id));
  ok('and the fork records where it came from', fork.forkedFrom === published.id);
  await alice.pb.collection('Graphs').delete(published.id);
  const survivor = await bob.pb.collection('Graphs').getOne(fork.id);
  ok(
    'deleting the original leaves the fork standing',
    survivor.id === fork.id
  );

  console.log(
    `\n${checks - failures}/${checks} checks passed` +
      (failures ? ` — ${failures} FAILED` : '')
  );

  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('\nVerification could not run:', error?.message ?? error);
    if (error?.response) console.error(JSON.stringify(error.response, null, 2));
    console.error(
      '\nIs PocketBase running? Start it with `yarn dev` (or set POCKETBASE_URL).'
    );
    process.exit(2);
  });
