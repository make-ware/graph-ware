// XYFlow ships its own stylesheet and will not render correctly without it.
// Imported here rather than in `globals.css` so only the viewer route pays for
// it — no other page mounts a canvas.
import '@xyflow/react/dist/style.css';
import { NavigationBar } from '@/components/layout/navigation-bar';

/**
 * The graph routes: a compact navigation bar above a canvas that owns the rest
 * of the viewport.
 *
 * The bar is the same component the rest of the app uses, in its `compact`
 * variant — before, these routes had no navigation at all and the only way out
 * was a link buried in the subgraph sidebar.
 *
 * Below it the document still must not scroll: the canvas manages its own
 * panning and zooming, and `overflow-hidden` keeps the browser from fighting
 * XYFlow for the wheel event. `h-dvh` rather than `h-screen` because mobile
 * browser chrome makes `100vh` taller than what is actually visible, which
 * cropped the bottom of the panel group; `w-full` rather than `w-screen`
 * because `100vw` overshoots whenever a scrollbar gutter exists.
 *
 * No `WorkspaceProvider` here, deliberately — `GraphViewerProvider` loads its
 * own membership for `canEdit`, and `WorkspaceSwitcher` renders nothing when
 * the context is absent.
 */
export default function ViewerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <NavigationBar variant="compact" className="shrink-0" />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
