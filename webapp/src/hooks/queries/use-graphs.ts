'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new GraphMutator(pb as unknown as TypedPocketBase);
}

export function useGraphById(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.graphs.byId(id ?? ''),
    queryFn: () => getMutator().getById(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useGraphsForWorkspace(
  workspaceId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.graphs.listForWorkspace(workspaceId ?? ''),
    queryFn: () => getMutator().listForWorkspace(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useCreateGraph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<GraphMutator['create']>[0]) =>
      getMutator().create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.graphs.all() });
    },
  });
}

export function useUpdateGraph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<GraphMutator['update']>[1];
    }) => getMutator().update(id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.graphs.all() });
      qc.invalidateQueries({ queryKey: queryKeys.graphs.byId(vars.id) });
    },
  });
}

export function useDeleteGraph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getMutator().delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.graphs.all() });
    },
  });
}
