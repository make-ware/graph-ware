'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import { subgraphColor } from './subgraph-palette';
import { useViewerSurface } from './viewer-shell';

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

/**
 * The subgraph list: the root plus every import instance, by label.
 *
 * Selecting one sets `?focus` to its instance path — so `port_bank` and
 * `starboard_bank` focus independently despite being the same child graph.
 * Each entry also links to the child's own `/graphs/[id]` route, because every
 * graph is first class and renders as its own root.
 */
export function GraphSidebar() {
  const { graph, subgraphs, focus, setFocus, canEdit } = useGraphViewer();
  const pathname = usePathname();
  // On a phone this list lives in a Sheet over the canvas; a no-op elsewhere.
  const { dismiss } = useViewerSurface();

  /** Focus a subgraph, then get out of the way of the result. */
  const focusOn = (path: string[]) => {
    setFocus(path);
    dismiss();
  };

  return (
    <div className="bg-sidebar flex h-full min-h-0 flex-col">
      <div className="space-y-1 p-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 h-9"
        >
          <Link href="/graphs">
            <ArrowLeft className="size-3.5" />
            All graphs
          </Link>
        </Button>

        <h1 className="truncate text-base font-semibold" title={graph?.label}>
          {graph?.label ?? 'Loading…'}
        </h1>

        <div className="flex flex-wrap items-center gap-1">
          {graph?.namespace && (
            <Badge variant="secondary" className="text-[10px]">
              {graph.namespace}
            </Badge>
          )}
          {graph && (
            <Badge variant="outline" className="text-[10px]">
              {graph.visibility}
            </Badge>
          )}
          {graph && !canEdit && (
            <Badge variant="outline" className="text-[10px]">
              read-only
            </Badge>
          )}
        </div>

        {/* Only on the viewer route — the editor already is the edit surface. */}
        {graph && canEdit && !pathname.endsWith('/edit') && (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={`/graphs/${graph.id}/edit`}>
              <Pencil className="size-3.5" />
              Edit graph
            </Link>
          </Button>
        )}
      </div>

      <Separator />

      <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        Subgraphs
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-0.5 p-2 pt-0">
          {subgraphs.map((entry) => {
            const isActive = samePath(entry.path, focus);
            const key = entry.path.join('/') || '__root__';

            return (
              <li key={key} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => focusOn(entry.path)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'hover:bg-sidebar-accent flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
                    isActive && 'bg-sidebar-accent font-medium'
                  )}
                  style={{ paddingLeft: `${entry.depth * 12 + 8}px` }}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: subgraphColor(entry.graphColorIndex),
                    }}
                    aria-hidden
                  />
                  <span className="truncate" title={entry.label}>
                    {entry.label}
                  </span>
                  {/*
                    A pinned instance renders a snapshot, not the child's
                    current state — which is invisible on the canvas and would
                    otherwise only be discoverable by opening the import panel.
                  */}
                  {entry.pinnedVersion !== undefined && (
                    <Badge
                      variant="outline"
                      className="shrink-0 font-mono text-[10px]"
                      title="Pinned to a published version"
                    >
                      v{entry.pinnedVersion}
                    </Badge>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {entry.nodeCount}
                  </span>
                </button>

                {entry.depth > 0 && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-9 shrink-0"
                    title="Open this graph on its own"
                  >
                    <Link href={`/graphs/${entry.graphId}`}>
                      <ExternalLink className="size-3" />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {focus.length > 0 && (
        <div className="border-t p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setFocus([])}
          >
            Clear focus
          </Button>
        </div>
      )}
    </div>
  );
}
