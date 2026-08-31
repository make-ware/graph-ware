'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphVersionMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new GraphVersionMutator(pb as unknown as TypedPocketBase);
}

export function useGraphVersionsForGraph(
  graphId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.graphVersions.listForGraph(graphId ?? ''),
    queryFn: () => getMutator().listForGraph(graphId as string),
    enabled: Boolean(graphId) && enabled,
  });
}

export function useLatestGraphVersion(graphId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.graphVersions.latestForGraph(graphId ?? ''),
    queryFn: () => getMutator().latestForGraph(graphId as string),
    enabled: Boolean(graphId) && enabled,
  });
}

export function usePublishGraphVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      graph,
      nodes,
      imports,
      note,
    }: Parameters<GraphVersionMutator['publish']> extends [
      infer G,
      infer N,
      infer I,
      infer Note,
    ]
      ? { graph: G; nodes: N; imports: I; note?: Note }
      : never) => getMutator().publish(graph, nodes, imports, note),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphVersions.listForGraph(data.graph),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.graphVersions.latestForGraph(data.graph),
      });
    },
  });
}
