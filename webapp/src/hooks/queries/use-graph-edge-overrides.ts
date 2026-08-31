'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphEdgeOverrideMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new GraphEdgeOverrideMutator(pb as unknown as TypedPocketBase);
}

export function useGraphEdgeOverridesForGraph(
  graphId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.graphEdgeOverrides.listForGraph(graphId ?? ''),
    queryFn: () => getMutator().listForGraph(graphId as string),
    enabled: Boolean(graphId) && enabled,
  });
}

export function useCreateGraphEdgeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<GraphEdgeOverrideMutator['create']>[0]) =>
      getMutator().create(input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphEdgeOverrides.listForGraph(data.graph),
      });
    },
  });
}

export function useDeleteGraphEdgeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graphId }: { id: string; graphId: string }) =>
      getMutator()
        .delete(id)
        .then((ok) => ({ ok, graphId })),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphEdgeOverrides.listForGraph(vars.graphId),
      });
    },
  });
}
