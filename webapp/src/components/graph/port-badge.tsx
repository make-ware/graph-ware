'use client';

import { ArrowLeftToLine, ArrowRightFromLine } from 'lucide-react';
import type { Port } from '@project/shared';
import { DEFAULT_PORT_RELATIONSHIP } from '@project/shared';
import { cn } from '@/lib/utils';

interface PortBadgeProps {
  port: Port;
  /** From `usePortKinds().colorFor` — never a hardcoded map. */
  color: string;
  /** Hide the direction arrow where the layout already implies it. */
  showDirection?: boolean;
  className?: string;
}

/**
 * One port, rendered as a chip: direction, name, kind and cardinality.
 *
 * Shared by the canvas node and the detail panel so a port looks the same
 * wherever it appears. The kind dot is the only coloured element — the text
 * stays on theme foreground so it survives a low-contrast kind colour.
 */
export function PortBadge({
  port,
  color,
  showDirection = false,
  className,
}: PortBadgeProps) {
  const relationship = port.relationship ?? DEFAULT_PORT_RELATIONSHIP;
  const Icon =
    port.direction === 'input' ? ArrowLeftToLine : ArrowRightFromLine;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-1.5 py-0.5 text-xs',
        className
      )}
      title={`${port.name} · ${port.kind} · ${relationship}${
        port.isRequired ? ' · required' : ''
      }`}
    >
      {showDirection && (
        <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate font-medium">{port.name}</span>
      {port.isRequired && (
        <span
          className="shrink-0 font-semibold text-destructive"
          title="Required input"
          aria-label="required"
        >
          *
        </span>
      )}
      <span className="shrink-0 text-muted-foreground">
        {relationship === 'many' ? '∗' : '1'}
      </span>
    </span>
  );
}
