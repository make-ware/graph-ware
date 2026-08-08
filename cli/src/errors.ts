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

/** A malformed command line. Carries the offending command's usage line. */
export class UsageError extends Error {
  readonly usage?: string;

  constructor(message: string, usage?: string) {
    super(message);
    this.name = 'UsageError';
    this.usage = usage;
  }
}

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

/**
 * Levenshtein distance, used only for "did you mean" on an unknown noun or
 * verb. Small inputs, so the plain O(n·m) table is the right implementation.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The closest candidate to `input`, or undefined when nothing is close enough.
 * The threshold scales with length so short words need a near-exact match.
 */
export function suggest(
  input: string,
  candidates: readonly string[]
): string | undefined {
  const threshold = Math.max(1, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = editDistance(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= threshold ? best : undefined;
}
