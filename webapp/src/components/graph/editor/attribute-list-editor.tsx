'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { Attribute } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AttributeListEditorProps {
  value: Attribute[];
  onChange: (next: Attribute[]) => void;
  disabled?: boolean;
  /** Shown when the list is empty, in place of the table head. */
  emptyHint?: string;
  idPrefix: string;
}

const BLANK: Attribute = { name: '', value: '', unit: '', kind: '' };

/**
 * Edit a node's (or a port's) attributes.
 *
 * Controlled rather than bound to react-hook-form: attributes nest three deep
 * on a port's filter conditions, and threading `Control` through that depth
 * buys nothing over an array in, an array out — which is also what makes this
 * renderable from a fixture in a test.
 *
 * Attribute values are always strings. The engine decides per comparison
 * whether to read one as a number, so there is no type to pick here.
 */
export function AttributeListEditor({
  value,
  onChange,
  disabled,
  emptyHint = 'No attributes yet.',
  idPrefix,
}: AttributeListEditorProps) {
  const patch = (index: number, changes: Partial<Attribute>) => {
    onChange(
      value.map((attribute, position) =>
        position === index ? { ...attribute, ...changes } : attribute
      )
    );
  };

  const remove = (index: number) => {
    onChange(value.filter((_, position) => position !== index));
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          <div className="text-muted-foreground grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs">
            <span>Name</span>
            <span>Value</span>
            <span>Unit</span>
            <span>Kind</span>
            <span className="w-8" />
          </div>
          {value.map((attribute, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2"
            >
              <Input
                aria-label={`Attribute ${index + 1} name`}
                id={`${idPrefix}-name-${index}`}
                value={attribute.name}
                onChange={(event) => patch(index, { name: event.target.value })}
                placeholder="voltage"
                disabled={disabled}
              />
              <Input
                aria-label={`Attribute ${index + 1} value`}
                value={attribute.value}
                onChange={(event) =>
                  patch(index, { value: event.target.value })
                }
                placeholder="12"
                disabled={disabled}
              />
              <Input
                aria-label={`Attribute ${index + 1} unit`}
                value={attribute.unit ?? ''}
                onChange={(event) => patch(index, { unit: event.target.value })}
                placeholder="volts"
                disabled={disabled}
              />
              <Input
                aria-label={`Attribute ${index + 1} kind`}
                value={attribute.kind}
                onChange={(event) => patch(index, { kind: event.target.value })}
                placeholder="power"
                disabled={disabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                aria-label={`Remove attribute ${index + 1}`}
                disabled={disabled}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { ...BLANK }])}
        disabled={disabled || value.length >= 100}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add attribute
      </Button>
    </div>
  );
}

export { BLANK as BLANK_ATTRIBUTE };
