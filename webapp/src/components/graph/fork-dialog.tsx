'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitFork, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Graph } from '@project/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cloneGraph } from '@project/shared/graph';
import { useWorkspaces } from '@/hooks/use-workspaces';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

interface ForkDialogProps {
  graph: Graph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Copy a graph into a workspace you can write.
 *
 * The two modes differ in what the copy *depends on*, and the wording says so
 * rather than leaving "deep" to be inferred:
 *
 * - shallow — copies this graph; its imports keep pointing at the originals, so
 *   the copy still moves when they do;
 * - deep — copies the whole subtree, so the copy is self-contained.
 *
 * Both are copies, and copies drift. There is no merge and no sync back to the
 * original, which the dialog states out loud because "fork" carries a
 * git-shaped expectation that this model does not meet.
 */
export function ForkDialog({ graph, open, onOpenChange }: ForkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/*
          The body unmounts on close, so every field re-seeds from props on the
          next open. Same trick the import manager's alias editor uses, and it
          is why none of this needs an effect to reset itself.
        */}
        <ForkDialogBody graph={graph} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function ForkDialogBody({
  graph,
  onOpenChange,
}: {
  graph: Graph;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { memberships, active } = useWorkspaces();

  const writable = memberships.filter((row) => row.role !== 'viewer');

  const [workspace, setWorkspace] = useState(
    () =>
      (active && writable.some((row) => row.workspace.id === active.id)
        ? active.id
        : writable[0]?.workspace.id) ?? ''
  );
  const [label, setLabel] = useState(`${graph.label} (fork)`);
  const [deep, setDeep] = useState(false);
  const [isForking, setIsForking] = useState(false);

  const fork = async () => {
    if (!workspace) return;

    setIsForking(true);
    try {
      const result = await cloneGraph(
        pb as unknown as TypedPocketBase,
        graph.id,
        {
          workspace,
          deep,
          label: label.trim() || undefined,
        }
      );

      const copied = result.copies.size;
      toast.success(
        copied > 1
          ? `Forked ${copied} graphs into your workspace.`
          : 'Forked into your workspace.',
        {
          description: result.external.length
            ? `${result.external.length} import${result.external.length === 1 ? '' : 's'} still point at the original graphs.`
            : undefined,
        }
      );

      onOpenChange(false);
      router.push(`/graphs/${result.graph.id}/edit`);
    } catch (cause: unknown) {
      console.error('Fork failed', cause);
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'That graph could not be forked.'
      );
    } finally {
      setIsForking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fork {graph.label}</DialogTitle>
        <DialogDescription>
          A fork is a copy. It records where it came from, but there is no merge
          and no sync — the two drift apart from here.
        </DialogDescription>
      </DialogHeader>

      {writable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no workspace you can write to, so there is nowhere to put a
          fork.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fork-label">Name</Label>
            <Input
              id="fork-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fork-workspace">Workspace</Label>
            <Select value={workspace} onValueChange={setWorkspace}>
              <SelectTrigger id="fork-workspace">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {writable.map((row) => (
                  <SelectItem key={row.workspace.id} value={row.workspace.id}>
                    {row.workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fork-depth">What to copy</Label>
            <Select
              value={deep ? 'deep' : 'shallow'}
              onValueChange={(value) => setDeep(value === 'deep')}
            >
              <SelectTrigger id="fork-depth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shallow">
                  This graph only — its imports keep pointing at the originals
                </SelectItem>
                <SelectItem value="deep">
                  This graph and everything it imports — self-contained
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {deep
                ? 'A graph imported more than once is copied once, and every import is rewired to that copy.'
                : 'Cheaper, and you keep getting the original authors’ changes — including ones you did not want.'}
            </p>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isForking}
        >
          Cancel
        </Button>
        <Button onClick={fork} disabled={isForking || !workspace}>
          {isForking ? (
            <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
          ) : (
            <GitFork className="mr-1 size-4" aria-hidden />
          )}
          Fork
        </Button>
      </DialogFooter>
    </>
  );
}
