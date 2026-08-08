'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';
import type { GraphImport, GraphVersion } from '@project/shared';
import { formatVersion } from '@project/shared';
import { GraphVersionMutator } from '@project/shared/mutators';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

/** The sentinel `Select` value for "not pinned"; `Select` cannot hold `''`. */
const LIVE = '__live__';

/**
 * Pin one import to a version of the graph it names, or leave it live.
 *
 * Live is the default and stays the default. Pinning is what you do to a
 * dependency you need to stop moving; if it were the default, a library would
 * be a set of components frozen at whatever they happened to be when somebody
 * first used them, and nobody's fixes would ever reach anybody.
 *
 * The "newer versions available" line is the other half of that bargain: a pin
 * that quietly went stale would be indistinguishable from a pin that is still
 * current.
 */
export function ImportVersionPicker({
  row,
  disabled,
}: {
  row: GraphImport;
  disabled: boolean;
}) {
  const { pinImport } = useGraphEditor();

  const [versions, setVersions] = useState<GraphVersion[] | null>(null);
  const [isPinning, setIsPinning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    new GraphVersionMutator(pb as unknown as TypedPocketBase)
      .listForGraph(row.child)
      .then((result) => {
        if (!cancelled) setVersions(result.items);
      })
      .catch((cause: unknown) => {
        console.error('Failed to load versions for import', cause);
        if (!cancelled) setVersions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [row.child]);

  const pinned =
    versions?.find((version) => version.id === row.version) ?? null;

  // A pin whose version has vanished — deleted, or made unreadable. The
  // resolver falls back to live and says so; this says the same thing where the
  // pin is set, which is where it can be fixed.
  const dangling = Boolean(row.version) && versions !== null && !pinned;

  const newer = pinned
    ? (versions ?? []).filter((version) => version.version > pinned.version)
        .length
    : 0;

  const change = async (value: string) => {
    setIsPinning(true);
    try {
      await pinImport(row.id, value === LIVE ? null : value);
      toast.success(
        value === LIVE
          ? `${row.alias} follows the current graph again.`
          : `${row.alias} pinned.`
      );
    } catch (cause: unknown) {
      console.error('Pinning failed', cause);
      toast.error('That pin could not be changed.');
    } finally {
      setIsPinning(false);
    }
  };

  if (versions !== null && versions.length === 0 && !row.version) {
    return (
      <p className="text-xs text-muted-foreground">
        This graph has no published versions, so this import always resolves to
        its current state.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {row.version ? (
          <Pin className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <PinOff className="size-3.5 text-muted-foreground" aria-hidden />
        )}

        <Select
          value={row.version || LIVE}
          onValueChange={change}
          disabled={disabled || isPinning || versions === null}
        >
          <SelectTrigger
            className="h-8 w-56"
            aria-label={`Version pinned for ${row.alias}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LIVE}>Always current</SelectItem>
            {(versions ?? []).map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {formatVersion(version)}
                {version.note ? ` — ${version.note}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {newer > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {newer} newer version{newer === 1 ? '' : 's'} available
          </Badge>
        )}
      </div>

      {dangling && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          The pinned version can no longer be read; this import is resolving
          from the current graph.
        </p>
      )}

      {newer > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          disabled={disabled || isPinning}
          onClick={() => versions?.[0] && change(versions[0].id)}
        >
          Move to {versions?.[0] ? formatVersion(versions[0]) : 'the latest'}
        </Button>
      )}
    </div>
  );
}
