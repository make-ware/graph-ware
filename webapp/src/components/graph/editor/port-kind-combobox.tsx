'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { usePortKinds } from '@/hooks/use-port-kinds';
import { cn } from '@/lib/utils';

interface PortKindComboboxProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Pick a port kind, or type one that is not registered yet.
 *
 * The `PortKinds` registry is deliberately **not** a validation gate: a port
 * may name a kind with no row, and it still connects to ports of the same kind
 * — it just renders in the fallback colour and raises an `unknown-port-kind`
 * info diagnostic. So this accepts free text and warns rather than refusing.
 *
 * Typos in kinds are the most common way to get silently-missing wiring, and
 * the registry is the only thing that can spot one, which is why the warning
 * is here at all.
 */
export function PortKindCombobox({
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel = 'Port kind',
}: PortKindComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { registry, colorFor } = usePortKinds();

  const kinds = Object.keys(registry).sort();
  const isRegistered = value in registry;
  const trimmed = search.trim();

  const commit = (next: string) => {
    onChange(next);
    setSearch('');
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              {value && (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(value) }}
                />
              )}
              <span
                className={cn('truncate', !value && 'text-muted-foreground')}
              >
                {value || 'Select a kind'}
              </span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput
              placeholder="Search or type a new kind…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {trimmed ? (
                  <button
                    type="button"
                    className="w-full px-2 py-1.5 text-left text-sm"
                    onClick={() => commit(trimmed)}
                  >
                    Use “{trimmed}” — a kind with no registry entry
                  </button>
                ) : (
                  'No kinds found.'
                )}
              </CommandEmpty>
              <CommandGroup>
                {kinds.map((kind) => (
                  <CommandItem
                    key={kind}
                    value={kind}
                    onSelect={() => commit(kind)}
                  >
                    <span
                      aria-hidden
                      className="mr-2 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorFor(kind) }}
                    />
                    {kind}
                    <Check
                      className={cn(
                        'ml-auto h-4 w-4',
                        value === kind ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && !isRegistered && (
        <p className="text-muted-foreground flex items-start gap-1 text-xs">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Not in the port-kind registry. It will still connect to ports of the
          same kind, but check the spelling.
        </p>
      )}
    </div>
  );
}
