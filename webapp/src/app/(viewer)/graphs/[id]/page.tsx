'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { GraphCanvas } from '@/components/graph/graph-canvas';
import { GraphDetailPanel } from '@/components/graph/graph-detail-panel';
import { DiagnosticsPanel } from '@/components/graph/diagnostics-panel';
import { GraphSidebar } from '@/components/graph/graph-sidebar';
import { ViewerShell } from '@/components/graph/viewer-shell';
import { TabStrip } from '@/components/graph/tab-strip';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraphViewerProvider } from '@/contexts/graph-viewer-context';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import { usePortKinds } from '@/hooks/use-port-kinds';
import {
  parseViewerParams,
  type ViewerSelection,
  writeViewerParams,
} from '@/lib/graph/flow-adapter';

function ViewerBody() {
  const { view, selection, select, isLoading, error } = useGraphViewer();
  const { colorFor } = usePortKinds();

  const errorCount = view.diagnostics.filter(
    (entry) => entry.level === 'error'
  ).length;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <ViewerShell
      // react-resizable-panels v4: percentages must be *strings* — a bare
      // number is interpreted as pixels.
      sizes={{ sidebar: '18%', canvas: '57%', panel: '25%' }}
      sidebar={<GraphSidebar />}
      canvas={
        <div className="relative h-full">
          {isLoading && (
            <div className="bg-background/60 text-muted-foreground absolute inset-0 z-10 flex items-center justify-center text-sm">
              Resolving graph…
            </div>
          )}
          <GraphCanvas
            view={view}
            colorFor={colorFor}
            selection={selection}
            onSelect={select}
          />
        </div>
      }
      panel={
        <Tabs defaultValue="details" className="flex h-full flex-col gap-0">
          <TabStrip>
            <TabsList className="w-max min-w-full justify-start">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="diagnostics">
                Diagnostics
                {errorCount > 0 && (
                  <Badge variant="destructive" className="ml-1.5 text-[10px]">
                    {errorCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </TabStrip>

          <TabsContent value="details" className="min-h-0 flex-1">
            <GraphDetailPanel
              view={view}
              selection={selection}
              colorFor={colorFor}
            />
          </TabsContent>

          <TabsContent value="diagnostics" className="min-h-0 flex-1">
            <DiagnosticsPanel
              diagnostics={view.diagnostics}
              onSelect={select}
            />
          </TabsContent>
        </Tabs>
      }
    />
  );
}

/**
 * Focus and selection live in the query string so a focused view is linkable.
 *
 * `useSearchParams` needs a Suspense boundary above it, which is why this is
 * split out from the default export.
 */
function GraphViewer() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rootId = params.id;

  const { focus, selection } = useMemo(
    () => parseViewerParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  // `replace`, not `push`: focusing a subgraph is a view adjustment, and
  // stacking one history entry per click would make Back useless.
  const write = useCallback(
    (next: { focus: string[]; selection: ViewerSelection | null }) => {
      const query = writeViewerParams(
        new URLSearchParams(searchParams.toString()),
        next
      );
      const suffix = query.toString();
      router.replace(suffix ? `?${suffix}` : '?', { scroll: false });
    },
    [router, searchParams]
  );

  const onFocusChange = useCallback(
    // Selection is dropped on a focus change: the selected node is usually
    // outside the new focus, and a selection pointing at nothing is worse than
    // none at all.
    (nextFocus: string[]) => write({ focus: nextFocus, selection: null }),
    [write]
  );

  const onSelectionChange = useCallback(
    (nextSelection: ViewerSelection | null) =>
      write({ focus, selection: nextSelection }),
    [write, focus]
  );

  return (
    <GraphViewerProvider
      rootId={rootId}
      focus={focus}
      selection={selection}
      onFocusChange={onFocusChange}
      onSelectionChange={onSelectionChange}
    >
      <ViewerBody />
    </GraphViewerProvider>
  );
}

export default function GraphViewerPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <GraphViewer />
      </Suspense>
    </ProtectedRoute>
  );
}
