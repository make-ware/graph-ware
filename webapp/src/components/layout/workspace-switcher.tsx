'use client';

import Link from 'next/link';
import { Building2, Check, ChevronDown, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';

/**
 * The active-workspace control in the navigation bar.
 *
 * Hidden entirely when the caller has exactly one workspace and it is their
 * personal one — which is every single-player account. Workspaces should cost
 * nothing to a user who does not have teammates.
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { memberships, active, role, setActive, isLoading } = useWorkspaces();

  if (isLoading || !active) return null;
  if (memberships.length === 1 && memberships[0].workspace.personal)
    return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('max-w-[14rem] gap-1.5', className)}
        >
          <Building2 className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{active.name}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>

        {memberships.map(({ workspace, role: membershipRole }) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => setActive(workspace.id)}
            className="gap-2"
          >
            <Check
              className={cn(
                'size-4 shrink-0',
                workspace.id === active.id ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {membershipRole}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/workspaces/${active.slug}`}>
            <Settings2 className="mr-2 size-4" aria-hidden />
            Manage {active.name}
            {role === 'viewer' && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                read only
              </span>
            )}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/workspaces">All workspaces</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
