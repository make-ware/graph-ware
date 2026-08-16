'use client';

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Higher-order component for protecting routes that require authentication.
 * Redirects unauthenticated users to login page and preserves intended destination.
 */
export function ProtectedRoute({
  children,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Don't redirect while still loading auth state
    if (isLoading) return;

    // If not authenticated, redirect to login with return URL
    if (!isAuthenticated) {
      // Preserve the intended destination for post-login redirect
      const returnUrl = encodeURIComponent(pathname);
      const loginUrl = `${redirectTo}?returnUrl=${returnUrl}`;
      router.push(loginUrl);
    }
  }, [isAuthenticated, isLoading, router, pathname, redirectTo]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      // `min-h-full`, not `min-h-screen`: inside the viewer's fixed-height,
      // overflow-hidden shell a viewport-tall spinner would overflow it.
      <div className="flex min-h-full items-center justify-center py-16">
        <div
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"
          role="status"
          aria-label="Loading authentication status"
        >
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  // Don't render children if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  // Render protected content for authenticated users
  return <>{children}</>;
}

export default ProtectedRoute;
