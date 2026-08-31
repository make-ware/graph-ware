'use client';

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Workspace } from '@project/shared';
import {
  WorkspaceMutator,
  type WorkspaceMembership,
} from '@project/shared/mutators';
import { useAuth } from '@/hooks/use-auth';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

/** Where the active-workspace choice is remembered between visits. */
const STORAGE_KEY = 'graph-ware.workspace';

export interface WorkspaceContextValue {
  /** Every workspace the caller belongs to, with their role in each. */
  memberships: WorkspaceMembership[];
  /** The one the UI is currently scoped to, or `null` while loading. */
  active: Workspace | null;
  /** The caller's role in `active`. */
  role: WorkspaceMembership['role'] | null;
  /** False for a `viewer` — the flag every write control reads. */
  canWrite: boolean;
  /** True for the creator or an `admin` — who may manage the roll. */
  canAdminister: boolean;
  isLoading: boolean;
  error: string | null;
  setActive: (workspaceId: string) => void;
  /** Re-read the list, after creating a workspace or joining one. */
  reload: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

/** Stable empty array, so a signed-out render does not churn every consumer. */
const EMPTY_MEMBERSHIPS: WorkspaceMembership[] = [];

/**
 * The caller's workspaces, and which one the UI is scoped to.
 *
 * Mounted in the `(shell)` layout rather than per page: the active workspace
 * decides what `/graphs` lists and where `/graphs/new` writes, and a choice
 * that reset on every navigation would be worse than no choice at all.
 *
 * The role is carried alongside the workspace on purpose. `canWrite` here is
 * **not** the security boundary — the collection rules are, and they are
 * verified against a live server by `scripts/verify-workspace-rules.mjs`. This
 * is so a viewer sees a read-only page instead of buttons that produce a 403.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();

  // Tagged with the user it was loaded for, so signing out — or switching
  // accounts — invalidates it by comparison rather than by an effect that
  // clears state and cascades a render. Same shape as `GraphViewerProvider`'s
  // `requestKey`.
  const [loaded, setLoaded] = useState<{
    userId: string;
    rows: WorkspaceMembership[];
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const userId = user?.id ?? null;
  const settled = Boolean(userId) && loaded?.userId === userId;
  const memberships = settled ? loaded!.rows : EMPTY_MEMBERSHIPS;
  const isLoading = Boolean(isAuthenticated) && !settled;

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const setActive = useCallback((workspaceId: string) => {
    setActiveId(workspaceId);
    try {
      window.localStorage.setItem(STORAGE_KEY, workspaceId);
    } catch {
      // A browser with storage disabled just loses the preference.
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let cancelled = false;

    new WorkspaceMutator(pb as unknown as TypedPocketBase)
      .listMine()
      .then((rows) => {
        if (cancelled) return;

        setLoaded({ userId, rows });
        setError(null);

        setActiveId((current) => {
          if (current && rows.some((row) => row.workspace.id === current)) {
            return current;
          }

          let remembered: string | null = null;
          try {
            remembered = window.localStorage.getItem(STORAGE_KEY);
          } catch {
            remembered = null;
          }
          if (
            remembered &&
            rows.some((row) => row.workspace.id === remembered)
          ) {
            return remembered;
          }

          // Personal first: it is where a solo user's work already lives, and
          // where a new graph goes if they never pick anything.
          const personal = rows.find((row) => row.workspace.personal);
          return personal?.workspace.id ?? rows[0]?.workspace.id ?? null;
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.error('Failed to load workspaces', cause);
        setError('Your workspaces could not be loaded.');
        // Settle anyway, with an empty roll: a page stuck on a loading skeleton
        // forever is worse than one that says it has no workspaces.
        setLoaded({ userId, rows: [] });
      });

    return () => {
      cancelled = true;
    };
    // `user.id` rather than `user`: the auth provider hands back a new record
    // object on every refresh, which would otherwise reload this every 5 minutes.
  }, [isAuthenticated, userId, reloadToken]);

  const current = useMemo(
    () => memberships.find((row) => row.workspace.id === activeId) ?? null,
    [memberships, activeId]
  );

  const value: WorkspaceContextValue = useMemo<WorkspaceContextValue>(
    () => ({
      memberships,
      active: current?.workspace ?? null,
      role: current?.role ?? null,
      canWrite: current ? current.role !== 'viewer' : false,
      canAdminister:
        current?.role === 'owner' || current?.role === 'admin' ? true : false,
      isLoading,
      error,
      setActive,
      reload,
    }),
    [memberships, current, isLoading, error, setActive, reload]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export { WorkspaceContext };
