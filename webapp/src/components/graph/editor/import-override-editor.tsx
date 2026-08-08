'use client';

import { useMemo, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AttributeOverrideMap,
  FlatNode,
  GraphImport,
} from '@project/shared';
import { buildInstanceId, formatInstancePath } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { useGraphViewer } from '@/hooks/use-graph-viewer';

/** A node inside this import, addressed the way the override map addresses it. */
interface Addressable {
  /** `buildInstanceId(pathBelowTheImport, nodeId)` — the override map's key. */
  key: string;
  node: FlatNode;
}

/**
 * Set attribute values for one instance of an imported graph.
 *
 * This is what lets `starboard_bank` run at 24 V while `port_bank` — the same
 * `BatterySystem` record — stays at 12 V, without forking the child. The
 * override is stored on the *import*, so it belongs to this instance and to
 * nothing else.
 *
 * The values are applied during flatten, **before** auto-connect, so an
 * overridden attribute is what input-port filters are evaluated against: a
 * voltage override changes the wiring, not just the label. That is worth
 * knowing before you set one, so the panel says it.
 */
export function ImportOverrideEditor({
  row,
  disabled,
}: {
  row: GraphImport;
  disabled: boolean;
}) {
  const { view } = useGraphViewer();
  const { setImportOverrides } = useGraphEditor();

  const [nodeKey, setNodeKey] = useState('');
  const [attribute, setAttribute] = useState('');
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Everything the resolver placed under this alias, keyed relative to the
  // import — so a grandchild's node is addressable as `cells/NODEID`, exactly
  // as `AttributeOverrideMapSchema` describes.
  const addressable = useMemo<Addressable[]>(
    () =>
      view.nodes
        .filter((node) => node.instancePath[0] === row.alias)
        .map((node) => ({
          key: buildInstanceId(node.instancePath.slice(1), node.nodeId),
          node,
        })),
    [view.nodes, row.alias]
  );

  const byKey = useMemo(
    () => new Map(addressable.map((entry) => [entry.key, entry])),
    [addressable]
  );

  const overrides: AttributeOverrideMap = row.attributeOverrides ?? {};
  const entries = Object.entries(overrides);

  const selected = byKey.get(nodeKey);
  // The engine only ever *replaces* an existing attribute, so the picker offers
  // the ones that exist rather than a free-text box that would silently do
  // nothing. Note these are the already-overridden values, which is what makes
  // editing an override show its current effect.
  const attributes = selected?.node.attributes ?? [];

  const commit = async (next: AttributeOverrideMap) => {
    setIsSaving(true);
    try {
      await setImportOverrides(row.id, next);
    } catch (cause: unknown) {
      console.error('Attribute override failed', cause);
      toast.error('That override could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const add = async () => {
    if (!nodeKey || !attribute) return;

    const next: AttributeOverrideMap = {
      ...overrides,
      [nodeKey]: { ...(overrides[nodeKey] ?? {}), [attribute]: value },
    };

    await commit(next);
    setValue('');
    toast.success(`${attribute} overridden for this instance.`);
  };

  const remove = async (key: string, name: string) => {
    const patch = { ...(overrides[key] ?? {}) };
    delete patch[name];

    const next = { ...overrides };
    if (Object.keys(patch).length) next[key] = patch;
    else delete next[key];

    await commit(next);
  };

  return (
    <div className="space-y-2">
      <div>
        <h4 className="flex items-center gap-1.5 text-xs font-medium">
          <SlidersHorizontal className="size-3.5" aria-hidden />
          Attribute overrides
        </h4>
        <p className="text-xs text-muted-foreground">
          Values that apply to this instance only. They are applied before
          connections are derived, so an override can change the wiring.
        </p>
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.flatMap(([key, patch]) =>
            Object.entries(patch).map(([name, overrideValue]) => {
              const target = byKey.get(key);
              return (
                <li
                  key={`${key}#${name}`}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">
                      {target?.node.label ?? key}
                    </span>
                    {target && target.node.instancePath.length > 1 && (
                      <span className="text-muted-foreground">
                        {' '}
                        in{' '}
                        {formatInstancePath(target.node.instancePath.slice(1))}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {' · '}
                      {name} = {overrideValue}
                    </span>
                  </span>

                  {!target && (
                    <Badge variant="outline" className="text-[10px]">
                      no such node
                    </Badge>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={disabled || isSaving}
                    onClick={() => remove(key, name)}
                    aria-label={`Remove the ${name} override`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              );
            })
          )}
        </ul>
      )}

      {addressable.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing to override — this import resolves to no nodes.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`override-node-${row.id}`}>
              Node
            </Label>
            <Select
              value={nodeKey}
              onValueChange={(next) => {
                setNodeKey(next);
                setAttribute('');
              }}
              disabled={disabled || isSaving}
            >
              <SelectTrigger id={`override-node-${row.id}`} className="h-8">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {addressable.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.node.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`override-attr-${row.id}`}>
              Attribute
            </Label>
            <Select
              value={attribute}
              onValueChange={setAttribute}
              disabled={disabled || isSaving || !selected}
            >
              <SelectTrigger id={`override-attr-${row.id}`} className="h-8">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {attributes.map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`override-value-${row.id}`}>
              Value
            </Label>
            <Input
              id={`override-value-${row.id}`}
              className="h-8"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={disabled || isSaving || !attribute}
              maxLength={500}
            />
          </div>

          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={add}
            disabled={disabled || isSaving || !nodeKey || !attribute}
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Set
          </Button>
        </div>
      )}
    </div>
  );
}
