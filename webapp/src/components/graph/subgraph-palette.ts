/**
 * Colours for subgraph membership, keyed by `FlatNode.graphColorIndex`.
 *
 * Built on the theme's `--chart-*` tokens rather than literal hex so the canvas
 * follows light/dark mode with everything else. These are *membership* colours
 * and carry no meaning beyond "these nodes came from the same graph instance" —
 * port and edge colour is a separate axis and comes from `PortKinds`.
 *
 * The index is per graph *instance*, so `port_bank` and `starboard_bank` get
 * different colours even though they are the same child graph. That is the
 * whole point of the acceptance criterion.
 */
const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export const SUBGRAPH_PALETTE_SIZE = PALETTE.length;

/**
 * The same palette as utility classes, for SVG.
 *
 * `fill="var(--chart-1)"` does not work: `var()` is invalid in a presentation
 * *attribute*, which is how XYFlow's minimap applies `nodeColor`, so the shapes
 * come out unpainted. Setting `fill` as a CSS property does work — hence the
 * class list.
 *
 * Two details that are easy to lose:
 * - Written out as literals, because Tailwind scans source text and would never
 *   generate a class assembled at runtime.
 * - Marked important, because `.react-flow__minimap-node` already sets `fill`
 *   at the same specificity and XYFlow's stylesheet is imported after ours.
 */
const FILL_CLASSES = [
  'fill-[var(--chart-1)]!',
  'fill-[var(--chart-2)]!',
  'fill-[var(--chart-3)]!',
  'fill-[var(--chart-4)]!',
  'fill-[var(--chart-5)]!',
] as const;

function paletteIndex(graphColorIndex: number): number {
  return (
    ((graphColorIndex % SUBGRAPH_PALETTE_SIZE) + SUBGRAPH_PALETTE_SIZE) %
    SUBGRAPH_PALETTE_SIZE
  );
}

/** Wraps rather than clamping: a sixth subgraph reuses the first colour. */
export function subgraphColor(graphColorIndex: number): string {
  return PALETTE[paletteIndex(graphColorIndex)];
}

/** The SVG-safe form of `subgraphColor`. */
export function subgraphFillClass(graphColorIndex: number): string {
  return FILL_CLASSES[paletteIndex(graphColorIndex)];
}

/**
 * A translucent wash of the membership colour, for node backgrounds.
 *
 * `color-mix` keeps one source of truth for the hue — a second hardcoded list
 * of pale variants would drift the moment the theme changed.
 */
export function subgraphTint(graphColorIndex: number, percent = 12): string {
  return `color-mix(in oklch, ${subgraphColor(graphColorIndex)} ${percent}%, transparent)`;
}
