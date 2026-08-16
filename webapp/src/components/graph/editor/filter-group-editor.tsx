'use client';

import { Plus, Trash2 } from 'lucide-react';
import {
  COMPARISON_OPERATORS,
  LOGICAL_OPERATORS,
  ORDERING_OPERATORS,
  type ComparisonOperator,
  type FilterCondition,
  type FilterGroup,
} from '@project/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
};

const BLANK_CONDITION: FilterCondition = {
  attribute: '',
  value: '',
  operator: 'eq',
};

interface FilterGroupEditorProps {
  value: FilterGroup | undefined;
  onChange: (next: FilterGroup | undefined) => void;
  /**
   * Attribute names seen elsewhere in the graph, offered as suggestions.
   * Suggestions only — a filter may legitimately name an attribute that no
   * current node has.
   */
  suggestions?: string[];
  disabled?: boolean;
  idPrefix: string;
}

/**
 * Build the filter on an input port's attribute.
 *
 * The thing this UI has to keep saying out loud: a condition names an
 * attribute on the **candidate source node**, not on the source port and not
 * on the port being edited. Every other reading of it is wrong, and the field
 * label is the only place a user finds that out.
 *
 * A filter belongs on an input port. The engine ignores one on an output.
 */
export function FilterGroupEditor({
  value,
  onChange,
  suggestions = [],
  disabled,
  idPrefix,
}: FilterGroupEditorProps) {
  const conditions = value?.conditions ?? [];
  const logicalOperator = value?.logicalOperator ?? 'AND';

  const emit = (next: Partial<FilterGroup>) => {
    const merged: FilterGroup = {
      logicalOperator,
      conditions,
      ...next,
    };
    // A group with no conditions passes everything, so store nothing rather
    // than a filter that reads as a constraint and is not one.
    onChange(merged.conditions.length ? merged : undefined);
  };

  const patch = (index: number, changes: Partial<FilterCondition>) => {
    emit({
      conditions: conditions.map((condition, position) =>
        position === index ? { ...condition, ...changes } : condition
      ),
    });
  };

  const listId = `${idPrefix}-attribute-suggestions`;
  const usesOrdering = conditions.some((condition) =>
    ORDERING_OPERATORS.includes(condition.operator)
  );

  if (!conditions.length) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => emit({ conditions: [{ ...BLANK_CONDITION }] })}
        disabled={disabled}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add a filter
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Connect only when</span>
        <Select
          value={logicalOperator}
          onValueChange={(next) =>
            emit({ logicalOperator: next as FilterGroup['logicalOperator'] })
          }
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-24" aria-label="Match type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOGICAL_OPERATORS.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operator === 'AND' ? 'all' : 'any'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium">of these hold:</span>
      </div>

      <p className="text-muted-foreground text-xs">
        Each condition reads an attribute on the <strong>source node</strong> —
        the component trying to connect — not on this port.
      </p>

      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {conditions.map((condition, index) => (
        <div
          key={index}
          // The operator select has a hard 160px floor in an `auto` column,
          // which overflowed a phone-width panel. Below `sm` the condition
          // stacks instead, with the remove button on its own row.
          className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto]"
        >
          <Input
            aria-label={`Condition ${index + 1} source attribute`}
            list={listId}
            value={condition.attribute}
            onChange={(event) =>
              patch(index, { attribute: event.target.value })
            }
            placeholder="voltage"
            disabled={disabled}
          />
          <Select
            value={condition.operator}
            onValueChange={(next) =>
              patch(index, { operator: next as ComparisonOperator })
            }
            disabled={disabled}
          >
            <SelectTrigger
              className="w-full sm:w-40"
              aria-label={`Condition ${index + 1} operator`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPARISON_OPERATORS.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={`Condition ${index + 1} value`}
            value={condition.value}
            onChange={(event) => patch(index, { value: event.target.value })}
            placeholder="12"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              emit({
                conditions: conditions.filter(
                  (_, position) => position !== index
                ),
              })
            }
            aria-label={`Remove condition ${index + 1}`}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {usesOrdering && (
        <p className="text-muted-foreground text-xs">
          Ordering comparisons need both sides to read as numbers. Against a
          non-numeric attribute they fail the condition rather than falling back
          to alphabetical order.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          emit({ conditions: [...conditions, { ...BLANK_CONDITION }] })
        }
        disabled={disabled || conditions.length >= 50}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add condition
      </Button>
    </div>
  );
}
