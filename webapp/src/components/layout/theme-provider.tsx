'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Wraps `next-themes` so the class-based dark variant in `globals.css`
 * (`@custom-variant dark (&:is(.dark *))`) has something toggling `.dark` on
 * `<html>`. Mounted globally in `app/layout.tsx` rather than per route group:
 * `(viewer)` runs without the navigation bar, but it still renders in whatever
 * theme the user picked elsewhere.
 */
export function ThemeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
