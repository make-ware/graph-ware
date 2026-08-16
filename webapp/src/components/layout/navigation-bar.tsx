'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import { MobileNav } from '@/components/layout/mobile-nav';
import {
  ACCOUNT_LINKS,
  PRIMARY_LINKS,
  isActivePath,
} from '@/components/layout/nav-links';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { userInitials } from './user-initials';

interface NavigationBarProps {
  className?: string;
  /**
   * `compact` is the graph routes' bar: shorter, full-bleed rather than
   * container-width, and without the primary links — the canvas needs the
   * height, and the sheet still carries every destination.
   */
  variant?: 'default' | 'compact';
}

/**
 * The one navigation bar, on every route and every viewport.
 *
 * Desktop and mobile are separated with CSS (`hidden md:flex` / `md:hidden`),
 * not with `useIsMobile()`. The hook reports desktop for the server snapshot,
 * so branching on it meant a phone rendered the desktop bar and swapped after
 * hydration — and it let the two branches offer different destinations, which
 * is exactly what they had drifted into.
 */
export function NavigationBar({
  className,
  variant = 'default',
}: NavigationBarProps) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const pathname = usePathname();

  const compact = variant === 'compact';

  return (
    <header
      className={cn(
        'bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 border-b backdrop-blur',
        'pt-[env(safe-area-inset-top)]',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-4',
          compact ? 'h-12 w-full' : 'container mx-auto h-14'
        )}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
          aria-label="Graph Ware home"
        >
          <span className={cn('font-bold', compact ? 'text-base' : 'text-xl')}>
            Graph Ware
          </span>
        </Link>

        {/* Primary destinations, visible rather than buried in the avatar
            menu — the mobile sheet has always shown them. */}
        {isAuthenticated && !compact && (
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {PRIMARY_LINKS.map((link) => {
              const active = isActivePath(pathname, link.href);
              return (
                <Button
                  key={link.href}
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  asChild
                >
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                  >
                    <link.icon className="mr-1.5 size-4" />
                    {link.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        )}

        {/* The flexible gap that pushes the account controls to the right. */}
        <div className="min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-1.5">
          {isAuthenticated && !compact && (
            <WorkspaceSwitcher className="hidden md:inline-flex" />
          )}

          <div className="hidden items-center gap-1.5 md:flex">
            <ThemeToggle />
            {isLoading ? (
              <div className="bg-muted h-8 w-20 animate-pulse rounded" />
            ) : isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative size-8 rounded-full"
                    aria-label="Account menu"
                  >
                    <Avatar className="size-8">
                      <AvatarImage
                        src={user?.avatar}
                        alt={user?.name || user?.email}
                      />
                      <AvatarFallback>
                        {userInitials(user?.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm leading-none font-medium">
                        {user?.name || 'User'}
                      </p>
                      <p className="text-muted-foreground truncate text-xs leading-none">
                        {user?.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* On the compact bar the primary links have no row of their
                      own, so the menu carries them too. */}
                  {(compact
                    ? [...PRIMARY_LINKS, ...ACCOUNT_LINKS]
                    : ACCOUNT_LINKS
                  ).map((link) => (
                    <DropdownMenuItem key={link.href} asChild>
                      <Link href={link.href} className="flex items-center">
                        <link.icon className="mr-2 size-4" />
                        <span>{link.label}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => logout()}>
                    <LogOut className="mr-2 size-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">Login</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/signup">Sign Up</Link>
                </Button>
              </div>
            )}
          </div>

          <MobileNav />
        </div>
      </div>
    </header>
  );
}
