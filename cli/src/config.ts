// Where the CLI keeps its auth token and active workspace.
//
// The store is keyed by server URL, not global, so an agent can hold a session
// against staging and production at once and switching servers never silently
// reuses the wrong token.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AsyncAuthStore, BaseAuthStore, type AuthRecord } from 'pocketbase';

export const DEFAULT_URL = 'http://localhost:8090';

export interface Profile {
  /** The PocketBase auth payload, exactly as AsyncAuthStore serialized it. */
  token?: string;
  record?: Record<string, unknown> | null;
  /** Active workspace id — the CLI's equivalent of the webapp's localStorage. */
  workspace?: string;
  savedAt?: string;
}

export interface ConfigFile {
  version: 1;
  current?: string;
  profiles: Record<string, Profile>;
}

/**
 * A function, not a shared constant: `{ ...EMPTY }` would be a shallow copy,
 * so every caller that "started clean" would share — and mutate — one
 * `profiles` object.
 */
function emptyConfig(): ConfigFile {
  return { version: 1, profiles: {} };
}

/**
 * `$GRAPHWARE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/graphware`, else
 * `~/.config/graphware`. The explicit override exists so CI and parallel agents
 * can isolate their sessions from each other.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GRAPHWARE_CONFIG_DIR) return env.GRAPHWARE_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'graphware');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'auth.json');
}

export async function readConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<ConfigFile> {
  try {
    const raw = await readFile(configPath(env), 'utf8');
    const parsed = JSON.parse(raw) as ConfigFile;
    // A file from a future version is not something we can safely rewrite, so
    // treat it as absent rather than clobbering it.
    if (parsed?.version !== 1 || typeof parsed.profiles !== 'object') {
      return emptyConfig();
    }
    return { version: 1, current: parsed.current, profiles: parsed.profiles };
  } catch {
    // Missing or unreadable: start clean. A corrupt file should not wedge the
    // CLI into an unusable state that only a manual `rm` can clear.
    return emptyConfig();
  }
}

export async function writeConfig(
  config: ConfigFile,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  try {
    // The `mode` option only applies when the file is created; an existing file
    // keeps whatever permissions it had, so set them explicitly every time.
    await chmod(path, 0o600);
  } catch (error) {
    // The auth store persists on a queue, so a `logout` deleting the profile
    // can land between the write and the chmod. Nothing to secure at that
    // point — the file is gone, which is what logout wanted.
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
}

export async function readProfile(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<Profile> {
  const config = await readConfig(env);
  return config.profiles[url] ?? {};
}

export async function updateProfile(
  url: string,
  patch: Partial<Profile>,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = await readConfig(env);
  config.current = url;
  config.profiles[url] = { ...config.profiles[url], ...patch };
  await writeConfig(config, env);
}

export async function dropProfile(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = await readConfig(env);
  delete config.profiles[url];
  if (config.current === url) delete config.current;
  if (Object.keys(config.profiles).length === 0) {
    // Nothing left worth keeping — and leaving an empty file behind makes
    // `logout` look like it did not work.
    await rm(configPath(env), { force: true });
    return;
  }
  await writeConfig(config, env);
}

/**
 * The SDK's AsyncAuthStore, backed by the profile for `url`.
 *
 * Hanging this off `createPocketBaseClient` means `authWithPassword`,
 * `authRefresh` and `authStore.clear()` all persist without any command having
 * to remember to save — which is exactly the kind of thing a command forgets.
 *
 * The stored value is hydrated **synchronously** rather than through the
 * store's own `initial` option. That option is loaded on an internal queue, so
 * `authStore.isValid` is still false when the constructor returns — and there
 * is no public promise to await. A one-shot CLI reads that flag immediately,
 * so every command would decide it was signed out.
 */
export function createFileAuthStore(
  url: string,
  stored: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): AsyncAuthStore {
  const store = new AsyncAuthStore({
    save: async (serialized) => {
      await updateProfile(
        url,
        { token: serialized, savedAt: new Date().toISOString() },
        env
      );
    },
    clear: async () => {
      const config = await readConfig(env);
      if (!config.profiles[url]) return;
      delete config.profiles[url].token;
      delete config.profiles[url].savedAt;
      await writeConfig(config, env);
    },
    // Deliberately absent: hydrating below covers it, and passing it too would
    // load the same state a second time.
  });

  const state = parseStoredAuth(stored);
  if (state) {
    // Through the base implementation, not `store.save`. The subclass override
    // enqueues a persist, which would rewrite the file with exactly what was
    // just read from it — pointless on every invocation, and an active hazard
    // on `logout`, where that queued write races the profile deletion.
    BaseAuthStore.prototype.save.call(store, state.token, state.record);
  }

  return store;
}

/**
 * Read what AsyncAuthStore wrote: `JSON.stringify({token, record})`.
 *
 * Returns undefined for anything unrecognizable, so a hand-edited or truncated
 * file reads as "signed out" rather than throwing before any command runs.
 */
export function parseStoredAuth(
  stored: string | undefined
): { token: string; record: AuthRecord } | undefined {
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as {
      token?: string;
      record?: AuthRecord;
      model?: AuthRecord;
    };
    if (!parsed?.token) return undefined;
    return {
      token: parsed.token,
      record: parsed.record ?? parsed.model ?? null,
    };
  } catch {
    return undefined;
  }
}
