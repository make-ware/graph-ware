'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  AttributeListSchema,
  MACHINE_NAME_PATTERN,
  PortListSchema,
  toMachineName,
  type Attribute,
  type GraphNode,
  type Port,
} from '@project/shared';
import {
  getFieldError,
  getToastMessage,
  parseAuthError,
} from '@project/shared';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { AttributeListEditor } from './attribute-list-editor';
import { PortListEditor } from './port-list-editor';

/**
 * What the modal validates before writing.
 *
 * Mirrors `GraphNodeInputSchema` minus `graph`, which the editor context
 * supplies — the form has no business naming the graph it belongs to.
 */
const NodeDraftSchema = z.object({
  name: z
    .string()
    .min(1, 'A machine name is required')
    .max(100)
    .regex(MACHINE_NAME_PATTERN, 'Use lowercase letters, numbers, underscores'),
  label: z.string().min(1, 'A label is required').max(200),
  attributes: AttributeListSchema,
  ports: PortListSchema,
});

interface NodeDraft {
  name: string;
  label: string;
  attributes: Attribute[];
  ports: Port[];
}

const EMPTY_DRAFT: NodeDraft = {
  name: '',
  label: '',
  attributes: [],
  ports: [],
};

interface NodeEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The node being edited, or `null` to create a new one. */
  node: GraphNode | null;
  /** Attribute names elsewhere in the graph, for filter suggestions. */
  suggestions?: string[];
}

/**
 * Create or edit a node, its attributes and its ports.
 *
 * Everything here saves in **one** write. Attributes and ports are JSON on the
 * `GraphNodes` record rather than collections of their own, so a per-port save
 * would be a partial record update pretending to be granular — and would make
 * a node edit non-atomic for no benefit.
 *
 * Not built on react-hook-form: the interesting state is two nested arrays,
 * which `useFieldArray` addresses through generated path strings three levels
 * deep. A plain draft object with zod validation on submit is less machinery
 * for the same guarantees.
 */
export function NodeEditorModal({
  open,
  onOpenChange,
  node,
  suggestions = [],
}: NodeEditorModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/*
          The body is a separate component so its state is seeded on mount
          rather than re-synced by an effect. Radix unmounts dialog content when
          it closes, so every open starts from the record as it stands, and a
          cancelled edit cannot leak into the next one. The key covers the case
          where the dialog stays open while the target node changes.
        */}
        <NodeEditorBody
          key={node?.id ?? 'new'}
          node={node}
          suggestions={suggestions}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NodeEditorBody({
  node,
  suggestions,
  onDone,
}: {
  node: GraphNode | null;
  suggestions: string[];
  onDone: () => void;
}) {
  const { createNode, saveNode, isSaving } = useGraphEditor();

  const [draft, setDraft] = useState<NodeDraft>(() =>
    node
      ? {
          name: node.name,
          label: node.label,
          attributes: node.attributes ?? [],
          ports: node.ports ?? [],
        }
      : EMPTY_DRAFT
  );
  // An existing node's name is already what imports and overrides address, so
  // it never follows the label.
  const [nameTouched, setNameTouched] = useState(Boolean(node));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const patch = (changes: Partial<NodeDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const portSummary = useMemo(() => {
    const inputs = draft.ports.filter((port) => port.direction === 'input');
    return {
      inputs: inputs.length,
      outputs: draft.ports.length - inputs.length,
    };
  }, [draft.ports]);

  const submit = async () => {
    const parsed = NodeDraftSchema.safeParse(draft);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'root';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});

    try {
      if (node) {
        await saveNode(node.id, parsed.data);
        toast.success(`Saved ${parsed.data.label}`);
      } else {
        await createNode(parsed.data);
        toast.success(`Added ${parsed.data.label}`);
      }
      onDone();
    } catch (error: unknown) {
      console.error('Saving the node failed:', error);

      const next: Record<string, string> = {};
      for (const field of ['name', 'label', 'attributes', 'ports'] as const) {
        const message = getFieldError(error, field);
        if (message) next[field] = message;
      }
      if (!Object.keys(next).length) {
        next.root = parseAuthError(error).message;
      }
      setErrors(next);

      const toastMessage = getToastMessage(error, 'Saving the node');
      toast.error(toastMessage.title, {
        description: toastMessage.description,
      });
    }
  };

  // Issues inside the arrays are reported against their path, which is too deep
  // to render beside the offending input — surface them as a list instead.
  const nestedIssues = Object.entries(errors).filter(
    ([key]) => key.startsWith('ports.') || key.startsWith('attributes.')
  );

  return (
    <>
      <DialogHeader className="border-b p-6 pb-4">
        <DialogTitle>{node ? 'Edit node' : 'New node'}</DialogTitle>
        <DialogDescription>
          Ports decide the wiring. Everything on this dialog saves together.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <div className="px-6 pt-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="attributes" className="gap-1.5">
              Attributes
              {draft.attributes.length > 0 && (
                <Badge variant="secondary">{draft.attributes.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ports" className="gap-1.5">
              Ports
              {draft.ports.length > 0 && (
                <Badge variant="secondary">
                  {portSummary.inputs} in / {portSummary.outputs} out
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="h-[55vh]">
          <div className="p-6 pt-4">
            <TabsContent value="details" className="mt-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="node-label">Label</Label>
                <Input
                  id="node-label"
                  value={draft.label}
                  onChange={(event) => {
                    const label = event.target.value;
                    patch(
                      nameTouched
                        ? { label }
                        : { label, name: toMachineName(label) }
                    );
                  }}
                  placeholder="House Battery 1"
                  disabled={isSaving}
                />
                {errors.label && (
                  <p className="text-sm text-red-600">{errors.label}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-name">Machine name</Label>
                <Input
                  id="node-name"
                  value={draft.name}
                  onChange={(event) => {
                    setNameTouched(true);
                    patch({ name: event.target.value });
                  }}
                  placeholder="house_battery_1"
                  disabled={isSaving}
                />
                <p className="text-muted-foreground text-xs">
                  Unique within the graph. Also the tie-breaker when two outputs
                  compete for the same input — matching runs in name order.
                </p>
                {errors.name && (
                  <p className="text-sm text-red-600">{errors.name}</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="attributes" className="mt-0 space-y-3">
              <p className="text-muted-foreground text-sm">
                Attributes describe the node. Input-port filters on other nodes
                read these to decide whether to accept a connection from it.
              </p>
              <AttributeListEditor
                value={draft.attributes}
                onChange={(attributes) => patch({ attributes })}
                disabled={isSaving}
                idPrefix="node-attribute"
              />
            </TabsContent>

            <TabsContent value="ports" className="mt-0">
              <PortListEditor
                value={draft.ports}
                onChange={(ports) => patch({ ports })}
                suggestions={suggestions}
                disabled={isSaving}
              />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      <DialogFooter className="flex-col gap-3 border-t p-6 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          {errors.root && <p className="text-sm text-red-600">{errors.root}</p>}
          {nestedIssues.map(([key, message]) => (
            <p key={key} className="text-sm text-red-600">
              <code className="font-mono text-xs">{key}</code> — {message}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onDone}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save node'}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
