// Retry helper for transient failures (network blips, 5xx). Client errors such
// as bad credentials or validation failures (4xx) are NOT retried by default.

export interface RetryOptions {
  /** Number of retry attempts after the initial try. */
  retries?: number;
  /** Base delay between attempts, in milliseconds (grows exponentially). */
  delayMs?: number;
  /** Decide whether a given error is worth retrying. */
  shouldRetry?: (error: unknown) => boolean;
}

export function isRetryableError(error: unknown): boolean {
  return defaultShouldRetry(error);
}

export { defaultShouldRetry as shouldRetry };

function defaultShouldRetry(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: number }).status
      : undefined;
  // No status (network error) or server error -> retry. Client errors -> don't.
  if (status === undefined || status === 0) return true;
  return status >= 500;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on transient failures with exponential backoff.
 * Re-throws the last error once retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 2,
    delayMs = 300,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      await wait(delayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
