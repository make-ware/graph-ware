// The PocketBase client factory. Every consumer builds its own client from
// this: the webapp wraps it in a module singleton fed by the build-time
// `NEXT_PUBLIC_POCKETBASE_URL`, the CLI passes a different URL and a
// file-backed auth store. No env var is read here — that is deliberately the
// consumer's job, since this package must stay usable outside Next.
import PocketBase, { type BaseAuthStore } from 'pocketbase';
import type { TypedPocketBase } from '../types';

export interface PocketBaseClientOptions {
  enableAutoCancellation?: boolean;
  requestTimeout?: number;
  // Where the auth token lives. Omit for the SDK default (LocalAuthStore, which
  // is browser localStorage); the CLI passes an AsyncAuthStore backed by a file.
  authStore?: BaseAuthStore | null;
}

/**
 * Create a configured PocketBase client with proper settings
 */
export function createPocketBaseClient(
  url: string = 'http://localhost:8090',
  options: PocketBaseClientOptions = {}
): TypedPocketBase {
  const pb = new PocketBase(url, options.authStore) as TypedPocketBase;

  // Off by default, and every caller should keep it that way: the SDK's cancel
  // key is method + path, so two concurrent reads of the *same* collection
  // cancel each other — which several `Promise.all` call sites do deliberately.
  pb.autoCancellation(options.enableAutoCancellation ?? false);

  // Add global error interceptor for better error handling
  pb.beforeSend = function (url, requestOptions) {
    // Add timeout to prevent hanging requests
    if (!requestOptions.signal && options.requestTimeout) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), options.requestTimeout);
      requestOptions.signal = controller.signal;
    }

    return { url, options: requestOptions };
  };

  return pb;
}
