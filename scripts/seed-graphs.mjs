#!/usr/bin/env node
//
// Seed a running PocketBase with the sample system from `example/data/`.
//
//   yarn dev        # in one terminal — PocketBase must be up
//   yarn db:seed    # in another
//
// Unlike the db:* migration scripts, this one talks to a *running* server and
// therefore needs superuser credentials — POCKETBASE_ADMIN_EMAIL and
// POCKETBASE_ADMIN_PASSWORD from the environment or repo-root .env.
//
// The interesting part of the seed is not the sample data itself but the shape
// it produces: `testDataElement` imports `BatterySystem` **twice**, under the
// aliases `port_bank` and `starboard_bank`. That is the case the file-based
// model could not express, and the one every instance-path assumption in the
// engine has to survive. Reseeding is idempotent — records are matched on their
// natural keys and updated rather than duplicated.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_DIR = path.join(ROOT, 'example', 'data');

const DEMO_USER = {
  email: 'demo@example.com',
  password: 'demo-password-1234',
  name: 'Demo User',
};

const PORT_KINDS = [
  {
    key: 'power',
    label: 'Power',
    color: '#f59e0b',
    description: 'DC or AC power distribution',
  },
  {
    key: 'data/canbus',
    label: 'CAN bus',
    color: '#06b6d4',
    description: 'CAN bus data link',
  },
  {
    key: 'data/vbus',
    label: 'VE.Bus',
    color: '#10b981',
    description: 'Victron VE.Bus data link',
  },
  {
    key: 'video/hdmi',
    label: 'HDMI',
    color: '#a855f7',
    description: 'HDMI video output',
  },
  {
    key: 'signal/gpio',
    label: 'GPIO',
    color: '#3b82f6',
    description: 'Digital GPIO signal',
  },
  {
    key: 'signal/red',
    label: 'Red Signal',
    color: '#ef4444',
    description: 'Red lamp drive signal',
  },
  {
    key: 'signal/yellow',
    label: 'Yellow Signal',
    color: '#eab308',
    description: 'Yellow lamp drive signal',
  },
  {
    key: 'signal/green',
    label: 'Green Signal',
    color: '#22c55e',
    description: 'Green lamp drive signal',
  },
];

// Legacy uid -> [{ alias, label }] for samples that predate the inline
// `imports` field. Two entries for one child is the point. Newer samples
// declare their imports in their own JSON instead.
const IMPORTS = {
  testDataElement: [
    { child: 'BatterySystem', alias: 'port_bank', label: 'Port Battery Bank' },
    {
      child: 'BatterySystem',
      alias: 'starboard_bank',
      label: 'Starboard Battery Bank',
    },
    { child: 'EngineSystem', alias: 'control', label: 'Control System' },
  ],
};

function readEnv(name, fallback) {
  if (process.env[name]) return process.env[name];

  for (const file of ['.env', '.env.example']) {
    try {
      const contents = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const match = contents.match(
        new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm')
      );
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // Missing file — try the next source.
    }
  }

  return fallback;
}

function loadSampleGraphs() {
  return fs
    .readdirSync(SAMPLE_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) =>
      JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8'))
    );
}

/** Find one record by filter, or null. Avoids the SDK's 404-as-throw. */
async function findOne(pb, collection, filter) {
  const result = await pb.collection(collection).getList(1, 1, { filter });
  return result.items[0] ?? null;
}

async function upsert(pb, collection, filter, data) {
  const existing = await findOne(pb, collection, filter);
  if (existing) {
    return await pb.collection(collection).update(existing.id, data);
  }
  return await pb.collection(collection).create(data);
}

async function seedPortKinds(pb) {
  for (const kind of PORT_KINDS) {
    // Global rows: no workspace, which is also why this needs the superuser
    // credentials — nobody else may write them.
    await upsert(
      pb,
      'PortKinds',
      `workspace = "" && key = "${kind.key}"`,
      kind
    );
  }
  console.log(`  port kinds:  ${PORT_KINDS.length}`);
}

async function seedDemoUser(pb) {
  const existing = await findOne(pb, 'Users', `email = "${DEMO_USER.email}"`);
  if (existing) return existing;

  return await pb.collection('Users').create({
    email: DEMO_USER.email,
    password: DEMO_USER.password,
    passwordConfirm: DEMO_USER.password,
    name: DEMO_USER.name,
    verified: true,
  });
}

/**
 * The demo user's personal workspace.
 *
 * Normally provisioned by the `Users` hook on signup, but the seed runs as a
 * superuser against a server that may have been created before the hook existed
 * — so it makes sure rather than assuming. Everything the seed writes goes in
 * here, because `Graphs.workspace` is required since Phase 5.
 */
