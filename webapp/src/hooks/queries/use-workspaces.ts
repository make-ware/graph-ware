'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new WorkspaceMutator(pb as unknown as TypedPocketBase);
}

export function useWorkspacesMine(enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.listMine(),
    queryFn: () => getMutator().listMine(),
    enabled,
  });
}

export function useWorkspaceById(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.byId(id ?? ''),
    queryFn: () => getMutator().getById(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<WorkspaceMutator['create']>[0]) =>
      getMutator().create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.all() });
    },
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<WorkspaceMutator['update']>[1];
    }) => getMutator().update(id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.all() });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces.byId(vars.id) });
    },
  });
}
