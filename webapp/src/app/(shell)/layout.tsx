import { NavigationBar } from '@/components/layout/navigation-bar';
import { WorkspaceProvider } from '@/contexts/workspace-context';

/**
 * The standard application shell: navigation bar above a scrolling page.
 *
 * Everything except the graph viewer lives here. The viewer needs the whole
 * viewport for its canvas, so it sits in `(viewer)` with its own bare layout
 * rather than trying to opt out of this one.
 *
 * `WorkspaceProvider` is mounted here rather than per page because the active
 * workspace decides what `/graphs` lists and where `/graphs/new` writes; a
 * choice that reset on every navigation would be worse than no choice at all.
 * It is the one feature provider that is not per-page — see docs/DESIGN.md.
 */
export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WorkspaceProvider>
      <NavigationBar />
      {/* The bar sits above this, so a full `100dvh` here would always overflow
          the viewport by its height. `dvh` rather than `vh` so the mobile URL
          bar collapsing does not leave a gap. */}
      <main className="min-h-[calc(100dvh-3.5rem)]">{children}</main>
    </WorkspaceProvider>
  );
}
