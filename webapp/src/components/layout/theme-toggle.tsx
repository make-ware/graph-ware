'use client';

import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const noopSubscribe = () => () => {};

/** False during SSR and the first render, true once hydrated. */
function useIsHydrated() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

interface ThemeToggleProps {
  className?: string;
  /** Full-width labelled row for the mobile sheet, icon button otherwise. */
  variant?: 'icon' | 'inline';
}

/**
 * Light / dark / system switch.
 *
 * The rendered icon depends on the resolved theme, which is only known in the
 * browser — rendering it before mount would mismatch the server's HTML, so the
 * icon is held at its neutral state until then. The button itself renders
 * immediately so the bar doesn't reflow.
 */
export function ThemeToggle({ className, variant = 'icon' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useIsHydrated();

  const isDark = mounted && resolvedTheme === 'dark';

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={mounted && theme === option.value ? 'secondary' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => setTheme(option.value)}
          >
            <option.icon className="mr-2 h-4 w-4" />
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', className)}
          aria-label="Toggle theme"
        >
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={mounted && theme === option.value}
            onCheckedChange={() => setTheme(option.value)}
          >
            <option.icon className="mr-2 h-4 w-4" />
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
