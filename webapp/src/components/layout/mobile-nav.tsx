'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import {
  ACCOUNT_LINKS,
  GUEST_LINKS,
  PRIMARY_LINKS,
  isActivePath,
} from '@/components/layout/nav-links';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { userInitials } from './user-initials';

/**
 * The navigation menu below `md`.
 *
 * Rendered unconditionally alongside the desktop cluster and hidden with
 * `md:hidden` rather than swapped in by a JS media-query hook: `useIsMobile`
 * reports desktop during SSR, so a phone used to paint the desktop bar and
 * only correct itself after hydration.
 *
 * It carries the same `PRIMARY_LINKS` the desktop bar does, plus the account
 * links, the workspace switcher and the theme control — everything the wider
 * layout offers, in one column.
 */
export function MobileNav() {
  const { user, isAuthenticated, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[85vw] gap-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {isAuthenticated ? (
            <>
              <div className="flex items-center gap-3 border-b pb-4">
                <Avatar className="size-10">
                  <AvatarImage
                    src={user?.avatar}
                    alt={user?.name || user?.email}
                  />
                  <AvatarFallback>
                    {userInitials(user?.name, user?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-sm font-medium">
                    {user?.name || 'User'}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {user?.email}
                  </p>
                </div>
              </div>

              {/* The one place a phone can change workspace — the switcher used
                  to be desktop-only. It hides itself when there is nothing to
                  switch between. */}
              <WorkspaceSwitcher className="w-full justify-start" />

              <nav className="flex flex-col gap-1">
                {[...PRIMARY_LINKS, ...ACCOUNT_LINKS].map((link) => {
                  const active = isActivePath(pathname, link.href);
                  return (
                    <Button
                      key={link.href}
                      variant={active ? 'secondary' : 'ghost'}
                      className={cn('h-11 justify-start')}
                      asChild
                      onClick={close}
                    >
                      <Link
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                      >
                        <link.icon className="mr-2 size-4" />
                        {link.label}
                      </Link>
                    </Button>
                  );
                })}
              </nav>

              <Button
                variant="ghost"
                className="h-11 justify-start"
                onClick={() => {
                  close();
                  logout();
                }}
              >
                <LogOut className="mr-2 size-4" />
                Log out
              </Button>
            </>
          ) : (
            <nav className="flex flex-col gap-1">
              {GUEST_LINKS.map((link) => (
                <Button
                  key={link.href}
                  variant="ghost"
                  className="h-11 justify-start"
                  asChild
                  onClick={close}
                >
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ))}
            </nav>
          )}

          <div className="mt-auto border-t pt-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              Theme
            </p>
            <ThemeToggle variant="inline" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
