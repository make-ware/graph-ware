'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { Graph, GraphImport, ImportEdge } from '@project/shared';
import {
  checkImport,
  isValidAlias,
  nextAvailableAlias,
  toMachineName,
} from '@project/shared';
import { GraphImportMutator, GraphMutator } from '@project/shared/mutators';
import { ImportOverrideEditor } from '@/components/graph/editor/import-override-editor';
import { ImportVersionPicker } from '@/components/graph/editor/import-version-picker';
import { Badge } from '@/components/ui/badge';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Add, arrange and remove the graphs this one imports.
 *
 * The alias is the load-bearing field here, and the UI has to say so: it is
 * what makes the *same* child importable twice, and it is baked verbatim into
 * every instance path — including the endpoints stored on every override. A
 * user who thinks of it as a nickname will be surprised later.
 */
export function ImportManager() {
  const { graph, rootImports, graphsById } = useGraphViewer();
  const { addImport, updateImport, removeImport, moveImport, isSaving } =
    useGraphEditor();

  const [pickerOpen, setPickerOpen] = useState(false);

  const ordered = useMemo(
    () => [...rootImports].sort((a, b) => a.order - b.order),
    [rootImports]
  );

  if (!graph) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Imported graphs</h3>
          <p className="text-muted-foreground text-xs">
            Each import appears in the tree under its alias.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setPickerOpen(true)}
          disabled={isSaving}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      {ordered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This graph imports nothing yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((row, index) => (
            <ImportRow
              key={row.id}
              row={row}
              child={graphsById.get(row.child)}
              isFirst={index === 0}
              isLast={index === ordered.length - 1}
              disabled={isSaving}
              onToggle={(enabled) => updateImport(row.id, { enabled })}
              onLabel={(label) => updateImport(row.id, { label })}
              onMove={(direction) => moveImport(row.id, direction)}
              onRemove={() => removeImport(row.id)}
            />
          ))}
        </ul>
      )}

      <ImportPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        parent={graph}
        takenAliases={ordered.map((row) => row.alias)}
        onPick={async (child) => {
          await addImport(child.id);
          toast.success(`Imported ${child.label}`);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One import
// ---------------------------------------------------------------------------

function ImportRow({
  row,
  child,
  isFirst,
  isLast,
  disabled,
  onToggle,
  onLabel,
  onMove,
  onRemove,
}: {
  row: GraphImport;
  child: Graph | undefined;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onLabel: (label: string) => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  return (
    <li
      className={cn(
        'space-y-2 rounded-md border p-3',
        !row.enabled && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
              {row.alias}
            </code>
            {!row.enabled && <Badge variant="outline">disabled</Badge>}
            {row.version && <Badge variant="secondary">pinned</Badge>}
            {row.attributeOverrides &&
              Object.keys(row.attributeOverrides).length > 0 && (
                <Badge variant="secondary">overridden</Badge>
              )}
          </div>
          <p className="text-muted-foreground mt-1 truncate text-sm">
            {child ? (
              <Link
                href={`/graphs/${child.id}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                {child.label}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              'A graph you can no longer read'
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={disabled || isFirst}
            aria-label={`Move ${row.alias} up`}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={disabled || isLast}
            aria-label={`Move ${row.alias} down`}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove import ${row.alias}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`import-${row.id}-label`} className="text-xs">
            Display label
          </Label>
          {/*
            Uncontrolled, committed on blur. Mirroring the record into local
            state would need an effect to re-sync when realtime delivers
            somebody else's edit; `key` remounts the input with the new value
            instead, which is the same result without the extra render pass.
          */}
          <Input
            key={row.label ?? ''}
            id={`import-${row.id}-label`}
            defaultValue={row.label ?? ''}
            onBlur={(event) => {
              const next = event.target.value;
              if (next !== (row.label ?? '')) void onLabel(next);
            }}
            placeholder={child?.label ?? 'Label'}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center gap-2 pb-2">
          <Switch
            id={`import-${row.id}-enabled`}
            checked={row.enabled ?? false}
            onCheckedChange={(checked) => void onToggle(checked)}
            disabled={disabled}
          />
          <Label
            htmlFor={`import-${row.id}-enabled`}
            className="cursor-pointer text-xs font-normal"
          >
            Enabled
          </Label>
        </div>
      </div>

      <ImportVersionPicker row={row} disabled={disabled} />

      <ImportOverrideEditor row={row} disabled={disabled} />

      <AliasEditor row={row} disabled={disabled} />
    </li>
  );
}

/**
 * Rename an import's alias, rewriting the overrides that named the old one.
 *
 * Every `GraphEdgeOverride` beneath the alias stores it verbatim inside
 * `sourcePath` / `targetPath`, so a rename would otherwise turn each of them
 * into a `stale-override` warning. The rewrite is not atomic — PocketBase has
 * no multi-record transaction — so the count is shown up front and the
 * override panel's stale detection remains the backstop.
 */
function AliasEditor({
  row,
  disabled,
}: {
  row: GraphImport;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Rename alias
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {/* Content unmounts on close, so the field re-seeds from the record. */}
          <AliasEditorBody row={row} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AliasEditorBody({
  row,
  onDone,
}: {
  row: GraphImport;
  onDone: () => void;
}) {
  const { renameAlias, aliasRenameImpact } = useGraphEditor();
  const [alias, setAlias] = useState(row.alias);
  const [isRenaming, setIsRenaming] = useState(false);

  const impact = aliasRenameImpact(row.alias);
  const valid = isValidAlias(alias);
  const changed = alias !== row.alias;

  const rename = async () => {
    setIsRenaming(true);
    try {
      await renameAlias(row.id, alias);
      toast.success(
        impact.affected.length
          ? `Renamed to ${alias} and updated ${impact.affected.length} override${
              impact.affected.length === 1 ? '' : 's'
            }`
          : `Renamed to ${alias}`
      );
      onDone();
    } catch (error: unknown) {
      console.error('Renaming the alias failed:', error);
      toast.error('Could not rename the alias', {
        description:
          error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename {row.alias}</DialogTitle>
        <DialogDescription>
          The alias identifies this instance of the child graph. It is part of
          the address of every node inside it.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor={`alias-${row.id}`}>Alias</Label>
        <Input
          id={`alias-${row.id}`}
          value={alias}
          onChange={(event) => setAlias(toMachineName(event.target.value))}
          disabled={isRenaming}
        />
        {!valid && (
          <p className="text-sm text-red-600">
            Use lowercase letters, numbers and underscores, up to 40 characters.
          </p>
        )}
      </div>

      {impact.affected.length > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {impact.affected.length} connection override
            {impact.affected.length === 1 ? '' : 's'} point inside this import.
            They will be rewritten to the new alias in the same operation.
          </p>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={isRenaming}>
          Cancel
        </Button>
        <Button onClick={rename} disabled={!valid || !changed || isRenaming}>
          {isRenaming ? 'Renaming…' : 'Rename'}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

interface Candidate {
  graph: Graph;
  /** `null` when the import is legal. */
  rejection: string | null;
}

/**
 * Choose a graph to import, with the ineligible ones disabled and explained.
 *
 * The check runs over **every** import edge the user can see, not just this
 * subtree: an import can close a loop through a branch that is not on screen.
 * The authoritative guard is the PocketBase hook — this exists so the answer
 * arrives before the click, with a reason attached.
 */
function ImportPicker({
  open,
  onOpenChange,
  parent,
  takenAliases,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: Graph;
  takenAliases: string[];
  onPick: (child: Graph) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/*
          Content unmounts on close, so the eligibility check re-runs on every
          open. That is what keeps it honest: an import added since last time
          can make a graph that was offerable into a cycle.
        */}
        <ImportPickerBody
          parent={parent}
          takenAliases={takenAliases}
          onPick={onPick}
        />
      </DialogContent>
    </Dialog>
  );
}

function ImportPickerBody({
  parent,
  takenAliases,
  onPick,
}: {
  parent: Graph;
  takenAliases: string[];
  onPick: (child: Graph) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = pb as unknown as TypedPocketBase;
    const graphs = new GraphMutator(client);
    const imports = new GraphImportMutator(client);

    const [mine, published, edges] = await Promise.all([
      graphs.listMine(),
      graphs.listPublic(),
      imports.listAllEdges(),
    ]);

    // A graph can be both mine and public; dedupe before checking.
    const unique = new Map<string, Graph>();
    for (const graph of [...mine.items, ...published.items]) {
      unique.set(graph.id, graph);
    }

    return [...unique.values()].map((graph) => ({
      graph,
      rejection: rejectionFor(parent.id, graph.id, edges),
    }));
  }, [parent.id]);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((result) => {
        if (!cancelled) setCandidates(result);
      })
      .catch((cause: unknown) => {
        console.error('Could not list importable graphs', cause);
        if (!cancelled) setCandidates([]);
      });

    return () => {
      cancelled = true;
    };
  }, [load]);

  const filtered = (candidates ?? []).filter((candidate) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      candidate.graph.label.toLowerCase().includes(needle) ||
      candidate.graph.name.toLowerCase().includes(needle) ||
      candidate.graph.uid.toLowerCase().includes(needle)
    );
  });

  const pick = async (candidate: Candidate) => {
    setPicking(candidate.graph.id);
    try {
      await onPick(candidate.graph);
    } catch (error: unknown) {
      console.error('Adding the import failed:', error);
      toast.error('Could not add that import', {
        description:
          error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setPicking(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import a graph</DialogTitle>
        <DialogDescription>
          Importing the same graph twice is supported — each instance gets its
          own alias, and they wire up independently.
        </DialogDescription>
      </DialogHeader>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search graphs…"
        aria-label="Search graphs"
      />

      <ScrollArea className="h-72">
        {candidates === null ? (
          <div className="space-y-2 pr-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No graphs match.
          </p>
        ) : (
          <ul className="space-y-2 pr-3">
            {filtered.map((candidate) => {
              // Mirrors what `addImport` will do, so the preview matches what
              // actually lands. A suffix means the base name was taken, which
              // is exactly the twice-imported case worth calling out.
              const base = toMachineName(
                candidate.graph.name || candidate.graph.uid
              );
              const alias = nextAvailableAlias(base, takenAliases);
              const isRepeat = alias !== base;
              const blocked = candidate.rejection !== null;

              return (
                <li key={candidate.graph.id}>
                  <button
                    type="button"
                    onClick={() => pick(candidate)}
                    disabled={blocked || picking !== null}
                    className={cn(
                      'w-full rounded-md border p-3 text-left transition-colors',
                      blocked
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:border-primary/50 hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {candidate.graph.label}
                      </span>
                      <Badge variant="outline">
                        {candidate.graph.visibility}
                      </Badge>
                    </div>
                    {blocked ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {candidate.rejection}
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Will be added as{' '}
                        <code className="font-mono">{alias}</code>
                        {isRepeat &&
                          ' — another instance of a graph already imported here'}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </>
  );
}

/** The reason this import is refused, or `null` when it is allowed. */
function rejectionFor(
  parentId: string,
  childId: string,
  edges: readonly ImportEdge[]
): string | null {
  const verdict = checkImport(parentId, childId, edges);
  return verdict.ok ? null : verdict.message;
}
