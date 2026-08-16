'use client';

import { useMemo, useState } from 'react';
import { Link2, Scissors, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { FlatNode, GraphEdgeOverride, Port } from '@project/shared';
import {
  formatInstancePath,
  indexByInstance,
  parseAuthError,
  parseInstanceId,
  portNameFromHandle,
  resolveOverrideEndpoints,
} from '@project/shared';
import { findEdge } from '@/lib/graph/flow-adapter';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { useGraphViewer } from '@/hooks/use-graph-viewer';

/** What a new override needs beyond its endpoints. */
interface PendingOverride {
  mode: 'pin' | 'suppress';
  sourcePath: string;
  sourcePort: string;
  targetPath: string;
  targetPort: string;
}

/**
 * Create and review the corrections to the derived wiring.
 *
 * An override is an admission that the rules do not express something, so it
 * carries friction on purpose: a reason is required, and the panel lists every
 * active one so they stay visible rather than becoming invisible local truth.
 * When the intent *can* be expressed — a port kind, a `compatibleWith` entry, a
 * filter — that is the better fix, and the empty state says so.
 */
export function OverridePanel() {
  const { view, overrides, selection, canEdit } = useGraphViewer();
  const { createOverride, deleteOverride, isSaving } = useGraphEditor();

  const [pending, setPending] = useState<PendingOverride | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const byInstance = useMemo(() => indexByInstance(view.nodes), [view.nodes]);

  const selectedEdge =
    selection?.type === 'edge' ? findEdge(view, selection.edgeId) : null;

  /**
   * An override already recorded against these exact endpoints.
   *
   * `GraphEdgeOverrides` is uniquely indexed on
   * `(graph, sourcePath, sourcePort, targetPath, targetPort)`, so one pair of
   * ports carries at most one override — you cannot pin a pair you have also
   * suppressed. Catching it here turns a bare "Failed to create record." into
   * something that says which override is in the way.
   */
  const existingFor = (endpoints: Omit<PendingOverride, 'mode'>) =>
    overrides.find(
      (row) =>
        row.sourcePath === endpoints.sourcePath &&
        row.sourcePort === endpoints.sourcePort &&
        row.targetPath === endpoints.targetPath &&
        row.targetPort === endpoints.targetPort
    ) ?? null;

  /**
   * Is there already an edge between these two ports?
   *
   * `applyOverrides` skips a pin whose edge id already exists and leaves the
   * edge `origin: 'derived'`, so pinning something the rules already produce
   * writes a row that changes nothing. Without this the user gets a success
   * toast and an unchanged canvas.
   */
  const alreadyConnected = (endpoints: Omit<PendingOverride, 'mode'>) => {
    const resolved = resolveOverrideEndpoints(byInstance, {
      ...endpoints,
      mode: 'pin',
    } as GraphEdgeOverride);
    if (!resolved.ok) return false;

    return view.edges.some(
      (edge) =>
        edge.sourceInstanceId === resolved.source.node.instanceId &&
        edge.sourcePortName === resolved.source.handle &&
        edge.targetInstanceId === resolved.target.node.instanceId &&
        edge.targetPortName === resolved.target.handle
    );
  };

  const begin = (next: PendingOverride) => {
    if (next.mode === 'pin' && alreadyConnected(next)) {
      toast.error('Those two ports are already connected.', {
        description:
          'The rules already produce this edge, so pinning it would change nothing.',
      });
      return;
    }

    const clash = existingFor(next);
    if (clash) {
      toast.error(`These two ports already have a ${clash.mode} override.`, {
        description:
          clash.mode === next.mode
            ? 'Nothing to add.'
            : `Delete the ${clash.mode} override below first — a pair of ports carries one override at a time.`,
      });
      return;
    }
    setPending(next);
  };

  /**
   * Turn the selected edge into override endpoints.
   *
   * The conversion is the whole point: the edge carries handle ids
   * (`supply-out-0`), the override stores bare port names (`supply`). Skipping
   * it writes a row that matches nothing and reappears as a stale warning.
   */
  const suppressSelected = () => {
    if (!selectedEdge) return;

    const source = byInstance.get(selectedEdge.sourceInstanceId);
    const target = byInstance.get(selectedEdge.targetInstanceId);
    if (!source || !target) return;

    const sourcePort = portNameFromHandle(source, selectedEdge.sourcePortName);
    const targetPort = portNameFromHandle(target, selectedEdge.targetPortName);
    if (!sourcePort || !targetPort) {
      toast.error('That edge no longer matches the ports on its nodes.');
      return;
    }

    begin({
      mode: 'suppress',
      sourcePath: selectedEdge.sourceInstanceId,
      sourcePort,
      targetPath: selectedEdge.targetInstanceId,
      targetPort,
    });
  };

  const remove = async (override: GraphEdgeOverride) => {
    try {
      await deleteOverride(override.id);
      toast.success('Override removed');
    } catch (error: unknown) {
      console.error('Removing the override failed:', error);
      toast.error('Could not remove that override');
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={suppressSelected}
            disabled={
              !selectedEdge || selectedEdge.origin !== 'derived' || isSaving
            }
          >
            <Scissors className="mr-1 h-4 w-4" />
            Suppress selected edge
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConnectOpen(true)}
            disabled={isSaving}
          >
            <Link2 className="mr-1 h-4 w-4" />
            Connect two ports
          </Button>
        </div>
      )}

      {selection?.type === 'edge' && selectedEdge?.origin === 'pinned' && (
        <p className="text-muted-foreground text-xs">
          The selected edge is pinned. Suppression only removes derived edges —
          delete the override below to take this one away.
        </p>
      )}

      {selection?.type !== 'edge' && canEdit && (
        <p className="text-muted-foreground text-xs">
          Select an edge on the canvas to suppress it.
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          Active overrides
          {overrides.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {overrides.length}
            </Badge>
          )}
        </h3>

        {overrides.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None. Wiring here comes entirely from the ports — which is where a
            correction usually belongs, too.
          </p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((override) => (
              <OverrideRow
                key={override.id}
                override={override}
                byInstance={byInstance}
                canEdit={canEdit && !isSaving}
                onRemove={() => remove(override)}
              />
            ))}
          </ul>
        )}
      </div>

      <ReasonDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          await createOverride({ ...pending, reason });
          toast.success(
            pending.mode === 'suppress'
              ? 'Connection suppressed'
              : 'Connection pinned'
          );
          setPending(null);
        }}
      />

      <ConnectPortsDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        nodes={view.nodes}
        onPick={(endpoints) => {
          setConnectOpen(false);
          begin({ mode: 'pin', ...endpoints });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverrideRow({
  override,
  byInstance,
  canEdit,
  onRemove,
}: {
  override: GraphEdgeOverride;
  byInstance: ReadonlyMap<string, FlatNode>;
  canEdit: boolean;
  onRemove: () => void;
}) {
  // Resolved with the engine's own function, so "stale" here means exactly
  // what `stale-override` means in the diagnostics list.
  const resolved = resolveOverrideEndpoints(byInstance, override);

  return (
    <li className="space-y-1.5 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <Badge variant={override.mode === 'pin' ? 'default' : 'secondary'}>
          {override.mode}
        </Badge>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Delete override"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="text-sm">
        <Endpoint
          node={byInstance.get(override.sourcePath)}
          path={override.sourcePath}
          port={override.sourcePort}
        />
        {' → '}
        <Endpoint
          node={byInstance.get(override.targetPath)}
          path={override.targetPath}
          port={override.targetPort}
        />
      </p>

      {override.reason && (
        <p className="text-muted-foreground text-sm">{override.reason}</p>
      )}

      {!resolved.ok && (
        <p className="flex items-start gap-1 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Stale — it {resolved.reason}.
        </p>
      )}
    </li>
  );
}

/**
 * One end of an override, named the way a person would.
 *
 * The stored form is an instance id — an alias chain plus a record id — which
 * is precise and unreadable. The node it resolves to has a label and a
 * breadcrumb; the raw path stays on the tooltip for when the two disagree.
 * A node that no longer resolves falls back to the path, because that is then
 * the only thing left to show.
 */
function Endpoint({
  node,
  path,
  port,
}: {
  node: FlatNode | undefined;
  path: string;
  port: string;
}) {
  const { path: aliases } = parseInstanceId(path);

  return (
    // `break-all` rather than `whitespace-nowrap`: an instance path plus a port
    // name is long enough to overflow a phone-width panel, and the full value
    // is on the title anyway.
    <span title={`${path}:${port}`} className="break-all">
      {node ? (
        <>
          {aliases.length > 0 && (
            <span className="text-muted-foreground">
              {formatInstancePath(aliases)}{' '}
            </span>
          )}
          <span className="font-medium">{node.label}</span>
        </>
      ) : (
        <span className="font-mono text-xs">{path}</span>
      )}
      <span className="text-muted-foreground"> · </span>
      <span className="font-mono text-xs">{port}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * The friction. An override without a reason is a mystery to the next person,
 * so the collection's `reason` may be optional but this form's is not.
 */
function ReasonDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingOverride | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } catch (error: unknown) {
      console.error('Saving the override failed:', error);
      // `parseAuthError` unpacks the ClientResponseError's field errors; the
      // raw `message` is only ever "Failed to create record."
      toast.error('Could not save that override', {
        description: parseAuthError(error).message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pending?.mode === 'pin'
              ? 'Connect these anyway'
              : 'Suppress this connection'}
          </DialogTitle>
          <DialogDescription>
            {pending?.mode === 'pin'
              ? 'A pinned edge ignores kind compatibility, relationship budgets and filters. It also satisfies a required input.'
              : 'The edge is removed from this graph. Freeing the input does not hand the slot to the runner-up — nothing else re-wires.'}
          </DialogDescription>
        </DialogHeader>

        {pending && (
          <p className="bg-muted rounded-md p-2 font-mono text-xs break-all">
            {pending.sourcePath}:{pending.sourcePort} → {pending.targetPath}:
            {pending.targetPort}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="override-reason">Why?</Label>
          <Textarea
            id="override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="The rules cannot express this because…"
            disabled={isSaving}
          />
          <p className="text-muted-foreground text-xs">
            Required. If the intent fits a port kind or a filter, change those
            instead — an override is a local patch and should read as one.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!reason.trim() || isSaving}>
            {isSaving ? 'Saving…' : 'Save override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/**
 * Pick an output and an input to pin together.
 *
 * The phase sketch described this as acting on two ports selected on the
 * canvas. Port-level canvas selection does not exist — the viewer selects
 * nodes and edges — and inventing it for one gesture would be a large change
 * to the canvas for a worse hit rate than two lists. The gesture is the same:
 * choose two ports, say why.
 */
function ConnectPortsDialog({
  open,
  onOpenChange,
  nodes,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: readonly FlatNode[];
  onPick: (endpoints: Omit<PendingOverride, 'mode'>) => void;
}) {
  const [sourcePath, setSourcePath] = useState('');
  const [sourcePort, setSourcePort] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [targetPort, setTargetPort] = useState('');

  const sourceNode = nodes.find((node) => node.instanceId === sourcePath);
  const targetNode = nodes.find((node) => node.instanceId === targetPath);

  const outputs = portsOf(sourceNode, 'output');
  const inputs = portsOf(targetNode, 'input');

  const complete = sourcePath && sourcePort && targetPath && targetPort;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect two ports</DialogTitle>
          <DialogDescription>
            Pins an edge the rules did not produce. Both ports are addressed by
            instance, so the same node imported twice can be wired differently
            in each place.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <EndpointPicker
            legend="From — an output port"
            nodes={nodes}
            direction="output"
            nodeValue={sourcePath}
            portValue={sourcePort}
            ports={outputs}
            onNodeChange={(value) => {
              setSourcePath(value);
              setSourcePort('');
            }}
            onPortChange={setSourcePort}
          />
          <EndpointPicker
            legend="To — an input port"
            nodes={nodes}
            direction="input"
            nodeValue={targetPath}
            portValue={targetPort}
            ports={inputs}
            onNodeChange={(value) => {
              setTargetPath(value);
              setTargetPort('');
            }}
            onPortChange={setTargetPort}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!complete}
            onClick={() =>
              onPick({ sourcePath, sourcePort, targetPath, targetPort })
            }
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndpointPicker({
  legend,
  nodes,
  direction,
  nodeValue,
  portValue,
  ports,
  onNodeChange,
  onPortChange,
}: {
  legend: string;
  nodes: readonly FlatNode[];
  direction: 'input' | 'output';
  nodeValue: string;
  portValue: string;
  ports: Port[];
  onNodeChange: (value: string) => void;
  onPortChange: (value: string) => void;
}) {
  const eligible = nodes.filter((node) =>
    node.ports.some((port) => port.direction === direction)
  );

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <Select value={nodeValue} onValueChange={onNodeChange}>
        <SelectTrigger className="w-full" aria-label={`${legend} node`}>
          <SelectValue placeholder="Choose a node" />
        </SelectTrigger>
        <SelectContent>
          {eligible.map((node) => (
            <SelectItem key={node.instanceId} value={node.instanceId}>
              {node.label}
              {node.instancePath.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  · {formatInstancePath(node.instancePath)}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={portValue}
        onValueChange={onPortChange}
        disabled={!nodeValue || ports.length === 0}
      >
        <SelectTrigger className="w-full" aria-label={`${legend} port`}>
          <SelectValue
            placeholder={
              nodeValue && ports.length === 0
                ? `No ${direction} ports on that node`
                : 'Choose a port'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {ports.map((port) => (
            <SelectItem key={port.name} value={port.name}>
              {port.name}
              <span className="text-muted-foreground"> · {port.kind}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </fieldset>
  );
}

/**
 * A node's ports in one direction, deduplicated by name.
 *
 * Overrides address a port by name and direction, so two same-named ports on
 * one side would be indistinguishable once stored. The schema makes names
 * unique per direction, so this only guards against hand-edited data.
 */
function portsOf(
  node: FlatNode | undefined,
  direction: 'input' | 'output'
): Port[] {
  if (!node) return [];

  const seen = new Set<string>();
  return node.ports.filter((port) => {
    if (port.direction !== direction || seen.has(port.name)) return false;
    seen.add(port.name);
    return true;
  });
}
