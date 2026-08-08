// Exit codes and error normalization.
//
//   0  success
//   1  the operation failed (including lint finding errors)
//   2  the command line was wrong
//
// Two is deliberately distinct: an agent that typos a flag should be able to
// tell "I asked wrong" from "the server said no" without parsing prose.
import { ClientResponseError } from 'pocketbase';
import { parseAuthError, type ParsedAuthError } from '@project/shared';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/**
 * Normalize anything thrown into the shape both output modes render.
 *
 * `parseAuthError` is used only for errors that actually came off the wire.
 * It treats a missing `status` as 0 and rewrites the message to "Unable to
 * reach the server" — right for the webapp, where a status-less throw really
 * is a failed fetch, and wrong here, where commands throw plain Errors whose
 * message is the whole point ("Not signed in. Run `graphware login`").
 */
export function describeError(error: unknown): ParsedAuthError {
  if (isTransportError(error)) return parseAuthError(error);

  if (error instanceof Error) {
    return { type: 'unknown', message: error.message };
  }

  return parseAuthError(error);
}

/** Does this look like it came from the PocketBase SDK rather than a command? */
function isTransportError(error: unknown): boolean {
  if (error instanceof ClientResponseError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; response?: unknown };
  return typeof candidate.status === 'number' || 'response' in candidate;
}
