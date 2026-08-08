'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PORT_KINDS, type PortKindRegistry } from '@project/shared';
import { PortKindMutator } from '@project/shared/mutators';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

function defaultColors(): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const kind of DEFAULT_PORT_KINDS) colors[kind.key] = kind.color;
  return colors;
}

function defaultRegistry(): PortKindRegistry {
  const registry: PortKindRegistry = {};
  for (const kind of DEFAULT_PORT_KINDS) {
    registry[kind.key] = { key: kind.key, compatibleWith: kind.compatibleWith };
  }
  return registry;
}

export interface UsePortKindsResult {
  /** `kind` → CSS colour, for ports and edges on the canvas. */
  colors: Record<string, string>;
  /** What the engine matches `compatibleWith` against. */
  registry: PortKindRegistry;
  colorFor: (kind: string) => string;
  isLoading: boolean;
}

/**
 * The port-kind registry, so nothing on the canvas hardcodes a colour.
 *
 * Seeded synchronously from `DEFAULT_PORT_KINDS` and overlaid with the server's
 * rows once they arrive, so the first paint is already correct for the built-in
 * kinds rather than a flash of fallback grey. `PortKinds` is world-readable and
 * superuser-write, so there is no auth guard and no realtime subscription —
 * the list is effectively static.
 */
export function usePortKinds(): UsePortKindsResult {
  const [colors, setColors] = useState<Record<string, string>>(defaultColors);
  const [registry, setRegistry] = useState<PortKindRegistry>(defaultRegistry);
  const [isLoading, setIsLoading] = useState(true);

  const mutator = useMemo(
    () => new PortKindMutator(pb as unknown as TypedPocketBase),
    []
  );

  useEffect(() => {
    let cancelled = false;

    // Neither call rejects — both fall back to the built-in kinds.
    Promise.all([mutator.colorMap(), mutator.registry()]).then(
      ([nextColors, nextRegistry]) => {
        if (cancelled) return;
        setColors(nextColors);
        setRegistry(nextRegistry);
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [mutator]);

  const colorFor = useCallback(
    (kind: string) => PortKindMutator.colorFor(kind, colors),
    [colors]
  );

  return { colors, registry, colorFor, isLoading };
}
