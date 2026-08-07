// XYFlow ships its own stylesheet and will not render correctly without it.
// Imported here rather than in `globals.css` so only the viewer route pays for
// it — no other page mounts a canvas.
import '@xyflow/react/dist/style.css';

/**
 * Full-bleed layout for the graph viewer: no navigation bar, no page scroll.
 *
 * The canvas manages its own panning and zooming, so the document itself must
 * not scroll — `overflow-hidden` on a viewport-sized box keeps the browser
 * from fighting XYFlow for the wheel event.
 */
export default function ViewerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-screen w-screen overflow-hidden">{children}</div>;
}
