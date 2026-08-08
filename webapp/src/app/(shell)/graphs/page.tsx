'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, Network, Pencil, Plus } from 'lucide-react';
import type { Graph } from '@project/shared';
import {
  GraphImportMutator,
  GraphMutator,
  GraphNodeMutator,
} from '@project/shared/mutators';
import { ProtectedRoute } from '@/components/auth/protected-route';
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
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';
import { cn } from '@/lib/utils';

interface GraphCounts {
  nodes: number;
  imports: number;
}

/** Graphs the user can see, plus the two counts shown on each card. */
interface GraphsListState {
  graphs: Graph[];
  counts: Record<string, GraphCounts>;
}

const UNGROUPED = '__ungrouped__';

function GraphCard({
  graph,
  counts,
  isOwner,
}: {
  graph: Graph;
  counts: GraphCounts | undefined;
  isOwner: boolean;
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
            {isOwner && (
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
          {!isOwner && <Badge variant="secondary">shared</Badge>}
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
  const [state, setState] = useState<GraphsListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const client = pb as unknown as TypedPocketBase;
      const graphMutator = new GraphMutator(client);

      const [mine, published] = await Promise.all([
        graphMutator.listMine(),
        graphMutator.listPublic(),
      ]);

      // A public graph you own comes back from both calls.
      const byId = new Map<string, Graph>();
      for (const graph of [...mine.items, ...published.items]) {
        byId.set(graph.id, graph);
      }
      const graphs = [...byId.values()];
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
  }, []);

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const graph of state?.graphs ?? []) {
      for (const tag of graph.tags ?? []) all.add(tag);
    }
    return [...all].sort();
  }, [state]);

  const grouped = useMemo(() => {
    const visible = (state?.graphs ?? []).filter(
      (graph) => !activeTag || graph.tags?.includes(activeTag)
    );

    const groups = new Map<string, Graph[]>();
    for (const graph of visible) {
      const key = graph.namespace || UNGROUPED;
      const bucket = groups.get(key);
      if (bucket) bucket.push(graph);
      else groups.set(key, [graph]);
    }

    // Named namespaces alphabetically, ungrouped last.
    return [...groups.entries()].sort(([left], [right]) => {
      if (left === UNGROUPED) return 1;
      if (right === UNGROUPED) return -1;
      return left.localeCompare(right);
    });
  }, [state, activeTag]);

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

      {grouped.map(([namespace, graphs]) => (
        <section key={namespace} className="space-y-3">
          <h2
            className={cn(
              'text-sm font-medium tracking-wide text-muted-foreground uppercase',
              namespace === UNGROUPED && 'italic'
            )}
          >
            {namespace === UNGROUPED ? 'No namespace' : namespace}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {graphs.map((graph) => (
              <GraphCard
                key={graph.id}
                graph={graph}
                counts={state.counts[graph.id]}
                isOwner={graph.owner === user?.id}
              />
            ))}
          </div>
        </section>
      ))}
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
              Your systems and everything published to the shared library.
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
