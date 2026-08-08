// The config file: permissions, per-server isolation, and the shape a corrupt
// or future-version file degrades to.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configDir,
  configPath,
  createFileAuthStore,
  dropProfile,
  parseStoredAuth,
  readConfig,
  readProfile,
  updateProfile,
} from '../config.ts';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'graphware-test-'));
  env = { GRAPHWARE_CONFIG_DIR: dir };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('config location', () => {
  it('honours GRAPHWARE_CONFIG_DIR so agents can isolate sessions', () => {
    expect(configDir({ GRAPHWARE_CONFIG_DIR: '/custom' })).toBe('/custom');
  });

  it('falls back to XDG_CONFIG_HOME, then ~/.config', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/graphware');
    expect(configDir({ HOME: '/home/me' })).toBe('/home/me/.config/graphware');
  });
});

describe('profiles', () => {
  it('writes the file 0600 — it holds a bearer token', async () => {
    await updateProfile('http://localhost:8090', { token: 'secret' }, env);
    const stats = await stat(configPath(env));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('re-applies 0600 on rewrite, not only on create', async () => {
    const path = configPath(env);
    await updateProfile('http://localhost:8090', { token: 'a' }, env);
    const { chmod } = await import('node:fs/promises');
    await chmod(path, 0o644);

    await updateProfile('http://localhost:8090', { token: 'b' }, env);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('keeps servers apart so a switch never reuses the wrong token', async () => {
    await updateProfile('http://localhost:8090', { token: 'local' }, env);
    await updateProfile('https://prod.example.com', { token: 'prod' }, env);

    expect((await readProfile('http://localhost:8090', env)).token).toBe(
      'local'
    );
    expect((await readProfile('https://prod.example.com', env)).token).toBe(
      'prod'
    );
  });

  it('merges rather than replaces, so a login keeps the active workspace', async () => {
    const url = 'http://localhost:8090';
    await updateProfile(url, { workspace: 'ws1' }, env);
    await updateProfile(url, { token: 'secret' }, env);

    const profile = await readProfile(url, env);
    expect(profile).toMatchObject({ workspace: 'ws1', token: 'secret' });
  });

  it('removes the file entirely when the last profile goes', async () => {
    const url = 'http://localhost:8090';
    await updateProfile(url, { token: 'secret' }, env);
    await dropProfile(url, env);

    await expect(stat(configPath(env))).rejects.toThrow();
    expect(await readProfile(url, env)).toEqual({});
  });

  it('leaves other servers alone when one profile is dropped', async () => {
    await updateProfile('http://a', { token: 'a' }, env);
    await updateProfile('http://b', { token: 'b' }, env);
    await dropProfile('http://a', env);

    expect(await readProfile('http://a', env)).toEqual({});
    expect((await readProfile('http://b', env)).token).toBe('b');
  });
});

describe('auth store hydration', () => {
  // `isValid` decodes the token and checks `exp`, so this has to be a real JWT
  // shape — an opaque string reads as expired and the test would pass for the
  // wrong reason.
  const jwt = (payload: Record<string, unknown>) =>
    [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url'
      ),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      'signature',
    ].join('.');

  const TOKEN = JSON.stringify({
    token: jwt({ id: 'user1', exp: Math.floor(Date.now() / 1000) + 3600 }),
    record: { id: 'user1', email: 'demo@example.com' },
  });

  // The store's own `initial` option loads on an internal queue with no public
  // promise to await, so `isValid` would still be false when a one-shot command
  // checks it — every invocation would decide it was signed out.
  it('is readable synchronously, right after construction', () => {
    const store = createFileAuthStore('http://localhost:8090', TOKEN, env);
    expect(store.isValid).toBe(true);
    expect(store.record?.id).toBe('user1');
  });

  // Hydrating through the subclass `save` would queue a write of exactly what
  // was just read — pointless every run, and a race against logout's delete.
  it('does not rewrite the file it just read', async () => {
    await updateProfile('http://localhost:8090', { token: TOKEN }, env);
    const before = (await stat(configPath(env))).mtimeMs;

    createFileAuthStore('http://localhost:8090', TOKEN, env);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await stat(configPath(env))).mtimeMs).toBe(before);
  });

  it('reads a missing or unparseable token as signed out', () => {
    expect(parseStoredAuth(undefined)).toBeUndefined();
    expect(parseStoredAuth('{truncated')).toBeUndefined();
    expect(parseStoredAuth('{}')).toBeUndefined();
    expect(parseStoredAuth(JSON.stringify({ record: {} }))).toBeUndefined();
  });

  it('accepts the legacy `model` key alongside `record`', () => {
    const legacy = JSON.stringify({ token: 't', model: { id: 'u' } });
    expect(parseStoredAuth(legacy)).toEqual({
      token: 't',
      record: { id: 'u' },
    });
  });
});

describe('degradation', () => {
  it('treats a corrupt file as empty rather than wedging the CLI', async () => {
    await writeFile(configPath(env), 'not json at all');
    expect(await readConfig(env)).toEqual({ version: 1, profiles: {} });
  });

  it('does not adopt a file written by a future version', async () => {
    await writeFile(
      configPath(env),
      JSON.stringify({ version: 2, profiles: { x: { token: 't' } } })
    );
    expect(await readConfig(env)).toEqual({ version: 1, profiles: {} });
  });

  it('reads an absent file as empty', async () => {
    expect(await readProfile('http://localhost:8090', env)).toEqual({});
  });
});
