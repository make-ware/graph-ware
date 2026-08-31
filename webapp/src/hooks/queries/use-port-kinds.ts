'use client';

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_PORT_KINDS } from '@project/shared';
import { PortKindMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { queryKeys } from './keys';

function getMutator() {
  return new PortKindMutator(pb as unknown as TypedPocketBase);
}

function defaultColorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const kind of DEFAULT_PORT_KINDS) map[kind.key] = kind.color;
  return map;
}

function defaultRegistry() {
  const reg: Record<string, { key: string; compatibleWith: string[] }> = {};
  for (const kind of DEFAULT_PORT_KINDS)
    reg[kind.key] = {
      key: kind.key,
      compatibleWith: kind.compatibleWith ?? [],
    };
  return reg;
}

export function usePortKindColorMap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.portKinds.colorMap(),
    queryFn: () => getMutator().colorMap(),
    enabled,
    staleTime: 5 * 60 * 1000,
    initialData: defaultColorMap(),
  });
}

export function usePortKindRegistry(enabled = true) {
  return useQuery({
    queryKey: queryKeys.portKinds.registry(),
    queryFn: () => getMutator().registry(),
    enabled,
    staleTime: 5 * 60 * 1000,
    initialData: defaultRegistry(),
  });
}
