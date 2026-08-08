'use client';

import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { DiagnosticLevel, GraphDiagnostic } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ViewerSelection } from '@/lib/graph/flow-adapter';

interface DiagnosticsPanelProps {
  diagnostics: readonly GraphDiagnostic[];
  onSelect: (selection: ViewerSelection) => void;
}

// Ordered worst-first: errors are what the user has to act on.
const LEVELS: readonly DiagnosticLevel[] = ['error', 'warning', 'info'];

const LEVEL_META: Record<
  DiagnosticLevel,
  { icon: typeof AlertCircle; className: string; label: string }
> = {
  error: { icon: AlertCircle, className: 'text-destructive', label: 'Errors' },
  warning: {
    icon: AlertTriangle,
    className: 'text-amber-600 dark:text-amber-500',
    label: 'Warnings',
  },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Info' },
};

/**
 * Engine diagnostics, grouped by level.
 *
 * An entry carrying an `instanceId` selects that node when clicked — which is
 * how the Cerbo GX's unconnected required input gets from the list to the
 * canvas. Entries without one (a tree-level problem like `import-cycle`) render
 * as plain text rather than a dead button.
 */
export function DiagnosticsPanel({
  diagnostics,
  onSelect,
}: DiagnosticsPanelProps) {
  if (!diagnostics.length) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No diagnostics. Every required input is connected.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {LEVELS.map((level) => {
          const entries = diagnostics.filter((entry) => entry.level === level);
          if (!entries.length) return null;

          const { icon: Icon, className, label } = LEVEL_META[level];

          return (
            <section key={level} className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <Icon className={cn('size-3.5', className)} aria-hidden />
                {label}
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {entries.length}
                </Badge>
              </h3>

              <ul className="space-y-1">
                {entries.map((entry, index) => {
                  const key = `${entry.code}-${entry.instanceId ?? index}`;
                  const body = (
                    <>
                      <p className="text-sm">{entry.message}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <code className="font-mono">{entry.code}</code>
                        {entry.path?.length ? (
                          <span>· {entry.path.join(' › ')}</span>
                        ) : null}
                      </p>
                    </>
                  );

                  if (!entry.instanceId) {
                    return (
                      <li key={key} className="rounded-md border px-2 py-1.5">
                        {body}
                      </li>
                    );
                  }

                  const instanceId = entry.instanceId;

                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => onSelect({ type: 'node', instanceId })}
                        className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-accent"
                      >
                        {body}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}
