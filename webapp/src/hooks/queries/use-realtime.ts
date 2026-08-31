'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import pb from '@/lib/pocketbase';
import type { RecordSubscription } from 'pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

type CollectionName =
  | 'Graphs'
  | 'GraphNodes'
  | 'GraphImports'
  | 'GraphEdgeOverrides'
  | 'GraphVersions'
  | 'Workspaces'
  | 'WorkspaceMembers'
  | 'PortKinds';

interface UseRealtimeOptions<T> {
  collection: CollectionName;
  enabled?: boolean;
  onEvent?: (e: RecordSubscription<T>) => void;
  invalidateKeys?: readonly unknown[][];
  onRecord?: (action: string, record: T) => void;
}

/**
 * Subscribe to a PocketBase collection and invalidate or patch queries on event.
 *
 * Wraps `pb.collection(...).subscribe('*', ...)` with cleanup on unmount and
 * dedup-safe patching via queryClient.
 */

export function useRealtime<T extends { id: string }>({
  collection,
  enabled = true,
  onEvent,
  invalidateKeys,
  onRecord,
}: UseRealtimeOptions<T>) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unsub: (() => void) | undefined;

    const client = pb as unknown as TypedPocketBase;

    const promise = (
      client.collection(collection as never) as unknown as {
        subscribe: (
          id: string,
          cb: (e: RecordSubscription<T>) => void
        ) => Promise<() => void>;
      }
    )
      .subscribe('*', (e: RecordSubscription<T>) => {
        if (disposed) return;
        onEvent?.(e);
        if (onRecord) {
          onRecord(e.action, e.record as T);
        } else if (invalidateKeys) {
          for (const key of invalidateKeys) {
            qc.invalidateQueries({ queryKey: key as readonly unknown[] });
          }
        }
      })
      .then((u) => {
        if (disposed) {
          u();
        } else {
          unsub = u;
        }
      })
      .catch((cause: unknown) => {
        console.error(`Realtime subscription failed for ${collection}`, cause);
      });

    void promise;

    return () => {
      disposed = true;
      if (unsub) unsub();
      else void promise.then(() => unsub?.());
      try {
        (
          client.collection(collection as never) as unknown as {
            unsubscribe: (id: string) => void;
          }
        ).unsubscribe('*');
      } catch {
        // ignore
      }
    };
  }, [collection, enabled, qc, invalidateKeys, onEvent, onRecord]);
}
