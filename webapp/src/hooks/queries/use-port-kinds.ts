'use client';

import { useQuery } from '@tanstack/react-query';
import { PortKindMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new PortKindMutator(pb as unknown as TypedPocketBase);
}

export function usePortKindColorMap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.portKinds.colorMap(),
    queryFn: () => getMutator().colorMap(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePortKindRegistry(enabled = true) {
  return useQuery({
    queryKey: queryKeys.portKinds.registry(),
    queryFn: () => getMutator().registry(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
