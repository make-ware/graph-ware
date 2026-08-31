'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphImportMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new GraphImportMutator(pb as unknown as TypedPocketBase);
}

export function useGraphImportsForParent(
  parentId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.graphImports.listForParent(parentId ?? ''),
    queryFn: () => getMutator().listForParent(parentId as string),
    enabled: Boolean(parentId) && enabled,
  });
}

export function useCreateGraphImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<GraphImportMutator['create']>[0]) =>
      getMutator().create(input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphImports.listForParent(data.parent),
      });
      qc.invalidateQueries({ queryKey: queryKeys.graphImports.allEdges() });
    },
  });
}

export function useAddGraphImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      parentId,
      childId,
      options,
    }: {
      parentId: string;
      childId: string;
      options?: { alias?: string; label?: string; order?: number };
    }) => getMutator().addImport(parentId, childId, options),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphImports.listForParent(data.parent),
      });
      qc.invalidateQueries({ queryKey: queryKeys.graphImports.allEdges() });
    },
  });
}

export function useUpdateGraphImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<GraphImportMutator['update']>[1];
    }) => getMutator().update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphImports.listForParent(data.parent),
      });
    },
  });
}

export function useDeleteGraphImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, parentId }: { id: string; parentId: string }) => {
      const ok = await getMutator().delete(id);
      if (!ok) throw new Error('Delete failed');
      return { ok, parentId };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.graphImports.listForParent(vars.parentId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.graphImports.allEdges() });
    },
  });
}
