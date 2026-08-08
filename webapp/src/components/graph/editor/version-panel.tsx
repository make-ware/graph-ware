'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, RotateCcw, Tag } from 'lucide-react';
import { toast } from 'sonner';
import type { GraphVersion } from '@project/shared';
import { formatVersion, snapshotMatches } from '@project/shared';
import { GraphVersionMutator } from '@project/shared/mutators';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

/**
 * Publish a version, and put an old one back.
 *
 * A version is what a pinned import renders, so this panel is where "other
 * people depend on this" becomes visible: publishing is the act that gives
 * importers something stable to point at, and until a graph has one, every
 * importer necessarily follows its live state.
 */
export function VersionPanel() {
  const { graph, rootNodes, rootImports } = useGraphViewer();
  const { publishVersion, restoreVersion, isSaving } = useGraphEditor();

  const [versions, setVersions] = useState<GraphVersion[] | null>(null);
  const [note, setNote] = useState('');
  const [restoring, setRestoring] = useState<GraphVersion | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!graph) return;

    let cancelled = false;
    new GraphVersionMutator(pb as unknown as TypedPocketBase)
      .listForGraph(graph.id)
      .then((result) => {
        if (!cancelled) setVersions(result.items);
      })
      .catch((cause: unknown) => {
        console.error('Failed to load versions', cause);
        if (!cancelled) setVersions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [graph, reloadToken]);

  if (!graph) return null;

  const latest = versions?.[0] ?? null;
  // Whether "publish" would actually mint anything. Comparing the serialized
  // form, so an edit that saved without changing anything does not count.
  const unchanged =
    latest !== null &&
    snapshotMatches(latest.snapshot, graph, rootNodes, rootImports);

  const publish = async () => {
    try {
      const version = await publishVersion(note.trim() || undefined);
      toast.success(
        unchanged
          ? `Nothing has changed since ${formatVersion(version)}.`
          : `Published ${formatVersion(version)}.`
      );
      setNote('');
      reload();
    } catch (cause: unknown) {
      console.error('Publish failed', cause);
      toast.error('That version could not be published.');
    }
  };

  const restore = async (version: GraphVersion) => {
    try {
      await restoreVersion(version);
      toast.success(`Restored ${formatVersion(version)}.`, {
        description: 'The state you replaced was snapshotted first.',
      });
      setRestoring(null);
      reload();
    } catch (cause: unknown) {
      console.error('Restore failed', cause);
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'That version could not be restored.'
      );
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <History className="size-4" aria-hidden />
          Versions
        </h3>
        <p className="text-xs text-muted-foreground">
          A snapshot other graphs can pin to. Until one exists, everything
          importing this graph follows whatever you last saved.
        </p>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <Label htmlFor="version-note" className="text-xs">
          What changed?
        </Label>
        <Input
          id="version-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
          maxLength={500}
          disabled={isSaving}
        />
        <Button size="sm" onClick={publish} disabled={isSaving || unchanged}>
          {isSaving ? (
            <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
          ) : (
            <Tag className="mr-1 size-4" aria-hidden />
          )}
          Publish version
        </Button>
        {unchanged && (
          <p className="text-xs text-muted-foreground">
            Nothing has changed since {formatVersion(latest!)}.
          </p>
        )}
      </div>

      {versions === null ? (
        <Skeleton className="h-24 w-full" />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex items-start gap-2 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {formatVersion(version)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {version.created?.slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm">
                  {version.note || (
                    <span className="text-muted-foreground italic">
                      No note.
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {version.snapshot?.nodes?.length ?? 0} nodes,{' '}
                  {version.snapshot?.imports?.length ?? 0} imports
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRestoring(version)}
                disabled={isSaving}
              >
                <RotateCcw className="mr-1 size-3.5" aria-hidden />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {restoring ? formatVersion(restoring) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This replaces every node and import on this graph with the ones in
              that snapshot. The current state is snapshotted first, so it is
              recoverable — but anything added since{' '}
              {restoring ? formatVersion(restoring) : 'then'} disappears from
              the live graph.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => restoring && restore(restoring)}
              disabled={isSaving}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
