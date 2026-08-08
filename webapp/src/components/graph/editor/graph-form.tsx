'use client';

import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import type { z } from 'zod';
import { GraphInputSchema, GRAPH_VISIBILITIES } from '@project/shared/schema';
import type { GraphInput } from '@project/shared/schema';
import {
  getFieldError,
  getToastMessage,
  parseAuthError,
  toMachineName,
} from '@project/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Fields the server reports errors against, in the order the form shows them. */
const FIELDS = [
  'uid',
  'name',
  'label',
  'namespace',
  'description',
  'visibility',
] as const;

const VISIBILITY_HELP: Record<(typeof GRAPH_VISIBILITIES)[number], string> = {
  private: 'Only you can see it. Nobody else can import it.',
  unlisted: 'Anyone with the link can view and import it.',
  public: 'Listed in the shared library.',
};

/**
 * What the fields hold, which is not what submit receives.
 *
 * `visibility` carries a zod `.default()`, so the schema's input type has it
 * optional while `GraphInput` — the output — has it required. Typing the form
 * on the input and the handler on the output is what reconciles the two.
 */
type GraphFormValues = z.input<typeof GraphInputSchema>;

interface GraphFormProps {
  defaultValues?: Partial<GraphInput>;
  submitLabel?: string;
  onSubmit: (input: GraphInput) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Create or edit a graph's metadata.
 *
 * `owner` is deliberately absent: `GraphMutator.create` injects it from the
 * auth store because the collection's create rule requires the field to equal
 * the caller, and a form-supplied one would only ever disagree.
 */
export function GraphForm({
  defaultValues,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: GraphFormProps) {
  const isEditing = Boolean(defaultValues?.uid);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GraphFormValues, unknown, GraphInput>({
    resolver: zodResolver(GraphInputSchema),
    defaultValues: {
      uid: '',
      name: '',
      label: '',
      namespace: '',
      description: '',
      visibility: 'private',
      tags: [],
      ...defaultValues,
    },
  });

  // The machine name follows the label until it is edited by hand. Editing an
  // existing graph never auto-fills: the name is already addressed by whatever
  // imports it, so silently rewriting it on a label tweak would be hostile.
  const [nameTouched, setNameTouched] = useState(isEditing);
  const [tagDraft, setTagDraft] = useState('');
  const tags = watch('tags') ?? [];
  const visibility = watch('visibility');

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value || tags.includes(value) || tags.length >= 20) {
      setTagDraft('');
      return;
    }
    setValue('tags', [...tags, value], { shouldDirty: true });
    setTagDraft('');
  };

  const removeTag = (tag: string) => {
    setValue(
      'tags',
      tags.filter((existing) => existing !== tag),
      { shouldDirty: true }
    );
  };

  const submit = async (data: GraphInput) => {
    try {
      await onSubmit(data);
    } catch (error: unknown) {
      console.error('Saving the graph failed:', error);

      let handled = false;
      for (const field of FIELDS) {
        const message = getFieldError(error, field);
        if (message) {
          setError(field, { type: 'manual', message });
          handled = true;
        }
      }

      if (!handled) {
        setError('root', {
          type: 'manual',
          message: parseAuthError(error).message,
        });
      }

      const toastMessage = getToastMessage(error, 'Saving the graph');
      toast.error(toastMessage.title, {
        description: toastMessage.description,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="label">Title</Label>
        <Input
          id="label"
          {...register('label', {
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              if (nameTouched) return;
              const derived = toMachineName(event.target.value);
              setValue('name', derived, { shouldValidate: false });
              if (!isEditing)
                setValue('uid', derived, { shouldValidate: false });
            },
          })}
          placeholder="Port Battery Bank"
          disabled={isSubmitting}
        />
        {errors.label && (
          <p className="text-sm text-red-600">{errors.label.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Machine name</Label>
          <Input
            id="name"
            {...register('name', { onChange: () => setNameTouched(true) })}
            placeholder="port_battery_bank"
            disabled={isSubmitting}
          />
          <p className="text-muted-foreground text-xs">
            Lowercase letters, numbers and underscores. Used for sorting and
            addressing.
          </p>
          {errors.name && (
            <p className="text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="uid">Reference key</Label>
          <Input
            id="uid"
            {...register('uid')}
            placeholder="BatterySystem"
            disabled={isSubmitting}
          />
          <p className="text-muted-foreground text-xs">
            The stable key this graph is exported and re-imported under.
          </p>
          {errors.uid && (
            <p className="text-sm text-red-600">{errors.uid.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="namespace">Namespace</Label>
          <Input
            id="namespace"
            {...register('namespace')}
            placeholder="boat"
            disabled={isSubmitting}
          />
          <p className="text-muted-foreground text-xs">
            Optional grouping label. Presentation only.
          </p>
          {errors.namespace && (
            <p className="text-sm text-red-600">{errors.namespace.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isSubmitting}
              >
                <SelectTrigger id="visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRAPH_VISIBILITIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-muted-foreground text-xs">
            {VISIBILITY_HELP[visibility ?? 'private']}
          </p>
          {errors.visibility && (
            <p className="text-sm text-red-600">{errors.visibility.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...register('description')}
          rows={3}
          placeholder="What this graph models."
          disabled={isSubmitting}
        />
        {errors.description && (
          <p className="text-sm text-red-600">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tag-draft">Tags</Label>
        <div className="flex gap-2">
          <Input
            id="tag-draft"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter inside a tag field means "add this tag", not "submit".
              event.preventDefault();
              addTag();
            }}
            placeholder="sample"
            disabled={isSubmitting || tags.length >= 20}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addTag}
            disabled={isSubmitting || !tagDraft.trim() || tags.length >= 20}
          >
            Add
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {errors.root && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {errors.root.message}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
