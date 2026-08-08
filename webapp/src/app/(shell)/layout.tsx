import { NavigationBar } from '@/components/layout/navigation-bar';

/**
 * The standard application shell: navigation bar above a scrolling page.
 *
 * Everything except the graph viewer lives here. The viewer needs the whole
 * viewport for its canvas, so it sits in `(viewer)` with its own bare layout
 * rather than trying to opt out of this one.
 */
export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <NavigationBar />
      <main className="min-h-screen">{children}</main>
    </>
  );
}
