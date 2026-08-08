'use client';

import type { FlatEdge, FlatNode, GraphView } from '@project/shared';
import { DEFAULT_PORT_RELATIONSHIP, parseInstanceId } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  findEdge,
  findNode,
  type ViewerSelection,
} from '@/lib/graph/flow-adapter';
import { PortBadge } from './port-badge';

interface GraphDetailPanelProps {
  view: GraphView;
  selection: ViewerSelection | null;
  colorFor: (kind: string) => string;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-4 text-sm text-muted-foreground">{children}</div>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function NodeDetail({
  node,
  colorFor,
}: {
  node: FlatNode;
  colorFor: (kind: string) => string;
}) {
  const inputs = node.ports.filter((port) => port.direction === 'input');
  const outputs = node.ports.filter((port) => port.direction === 'output');

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{node.label}</h2>
        <p className="font-mono text-xs text-muted-foreground">{node.name}</p>
        {/* The breadcrumb is the only thing that distinguishes two instances of
            the same imported node, so it is never collapsed away. */}
        <p className="text-xs text-muted-foreground">
          {node.breadcrumb.join(' › ')}
        </p>
      </div>

      <Separator />

      <Section title="Attributes">
        {node.attributes.length ? (
          <dl className="space-y-1">
            {node.attributes.map((attribute) => (
              <div
                key={attribute.name}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <dt className="truncate text-muted-foreground">
                  {attribute.name}
                </dt>
                <dd className="shrink-0 font-medium">
                  {attribute.value}
                  {attribute.unit ? ` ${attribute.unit}` : ''}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">None.</p>
        )}
      </Section>

      {[
        { title: 'Inputs', ports: inputs },
        { title: 'Outputs', ports: outputs },
      ].map(({ title, ports }) => (
        <Section key={title} title={title}>
          {ports.length ? (
            <div className="flex flex-wrap gap-1">
              {ports.map((port, index) => (
                <PortBadge
                  key={`${port.name}-${index}`}
                  port={port}
                  color={colorFor(port.kind)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </Section>
      ))}

      <Section title="Instance">
        <p className="font-mono text-xs break-all text-muted-foreground">
          {node.instanceId}
        </p>
      </Section>
    </div>
  );
}

function Endpoint({
  title,
  instanceId,
  handleId,
  view,
}: {
  title: string;
  instanceId: string;
  handleId: string;
  view: GraphView;
}) {
  const node = findNode(view, instanceId);
  const { path } = parseInstanceId(instanceId);

  return (
    <Section title={title}>
      <p className="text-sm font-medium">{node?.label ?? 'Unknown node'}</p>
      <p className="text-xs text-muted-foreground">
        {path.length ? path.join(' › ') : 'root'}
      </p>
      {/* The handle id carries the port name and its index; the name alone is
          ambiguous because one node can have `supply` in *and* out. */}
      <p className="font-mono text-xs text-muted-foreground">{handleId}</p>
    </Section>
  );
}

function EdgeDetail({ edge, view }: { edge: FlatEdge; view: GraphView }) {
  const target = findNode(view, edge.targetInstanceId);
  const targetPort = target?.ports.find(
    (port) =>
      port.direction === 'input' &&
      edge.targetPortName.startsWith(`${port.name}-in-`)
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Connection</h2>
        <Badge variant={edge.origin === 'pinned' ? 'default' : 'secondary'}>
          {edge.origin}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        {edge.origin === 'pinned'
          ? 'Pinned by an override — it bypasses kind, budget and filter checks.'
          : 'Derived from port compatibility. There is no stored record for it.'}
      </p>

      <Separator />

      <Section title="Kind">
        <Badge variant="outline">{edge.kind}</Badge>
      </Section>

      <Endpoint
        title="From"
        instanceId={edge.sourceInstanceId}
        handleId={edge.sourcePortName}
        view={view}
      />
      <Endpoint
        title="To"
        instanceId={edge.targetInstanceId}
        handleId={edge.targetPortName}
        view={view}
      />

      {targetPort && (
        <Section title="Target port">
          <p className="text-sm">
            {targetPort.relationship ?? DEFAULT_PORT_RELATIONSHIP}
            {targetPort.isRequired ? ' · required' : ''}
          </p>
        </Section>
      )}
    </div>
  );
}

/**
 * What is selected: a node's attributes, ports and breadcrumb, or an edge's
 * endpoints, kind and provenance.
 *
 * Derived edges are selectable even though they have no record behind them —
 * the provenance is the point, and Phase 4 hangs "suppress this connection"
 * off the same selection.
 */
export function GraphDetailPanel({
  view,
  selection,
  colorFor,
}: GraphDetailPanelProps) {
  if (!selection) {
    return <Empty>Select a node or a connection to see its details.</Empty>;
  }

  if (selection.type === 'node') {
    const node = findNode(view, selection.instanceId);
    if (!node) {
      return <Empty>That node is not in the current view.</Empty>;
    }
    return (
      <ScrollArea className="h-full">
        <NodeDetail node={node} colorFor={colorFor} />
      </ScrollArea>
    );
  }

  const edge = findEdge(view, selection.edgeId);
  if (!edge) {
    return <Empty>That connection is not in the current view.</Empty>;
  }

  return (
    <ScrollArea className="h-full">
      <EdgeDetail edge={edge} view={view} />
    </ScrollArea>
  );
}