async function seedWorkspace(pb, user) {
  const existing = await findOne(
    pb,
    'Workspaces',
    `owner = "${user.id}" && personal = true`
  );
  if (existing) return existing;

  const workspace = await pb.collection('Workspaces').create({
    owner: user.id,
    name: DEMO_USER.name,
    slug: 'demo',
    personal: true,
  });

  await upsert(
    pb,
    'WorkspaceMembers',
    `workspace = "${workspace.id}" && user = "${user.id}"`,
    { workspace: workspace.id, user: user.id, role: 'admin' }
  );

  return workspace;
}

async function seedGraphs(pb, owner, workspace, samples) {
  const byUid = new Map();

  for (const sample of samples) {
    const graph = await upsert(
      pb,
      'Graphs',
      `workspace = "${workspace}" && uid = "${sample.uid}"`,
      {
        workspace,
        owner,
        uid: sample.uid,
        name: sample.name,
        label: sample.label,
        namespace: sample.namespace ?? '',
        description: sample.description ?? '',
        // Samples marked public in their JSON become the built-in demo
        // library, visible to every signed-in user; the rest stay private
        // to the demo workspace.
        visibility: sample.visibility ?? 'private',
        tags: sample.tags ?? ['sample'],
      }
    );
    byUid.set(sample.uid, graph);

    for (const element of sample.elements ?? []) {
      await upsert(
        pb,
        'GraphNodes',
        `graph = "${graph.id}" && name = "${element.name}"`,
        {
          graph: graph.id,
          name: element.name,
          label: element.label,
          attributes: element.attributes ?? [],
          ports: element.ports ?? [],
        }
      );
    }

    // The sample is authoritative for its own graph: a node it no longer
    // declares — e.g. one that moved into a subsystem child — must not
    // survive a reseed as a duplicate.
    const keep = new Set(
      (sample.elements ?? []).map((element) => element.name)
    );
    const existingNodes = await pb
      .collection('GraphNodes')
      .getFullList({ filter: `graph = "${graph.id}"` });
    for (const node of existingNodes) {
      if (!keep.has(node.name)) {
        await pb.collection('GraphNodes').delete(node.id);
      }
    }
  }

  console.log(`  graphs:      ${byUid.size}`);
  return byUid;
}

async function seedImports(pb, byUid, samples) {
  let count = 0;

  for (const sample of samples) {
    const links = sample.imports ?? IMPORTS[sample.uid] ?? [];
    const parent = byUid.get(sample.uid);
    if (!parent) continue;

    for (const [index, link] of links.entries()) {
      const child = byUid.get(link.child);
      if (!child) continue;

      await upsert(
        pb,
        'GraphImports',
        `parent = "${parent.id}" && alias = "${link.alias}"`,
        {
          parent: parent.id,
          child: child.id,
          alias: link.alias,
          label: link.label,
          order: index,
          enabled: true,
        }
      );
      count++;
    }

    // Same authority rule as nodes: drop import rows the sample no longer
    // declares, so a reshuffled composition reseeds cleanly.
    const keep = new Set(links.map((link) => link.alias));
    const existingImports = await pb
      .collection('GraphImports')
      .getFullList({ filter: `parent = "${parent.id}"` });
    for (const row of existingImports) {
      if (!keep.has(row.alias)) {
        await pb.collection('GraphImports').delete(row.id);
      }
    }
  }

  console.log(`  imports:     ${count}`);
}

async function main() {
  const url = readEnv('NEXT_PUBLIC_POCKETBASE_URL', 'http://localhost:8090');
  const email = readEnv('POCKETBASE_ADMIN_EMAIL');
  const password = readEnv('POCKETBASE_ADMIN_PASSWORD');

  if (!email || !password) {
    console.error(
      'Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD (see .env.example),\n' +
        'and make sure that superuser exists in the running PocketBase.'
    );
    process.exit(1);
  }

  const pb = new PocketBase(url);
  pb.autoCancellation(false);

  try {
    await pb.collection('_superusers').authWithPassword(email, password);
  } catch (error) {
    console.error(
      `Could not sign in to PocketBase at ${url}: ${error.message}`
    );
    console.error('Is `yarn dev` running, and does that superuser exist?');
    process.exit(1);
  }

  console.log(`Seeding ${url}`);
  await seedPortKinds(pb);

  const user = await seedDemoUser(pb);
  console.log(`  demo user:   ${DEMO_USER.email} / ${DEMO_USER.password}`);

  const workspace = await seedWorkspace(pb, user);
  console.log(`  workspace:   ${workspace.slug}`);

  const samples = loadSampleGraphs();
  const byUid = await seedGraphs(pb, user.id, workspace.id, samples);
  await seedImports(pb, byUid, samples);

  console.log(
    '\nDone. Sign in as the demo user and open the `testDataElement` graph —'
  );
  console.log(
    'it imports BatterySystem twice, as port_bank and starboard_bank.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
