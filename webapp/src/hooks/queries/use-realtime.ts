'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import pb from '@/lib/pocketbase';
import type { RecordSubscription } from 'pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import {
  GraphNodeMutator,
  GraphImportMutator,
  GraphEdgeOverrideMutator,
  GraphMutator,
  WorkspaceMutator,
  GraphVersionMutator,
} from '@project/shared/mutators';

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

function getMutatorForCollection(
  collection: CollectionName,
  client: TypedPocketBase
) {
  switch (collection) {
    case 'GraphNodes':
      return new GraphNodeMutator(client);
    case 'GraphImports':
      return new GraphImportMutator(client);
    case 'GraphEdgeOverrides':
      return new GraphEdgeOverrideMutator(client);
    case 'Graphs':
      return new GraphMutator(client);
    case 'GraphVersions':
      return new GraphVersionMutator(client);
    case 'Workspaces':
      return new WorkspaceMutator(client);
    default:
      return null;
  }
}

/**
 * Subscribe to a PocketBase collection and invalidate or patch queries on event.
 * Uses mutator subscribeToCollection; callbacks/keys held in refs to avoid
 * resubscribe-per-render.
 */
export function useRealtime<T extends { id: string }>({
  collection,
  enabled = true,
  onEvent,
  invalidateKeys,
  onRecord,
}: UseRealtimeOptions<T>) {
  const qc = useQueryClient();

  const onEventRef = useRef(onEvent);
  const onRecordRef = useRef(onRecord);
  const invalidateKeysRef = useRef(invalidateKeys);

  useLayoutEffect(() => {
    onEventRef.current = onEvent;
  });
  useLayoutEffect(() => {
    onRecordRef.current = onRecord;
  });
  useLayoutEffect(() => {
    invalidateKeysRef.current = invalidateKeys;
  });

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unsub: (() => void) | undefined;

    const client = pb as unknown as TypedPocketBase;
    const mutator = getMutatorForCollection(collection, client);

    const handler = (e: RecordSubscription<T>) => {
      if (disposed) return;
      onEventRef.current?.(e);
      const or = onRecordRef.current;
      const ik = invalidateKeysRef.current;
      if (or) {
        or(e.action, e.record as T);
      } else if (ik) {
        for (const key of ik) {
          qc.invalidateQueries({ queryKey: key as readonly unknown[] });
        }
      }
    };

    const promise: Promise<() => void> = mutator
      ? (
          mutator as unknown as {
            subscribeToCollection: (
              cb: (e: RecordSubscription<T>) => void
            ) => Promise<() => void>;
          }
        ).subscribeToCollection(handler)
      : (
          client.collection(collection as never) as unknown as {
            subscribe: (
              id: string,
              cb: (e: RecordSubscription<T>) => void
            ) => Promise<() => void>;
          }
        ).subscribe('*', handler);

    promise
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

    return () => {
      disposed = true;
      if (unsub) unsub();
      else void promise.then((u) => u());
    };
  }, [collection, enabled, qc]);
}
