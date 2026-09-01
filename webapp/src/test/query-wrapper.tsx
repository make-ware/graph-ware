'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function QueryWrapper({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const qc = client ?? createTestQueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
