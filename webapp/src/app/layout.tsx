import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/auth-context';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { Toaster } from '@/components/ui/sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Graph Ware',
  description: 'Graph Ware — built with Next.js and PocketBase',
};

/**
 * Next injects `width=device-width, initial-scale=1` on its own; this adds the
 * two things it does not. `viewportFit: 'cover'` is what makes
 * `env(safe-area-inset-*)` report anything, which the sticky bar and the
 * canvas toolbar rely on. Zoom is deliberately left unclamped — a graph is
 * exactly the kind of dense content people pinch into.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1020' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes writes the theme class onto <html> before hydration, so the
    // server's markup never matches — suppressHydrationWarning is required.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Chrome lives in the route-group layouts, not here: `(shell)` adds
            the navigation bar, `(viewer)` deliberately runs without it. The
            theme is global, though — both route groups read it. */}
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
