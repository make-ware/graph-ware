'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphNodeMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new GraphNodeMutator(pb as unknown as TypedPocketBase);
}

export function useGraphNodesForGraph(graphId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.graphNodes.listForGraph(graphId ?? ''),
    queryFn: () => getMutator().listForGraph(graphId as string),
    enabled: Boolean(graphId) && enabled,
  });
}

export function useCreateGraphNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<GraphNodeMutator['create']>[0]) =>
      getMutator().create(input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphNodes.listForGraph(data.graph),
      });
    },
  });
}

export function useUpdateGraphNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<GraphNodeMutator['update']>[1];
    }) => getMutator().update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphNodes.listForGraph(data.graph),
      });
    },
  });
}

export function useDeleteGraphNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graphId }: { id: string; graphId: string }) =>
      getMutator()
        .delete(id)
        .then((ok) => ({ ok, graphId })),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphNodes.listForGraph(vars.graphId),
      });
    },
  });
}
