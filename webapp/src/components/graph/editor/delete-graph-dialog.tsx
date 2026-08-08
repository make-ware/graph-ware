'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Graph, GraphImport } from '@project/shared';
import { GraphImportMutator } from '@project/shared/mutators';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';

interface DeleteGraphDialogProps {
  graph: Graph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

/** A `GraphImports` row with its parent graph expanded. */
type ImporterRow = GraphImport & { expand?: { parent?: Graph } };

/**
 * Confirm deleting a graph, naming the graphs that import it.
 *
 * Both ends of `GraphImports` cascade, so deleting a graph silently empties a
 * subtree in every parent that used it — parents the user is very likely not
 * looking at. `cascadeDelete: false` was rejected upstream because it turns a
 * recoverable warning into a hard error with no way forward from inside the
 * app, which puts the burden of the warning here.
 *
 * When there are importers, deletion additionally requires typing the graph's
 * machine name. See docs/IMPORTS.md § Deleting a graph that others import.
 */
export function DeleteGraphDialog({
  graph,
  open,
  onOpenChange,
  onConfirm,
}: DeleteGraphDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/*
          Radix unmounts dialog content on close, so the body's state is seeded
          on mount and the impact check re-runs on every open — which matters,
          because another graph may have started importing this one since last
          time.
        */}
        <DeleteGraphBody
          graph={graph}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteGraphBody({
  graph,
  onCancel,
  onConfirm,
}: {
  graph: Graph;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [importers, setImporters] = useState<ImporterRow[] | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const client = pb as unknown as TypedPocketBase;
    new GraphImportMutator(client)
      .listImporters(graph.id)
      .then((result) => {
        if (cancelled) return;
        setImporters(result.items as ImporterRow[]);
      })
      .catch((cause: unknown) => {
        console.error('Could not check what imports this graph', cause);
        // An unknown blast radius is more dangerous than a known one, so fall
        // back to demanding the typed confirmation rather than waving it through.
        if (!cancelled) setImporters([]);
      });

    return () => {
      cancelled = true;
    };
  }, [graph.id]);

  const isLoading = importers === null;
  const hasImporters = Boolean(importers?.length);
  const confirmed = !hasImporters || confirmation === graph.name;

  const confirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {graph.label}?</AlertDialogTitle>
        <AlertDialogDescription>
          This deletes the graph and every node on it. It cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : hasImporters ? (
        <div className="space-y-3">
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p>
                {importers.length === 1
                  ? '1 graph imports this one'
                  : `${importers.length} graphs import this one`}
                . Deleting it removes those imports and empties the subtree
                wherever it appeared:
              </p>
              <ul className="list-inside list-disc space-y-0.5">
                {importers.map((row) => (
                  <li key={row.id}>
                    {row.expand?.parent?.label ?? 'A graph you cannot read'}
                    <span className="text-amber-700"> as {row.alias}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">
              Type <code className="font-mono">{graph.name}</code> to confirm
            </Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={isDeleting}
            />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing imports this graph.
        </p>
      )}

      <AlertDialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={isDeleting}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={confirm}
          disabled={isLoading || !confirmed || isDeleting}
        >
          {isDeleting ? 'Deleting…' : 'Delete graph'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
