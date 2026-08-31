'use client';

import { useCallback, useMemo } from 'react';
import {
  DEFAULT_PORT_KINDS,
  FALLBACK_PORT_KIND_COLOR,
  type PortKindRegistry,
} from '@project/shared';
import { PortKindMutator } from '@project/shared/mutators';
import {
  usePortKindColorMap,
  usePortKindRegistry,
} from '@/hooks/queries/use-port-kinds';

export interface UsePortKindsResult {
  colors: Record<string, string>;
  registry: PortKindRegistry;
  colorFor: (kind: string) => string;
  isLoading: boolean;
}

function buildDefaults(): {
  colors: Record<string, string>;
  registry: PortKindRegistry;
} {
  const colors: Record<string, string> = {};
  const registry: PortKindRegistry = {};
  for (const kind of DEFAULT_PORT_KINDS) {
    colors[kind.key] = kind.color;
    registry[kind.key] = { key: kind.key, compatibleWith: kind.compatibleWith };
  }
  return { colors, registry };
}

const DEFAULTS = buildDefaults();

export function usePortKinds(): UsePortKindsResult {
  const colorQuery = usePortKindColorMap();
  const registryQuery = usePortKindRegistry();

  const colors = colorQuery.data ?? DEFAULTS.colors;
  const registry = registryQuery.data ?? DEFAULTS.registry;
  const isLoading = colorQuery.isLoading || registryQuery.isLoading;

  const colorFor = useCallback(
    (kind: string) => colors[kind] ?? FALLBACK_PORT_KIND_COLOR,
    [colors]
  );

  // Keep shape stable for memo deps
  return useMemo(
    () => ({ colors, registry, colorFor, isLoading }),
    [colors, registry, colorFor, isLoading]
  );
}

// Re-export for callers that need raw query access
export { PortKindMutator };
