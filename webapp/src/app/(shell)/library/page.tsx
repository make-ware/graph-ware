'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, GitFork, Network, Plug, Search } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

/** What the library shows about a graph beyond its own record. */
interface LibraryStats {
  nodes: number;
  imports: number;
  /** How many graphs import this one — the quality signal. */
  usedBy: number;
  /** The port kinds it exposes, so "what does it plug into?" is answerable. */
  kinds: string[];
}

interface LibraryState {
  graphs: Graph[];
  stats: Record<string, LibraryStats>;
}

function LibraryCard({
  graph,
  stats,
  isOwn,
  onFork,
}: {
  graph: Graph;
  stats: LibraryStats | undefined;
  isOwn: boolean;
  onFork: () => void;
}) {
  return (
    <Card className="flex flex-col transition-colors hover:border-primary/50">
      <CardHeader className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 text-base">
            <Link
              href={`/graphs/${graph.id}`}
              className="block truncate hover:underline"
            >
              {graph.label}
            </Link>
          </CardTitle>
          {stats && stats.usedBy > 0 && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              used by {stats.usedBy}
            </Badge>
          )}
        </div>

        <CardDescription className="line-clamp-2">
          {graph.description || <span className="italic">No description.</span>}
        </CardDescription>

        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Boxes className="size-3.5" aria-hidden />
            {stats?.nodes ?? 0} node{stats?.nodes === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <Network className="size-3.5" aria-hidden />
            {stats?.imports ?? 0} import{stats?.imports === 1 ? '' : 's'}
          </span>
        </div>

        {stats?.kinds.length ? (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Plug className="size-3 text-muted-foreground" aria-hidden />
            {stats.kinds.slice(0, 6).map((kind) => (
              <Badge key={kind} variant="outline" className="text-[10px]">
                {kind}
              </Badge>
            ))}
            {stats.kinds.length > 6 && (
              <span className="text-[10px] text-muted-foreground">
                +{stats.kinds.length - 6}
              </span>
            )}
          </div>
        ) : null}

        {graph.tags?.length ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {graph.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2 pt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={`/graphs/${graph.id}`}>Open</Link>
          </Button>
          <Button size="sm" onClick={onFork}>
            <GitFork className="mr-1 size-3.5" aria-hidden />
            Fork
          </Button>
          {isOwn && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              yours
            </span>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}

function Library() {
  const { user } = useAuth();
  const [state, setState] = useState<LibraryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [forking, setForking] = useState<Graph | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const client = pb as unknown as TypedPocketBase;
      const graphMutator = new GraphMutator(client);

      const published = await graphMutator.listPublic();
      const graphs = published.items;
      const ids = graphs.map((graph) => graph.id);

      // Three bulk queries rather than three per card. `listImporters` is not
      // used here for the same reason: it would be one request per graph.
      const [nodes, imports, importers] = await Promise.all([
        new GraphNodeMutator(client).listForGraphs(ids),
        new GraphImportMutator(client).listForParents(ids),
        new GraphImportMutator(client).listAllEdges(),
      ]);

      const stats: Record<string, LibraryStats> = {};
      for (const id of ids) {
        stats[id] = { nodes: 0, imports: 0, usedBy: 0, kinds: [] };
      }

      const kindsByGraph = new Map<string, Set<string>>();
      for (const node of nodes) {
        const entry = stats[node.graph];
        if (!entry) continue;
        entry.nodes++;

        let kinds = kindsByGraph.get(node.graph);
        if (!kinds) {
          kinds = new Set();
          kindsByGraph.set(node.graph, kinds);
        }
        for (const port of node.ports ?? []) kinds.add(port.kind);
      }
      for (const [graphId, kinds] of kindsByGraph) {
        if (stats[graphId]) stats[graphId].kinds = [...kinds].sort();
      }

      for (const record of imports) {
        if (stats[record.parent]) stats[record.parent].imports++;
      }
      for (const edge of importers) {
        if (stats[edge.child]) stats[edge.child].usedBy++;
      }

      if (!cancelled) setState({ graphs, stats });
    };

    load().catch((cause: unknown) => {
      console.error('Failed to load the library', cause);
      if (!cancelled) setError('The library could not be loaded.');
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

  const kinds = useMemo(() => {
    const all = new Set<string>();
    for (const entry of Object.values(state?.stats ?? {})) {
      for (const kind of entry.kinds) all.add(kind);
    }
    return [...all].sort();
  }, [state]);

  // Filtering in memory, not on the server. The published set is small, and a
  // tag lives in a JSON array PocketBase can only match by substring — so
  // `power` would also match `powerwall`. Exact here, imprecise there.
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();

    return (state?.graphs ?? [])
      .filter((graph) => {
        if (activeTag && !graph.tags?.includes(activeTag)) return false;
        if (activeKind && !state?.stats[graph.id]?.kinds.includes(activeKind)) {
          return false;
        }
        if (!needle) return true;

        return [graph.label, graph.name, graph.uid, graph.description]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle));
      })
      .sort(
        (left, right) =>
          (state?.stats[right.id]?.usedBy ?? 0) -
            (state?.stats[left.id]?.usedBy ?? 0) ||
          left.label.localeCompare(right.label)
      );
  }, [state, text, activeTag, activeKind]);

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }

  if (!state) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search published graphs"
          className="pl-9"
          aria-label="Search published graphs"
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Tags</span>
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

      {kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Ports</span>
          {kinds.map((kind) => (
            <Button
              key={kind}
              variant={activeKind === kind ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setActiveKind(activeKind === kind ? null : kind)}
            >
              {kind}
            </Button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing published matches that. A graph appears here once its
          visibility is set to <code className="font-mono">public</code>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((graph) => (
            <LibraryCard
              key={graph.id}
              graph={graph}
              stats={state.stats[graph.id]}
              isOwn={graph.owner === user?.id}
              onFork={() => setForking(graph)}
            />
          ))}
        </div>
      )}

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

export default function LibraryPage() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto space-y-6 px-4 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">
            Everything published by anyone. Fork one into a workspace of your
            own, or import it directly and keep taking its changes.
          </p>
        </div>

        <Library />
      </div>
    </ProtectedRoute>
  );
}
