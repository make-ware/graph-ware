import React from 'react';
import { cn } from '@/lib/utils';

/**
 * A horizontally scrollable rail for a `TabsList`.
 *
 * The editor's panel has five tabs whose labels are `whitespace-nowrap`; in a
 * phone-width sheet they used to compress into unreadable slivers. Scrolling
 * the strip keeps every label at full size instead, and is a no-op at widths
 * where they already fit.
 *
 * The scrollbar itself is hidden — it would sit on top of the tab labels in the
 * few pixels the strip has, and the overflow is discoverable by dragging.
 */
export function TabStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'shrink-0 overflow-x-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {children}
    </div>
  );
}
