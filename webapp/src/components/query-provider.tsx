'use client';

import { useEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import pb from '@/lib/pocketbase';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const prevUserIdRef = useRef<string | null>(pb.authStore.record?.id ?? null);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, record) => {
      const nextId = (record as { id?: string } | null)?.id ?? null;
      const prevId = prevUserIdRef.current;
      prevUserIdRef.current = nextId;
      if (prevId !== nextId) {
        // User changed or signed out — drop cached data so the next account
        // does not flash the previous user's workspaces/graphs.
        queryClient.clear();
      }
    });
    return unsubscribe;
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
