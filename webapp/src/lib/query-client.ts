'use client';

import { QueryClient } from '@tanstack/react-query';
import { isRetryableError } from '@project/shared';

let browserQueryClient: QueryClient | undefined;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime keeps the cache fresh; no polling timer needed.
        staleTime: Infinity,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) =>
          failureCount < 2 && isRetryableError(error),
        retryDelay: (attemptIndex) => 300 * 2 ** attemptIndex,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function getQueryClient() {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}
