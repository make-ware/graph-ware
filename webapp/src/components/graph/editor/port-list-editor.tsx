'use client';

import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  PORT_DIRECTIONS,
  PORT_RELATIONSHIPS,
  DEFAULT_PORT_RELATIONSHIP,
  type Port,
  type PortAttribute,
  type PortDirection,
  type PortRelationship,
} from '@project/shared';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FilterGroupEditor } from './filter-group-editor';
import { PortKindCombobox } from './port-kind-combobox';

const BLANK_PORT: Port = {
  name: '',
  direction: 'input',
  kind: '',
  relationship: DEFAULT_PORT_RELATIONSHIP,
};

const RELATIONSHIP_HELP: Record<
  PortDirection,
  Record<PortRelationship, string>
> = {
  output: {
    one: 'Stops after one connection.',
    many: 'Connects to every match.',
  },
  input: {
    one: 'Claimed by its first connection.',
    many: 'Accepts any number of connections.',
  },
};

interface PortListEditorProps {
  value: Port[];
  onChange: (next: Port[]) => void;
  /** Attribute names elsewhere in the graph, for filter suggestions. */
  suggestions?: string[];
  disabled?: boolean;
}

/**
 * Edit a node's ports — the only place wiring is decided.
 *
 * There is no "connect" gesture anywhere in the app: an output reaches an
 * input when the kinds are compatible, both relationship budgets have room,
 * and the input's attribute filters pass against the source node. Editing that
 * here is how you draw an edge.
 *
 * Names are unique per direction, not per node, so a node may declare `supply`
 * as both an input and an output — which is exactly how a fuse is modelled.
 */
export function PortListEditor({
  value,
  onChange,
  suggestions = [],
  disabled,
}: PortListEditorProps) {
  const patch = (index: number, changes: Partial<Port>) => {
    onChange(
      value.map((port, position) =>
        position === index ? { ...port, ...changes } : port
      )
    );
  };

  const patchAttributes = (index: number, attributes: PortAttribute[]) => {
    patch(index, { attributes: attributes.length ? attributes : undefined });
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No ports yet. A node with no ports can never connect to anything.
        </p>
      )}

      {value.map((port, index) => {
        const relationship = port.relationship ?? DEFAULT_PORT_RELATIONSHIP;
        const attributes = port.attributes ?? [];

        return (
          <div key={index} className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <Badge
                variant={port.direction === 'output' ? 'default' : 'secondary'}
              >
                {port.direction}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
                aria-label={`Remove port ${index + 1}`}
                disabled={disabled}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`port-${index}-name`}>Name</Label>
                <Input
                  id={`port-${index}-name`}
                  value={port.name}
                  onChange={(event) =>
                    patch(index, { name: event.target.value })
                  }
                  placeholder="supply"
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`port-${index}-direction`}>Direction</Label>
                <Select
                  value={port.direction}
                  onValueChange={(next) =>
                    patch(index, { direction: next as PortDirection })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={`port-${index}-direction`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PORT_DIRECTIONS.map((direction) => (
                      <SelectItem key={direction} value={direction}>
                        {direction}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Kind</Label>
                <PortKindCombobox
                  value={port.kind}
                  onChange={(kind) => patch(index, { kind })}
                  disabled={disabled}
                  aria-label={`Port ${index + 1} kind`}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`port-${index}-relationship`}>
                  Connections
                </Label>
                <Select
                  value={relationship}
                  onValueChange={(next) =>
                    patch(index, { relationship: next as PortRelationship })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={`port-${index}-relationship`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PORT_RELATIONSHIPS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {RELATIONSHIP_HELP[port.direction][relationship]}
                </p>
              </div>
            </div>

            {port.direction === 'input' && (
              <div className="flex items-center gap-2">
                <Switch
                  id={`port-${index}-required`}
                  checked={port.isRequired ?? false}
                  onCheckedChange={(checked) =>
                    patch(index, { isRequired: checked || undefined })
                  }
                  disabled={disabled}
                />
                <Label
                  htmlFor={`port-${index}-required`}
                  className="cursor-pointer font-normal"
                >
                  Required — report an error when nothing connects here
                </Label>
              </div>
            )}

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                >
                  <ChevronDown className="h-4 w-4" />
                  Port attributes
                  {attributes.length > 0 && (
                    <Badge variant="secondary">{attributes.length}</Badge>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <PortAttributeEditor
                  portIndex={index}
                  direction={port.direction}
                  value={attributes}
                  onChange={(next) => patchAttributes(index, next)}
                  suggestions={suggestions}
                  disabled={disabled}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { ...BLANK_PORT }])}
        disabled={disabled || value.length >= 100}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add port
      </Button>
    </div>
  );
}

/**
 * A port's own attributes, each optionally carrying a filter.
 *
 * Kept separate from `AttributeListEditor` because a port attribute is an
 * attribute *plus* a filter, and the filter is the reason anyone opens this
 * section at all — it wants the room.
 */
function PortAttributeEditor({
  portIndex,
  direction,
  value,
  onChange,
  suggestions,
  disabled,
}: {
  portIndex: number;
  direction: PortDirection;
  value: PortAttribute[];
  onChange: (next: PortAttribute[]) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  const patch = (index: number, changes: Partial<PortAttribute>) => {
    onChange(
      value.map((attribute, position) =>
        position === index ? { ...attribute, ...changes } : attribute
      )
    );
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No port attributes. Add one to attach a filter.
        </p>
      )}

      {value.map((attribute, index) => (
        <div
          key={index}
          className="space-y-2 rounded-md border border-dashed p-3"
        >
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
            <Input
              aria-label={`Port ${portIndex + 1} attribute ${index + 1} name`}
              value={attribute.name}
              onChange={(event) => patch(index, { name: event.target.value })}
              placeholder="voltage"
              disabled={disabled}
            />
            <Input
              aria-label={`Port ${portIndex + 1} attribute ${index + 1} value`}
              value={attribute.value}
              onChange={(event) => patch(index, { value: event.target.value })}
              placeholder="12"
              disabled={disabled}
            />
            <Input
              aria-label={`Port ${portIndex + 1} attribute ${index + 1} unit`}
              value={attribute.unit ?? ''}
              onChange={(event) => patch(index, { unit: event.target.value })}
              placeholder="volts"
              disabled={disabled}
            />
            <Input
              aria-label={`Port ${portIndex + 1} attribute ${index + 1} kind`}
              value={attribute.kind}
              onChange={(event) => patch(index, { kind: event.target.value })}
              placeholder="power"
              disabled={disabled}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
              aria-label={`Remove port ${portIndex + 1} attribute ${index + 1}`}
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {direction === 'input' ? (
            <FilterGroupEditor
              value={attribute.filter}
              onChange={(filter) => patch(index, { filter })}
              suggestions={suggestions}
              disabled={disabled}
              idPrefix={`port-${portIndex}-attribute-${index}`}
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              Filters apply to input ports only. The engine ignores one here.
            </p>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...value, { name: '', value: '', unit: '', kind: '' }])
        }
        disabled={disabled || value.length >= 50}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add port attribute
      </Button>
    </div>
  );
}
