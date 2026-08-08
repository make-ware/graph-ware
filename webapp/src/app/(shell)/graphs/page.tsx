'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, GitFork, Network, Pencil, Plus } from 'lucide-react';
import type { Graph } from '@project/shared';
import {
  GraphImportMutator,
  GraphMutator,
  GraphNodeMutator,
} from '@project/shared/mutators';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { ForkDialog } from '@/components/graph/fork-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaces } from '@/hooks/use-workspaces';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';

interface GraphCounts {
  nodes: number;
  imports: number;
}

/** Graphs the user can see, plus the two counts shown on each card. */
interface GraphsListState {
  graphs: Graph[];
  counts: Record<string, GraphCounts>;
}

function GraphCard({
  graph,
  counts,
  canEdit,
  isOwner,
  onFork,
}: {
  graph: Graph;
  counts: GraphCounts | undefined;
  /** Whether the caller may write this graph's workspace. */
  canEdit: boolean;
  /** Whether they created it. Provenance, not permission. */
  isOwner: boolean;
  onFork: () => void;
}) {
  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 text-base">
            <Link
              href={`/graphs/${graph.id}`}
              className="block truncate hover:underline"
            >
              {graph.label}
            </Link>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {graph.visibility}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={`Fork ${graph.label}`}
              onClick={onFork}
            >
              <GitFork className="size-3.5" />
              <span className="sr-only">Fork {graph.label}</span>
            </Button>
            {canEdit && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-7"
                title={`Edit ${graph.label}`}
              >
                <Link href={`/graphs/${graph.id}/edit`}>
                  <Pencil className="size-3.5" />
                  <span className="sr-only">Edit {graph.label}</span>
                </Link>
              </Button>
            )}
          </div>
        </div>

        <CardDescription className="line-clamp-2">
          {graph.description || <span className="italic">No description.</span>}
        </CardDescription>

        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Boxes className="size-3.5" aria-hidden />
            {counts?.nodes ?? 0} node{counts?.nodes === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <Network className="size-3.5" aria-hidden />
            {counts?.imports ?? 0} import{counts?.imports === 1 ? '' : 's'}
          </span>
          {graph.namespace && (
            <span className="font-mono">{graph.namespace}</span>
          )}
          {!isOwner && <Badge variant="secondary">shared</Badge>}
          {graph.forkedFrom && <Badge variant="outline">fork</Badge>}
        </div>

        {graph.tags?.length ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {graph.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>
    </Card>
  );
}

function GraphsList() {
  const { user } = useAuth();
  const { memberships, active, isLoading: workspacesLoading } = useWorkspaces();

  const [state, setState] = useState<GraphsListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [forking, setForking] = useState<Graph | null>(null);

  const workspaceIds = useMemo(
    () => memberships.map((row) => row.workspace.id),
    [memberships]
  );

  useEffect(() => {
    if (workspacesLoading) return;

    let cancelled = false;

    const load = async () => {
      const client = pb as unknown as TypedPocketBase;

      // Every workspace the caller is on, not just the active one. The switcher
      // decides where a *new* graph goes; hiding the others would mean losing
      // sight of work you can perfectly well open.
      const result = await new GraphMutator(client).listForWorkspaces(
        workspaceIds
      );
      const graphs = result.items;
      const ids = graphs.map((graph) => graph.id);

      // Two bulk queries rather than a count request per graph — the mutators
      // already batch by id, so the request count does not grow with the list.
      const [nodes, imports] = await Promise.all([
        new GraphNodeMutator(client).listForGraphs(ids),
        new GraphImportMutator(client).listForParents(ids),
      ]);

      const counts: Record<string, GraphCounts> = {};
      for (const id of ids) counts[id] = { nodes: 0, imports: 0 };
      for (const node of nodes) {
        if (counts[node.graph]) counts[node.graph].nodes++;
      }
      for (const record of imports) {
        if (counts[record.parent]) counts[record.parent].imports++;
      }

      if (!cancelled) setState({ graphs, counts });
    };

    load().catch((cause: unknown) => {
      console.error('Failed to load graphs', cause);
      if (!cancelled) setError('Your graphs could not be loaded.');
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceIds, workspacesLoading]);

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const graph of state?.graphs ?? []) {
      for (const tag of graph.tags ?? []) all.add(tag);
    }
    return [...all].sort();
  }, [state]);

  /** Workspace id → its name and whether the caller may write it. */
  const workspaceInfo = useMemo(() => {
    const info = new Map<string, { name: string; canWrite: boolean }>();
    for (const row of memberships) {
      info.set(row.workspace.id, {
        name: row.workspace.name,
        canWrite: row.role !== 'viewer',
      });
    }
    return info;
  }, [memberships]);

  // Grouped by workspace rather than by namespace, which is what workspaces
  // were for. `namespace` survives as part of the uid uniqueness key and is
  // shown on the card; it is no longer the organizing idea.
  const grouped = useMemo(() => {
    const visible = (state?.graphs ?? []).filter(
      (graph) => !activeTag || graph.tags?.includes(activeTag)
    );

    const groups = new Map<string, Graph[]>();
    for (const graph of visible) {
      const bucket = groups.get(graph.workspace);
      if (bucket) bucket.push(graph);
      else groups.set(graph.workspace, [graph]);
    }

    // The active workspace first — it is the one the user is working in — then
    // the rest by name.
    return [...groups.entries()].sort(([left], [right]) => {
      if (left === active?.id) return -1;
      if (right === active?.id) return 1;
      return (workspaceInfo.get(left)?.name ?? '').localeCompare(
        workspaceInfo.get(right)?.name ?? ''
      );
    });
  }, [state, activeTag, active, workspaceInfo]);

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }

  if (!state) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-36 w-full" />
        ))}
      </div>
    );
  }

  if (!state.graphs.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No graphs yet.{' '}
        <Link href="/graphs/new" className="underline">
          Create one
        </Link>
        , browse the{' '}
        <Link href="/library" className="underline">
          library
        </Link>
        , or run <code className="font-mono">yarn db:seed</code> to load the
        sample system.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={activeTag ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => setActiveTag(null)}
          >
            All
          </Button>
          {tags.map((tag) => (
            <Button
              key={tag}
              variant={activeTag === tag ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      )}

      {grouped.map(([workspaceId, graphs]) => {
        const info = workspaceInfo.get(workspaceId);

        return (
          <section key={workspaceId} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
              {info?.name ?? 'Workspace'}
              {info && !info.canWrite && (
                <Badge variant="outline" className="text-[10px] normal-case">
                  read only
                </Badge>
              )}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {graphs.map((graph) => (
                <GraphCard
                  key={graph.id}
                  graph={graph}
                  counts={state.counts[graph.id]}
                  canEdit={info?.canWrite ?? false}
                  isOwner={graph.owner === user?.id}
                  onFork={() => setForking(graph)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {forking && (
        <ForkDialog
          graph={forking}
          open={Boolean(forking)}
          onOpenChange={(open) => {
            if (!open) setForking(null);
          }}
        />
      )}
    </div>
  );
}

export default function GraphsPage() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Graphs</h1>
            <p className="text-muted-foreground">
              Everything in the workspaces you belong to.
            </p>
          </div>
          <Button asChild>
            <Link href="/graphs/new">
              <Plus className="mr-1 size-4" />
              New graph
            </Link>
          </Button>
        </div>

        <GraphsList />
      </div>
    </ProtectedRoute>
  );
}
