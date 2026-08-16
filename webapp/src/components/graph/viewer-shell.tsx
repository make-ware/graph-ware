'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import { ListTree, PanelRightOpen } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

export interface ViewerShellSizes {
  sidebar: string;
  canvas: string;
  panel: string;
}

interface ViewerShellProps {
  /** The subgraph tree. A pane on the left at `md`+, a left Sheet below it. */
  sidebar: React.ReactNode;
  /** The canvas. Mounted exactly once, in either layout. */
  canvas: React.ReactNode;
  /** Details / diagnostics / editor tabs. Right pane, or a right Sheet. */
  panel: React.ReactNode;
  /** Per-route pane percentages — the viewer and the editor are tuned apart. */
  sizes: ViewerShellSizes;
  /** Title on the mobile panel Sheet. */
  panelTitle?: string;
}

/**
 * Lets a component inside a mobile Sheet dismiss it after an action whose
 * result is on the canvas behind it.
 *
 * A context rather than a prop because the components that need it —
 * `GraphSidebar`, most of all — sit several levels below the shell and are
 * shared with the desktop layout, where the whole idea is a no-op.
 */
const ViewerSurfaceContext = createContext<{ dismiss: () => void }>({
  dismiss: () => {},
});

export function useViewerSurface() {
  return useContext(ViewerSurfaceContext);
}

/**
 * The three-region graph layout, at both viewport sizes.
 *
 * At `md`+ this is the resizable three-pane split the app has always had. Below
 * `md` those panes would be roughly 67px / 214px / 94px on a phone, so the
 * canvas takes the whole area and the sidebar and panel become Sheets reached
 * from a floating control row.
 *
 * The branch is `useIsMobile()` — JS — rather than CSS, unlike the navigation
 * bar. Rendering both layouts and hiding one would mount two `<ReactFlow>`
 * instances, and the hidden one measures zero, which breaks `fitView` in the
 * copy that is actually visible. The usual objection to the hook — its server
 * snapshot always says desktop — does not apply here: these routes sit behind
 * `ProtectedRoute` and resolve their graph in the browser, so there is no
 * meaningful pre-hydration paint to flash.
 *
 * `sidebar` and `panel` are rendered in both layouts, but Radix leaves a closed
 * `SheetContent` unmounted, so the mobile copies cost nothing until opened —
 * and since all of their state comes from `GraphViewerProvider`, the two copies
 * cannot disagree.
 */
export function ViewerShell({
  sidebar,
  canvas,
  panel,
  sizes,
  panelTitle = 'Details',
}: ViewerShellProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Focusing a subgraph re-renders the canvas *behind* the sheet that triggered
  // it; leaving the sheet up hides the very thing the tap asked for.
  const surface = useMemo(
    () => ({
      dismiss: () => {
        setSidebarOpen(false);
        setPanelOpen(false);
      },
    }),
    []
  );

  if (!isMobile) {
    // react-resizable-panels v4: percentages must be *strings* — a bare number
    // is interpreted as pixels.
    return (
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize={sizes.sidebar} minSize="12%" maxSize="30%">
          {sidebar}
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={sizes.canvas} minSize="30%">
          {canvas}
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={sizes.panel} minSize="15%" maxSize="45%">
          {panel}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <ViewerSurfaceContext.Provider value={surface}>
      <div className="relative h-full">
        {canvas}

        {/* Floating over the canvas rather than stacked above it: vertical
            space is the scarce thing on a phone, and XYFlow's own controls
            already sit in the bottom corners. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-2">
          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto h-9 shadow-md"
            onClick={() => setSidebarOpen(true)}
          >
            <ListTree className="mr-1.5 size-4" />
            Subgraphs
          </Button>

          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto h-9 shadow-md"
            onClick={() => setPanelOpen(true)}
          >
            <PanelRightOpen className="mr-1.5 size-4" />
            {panelTitle}
          </Button>
        </div>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[85vw] gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="border-b">
              <SheetTitle>Subgraphs</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">{sidebar}</div>
          </SheetContent>
        </Sheet>

        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          <SheetContent side="right" className="w-[85vw] gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="border-b">
              <SheetTitle>{panelTitle}</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
          </SheetContent>
        </Sheet>
      </div>
    </ViewerSurfaceContext.Provider>
  );
}
