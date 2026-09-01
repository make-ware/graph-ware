'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, LayoutGrid, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FlatNode, GraphInput, GraphNode } from '@project/shared';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { GraphCanvas } from '@/components/graph/graph-canvas';
import { GraphDetailPanel } from '@/components/graph/graph-detail-panel';
import { DiagnosticsPanel } from '@/components/graph/diagnostics-panel';
import { GraphSidebar } from '@/components/graph/graph-sidebar';
import { DeleteGraphDialog } from '@/components/graph/editor/delete-graph-dialog';
import { GraphForm } from '@/components/graph/editor/graph-form';
import { ImportManager } from '@/components/graph/editor/import-manager';
import { VersionPanel } from '@/components/graph/editor/version-panel';
import { NodeEditorModal } from '@/components/graph/editor/node-editor-modal';
// OverridePanel deferred — dedicated editor is reuse-only (Stage A1).
// import { OverridePanel } from '@/components/graph/editor/override-panel';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraphViewerProvider } from '@/contexts/graph-viewer-context';
import { GraphEditorProvider } from '@/contexts/graph-editor-context';
import { useGraphEditor } from '@/hooks/use-graph-editor';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import { usePortKinds } from '@/hooks/use-port-kinds';
import {
  parseViewerParams,
  type ViewerSelection,
  writeViewerParams,
} from '@/lib/graph/flow-adapter';

/** Only root-graph nodes carry a usable manual position. */
const isRootNode = (node: FlatNode) => node.instancePath.length === 0;

function EditorBody() {
  const {
    graph,
    view,
    rootNodes,
    selection,
    select,
    isLoading,
    error,
    canEdit,
  } = useGraphViewer();
  const { saveGraph, deleteGraph, setNodePosition, resetLayout, isSaving } =
    useGraphEditor();
  const { colorFor } = usePortKinds();
  const router = useRouter();

  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const errorCount = view.diagnostics.filter(
    (entry) => entry.level === 'error'
  ).length;

  // Every attribute name in the tree, so a filter can suggest one instead of
  // making the user remember how it was spelled on the other node.
  const attributeNames = useMemo(() => {
    const names = new Set<string>();
    for (const node of view.nodes) {
      for (const attribute of node.attributes) names.add(attribute.name);
    }
    return [...names].sort();
  }, [view.nodes]);

  const hasManualPositions = rootNodes.some((node) => node.position);

  const openNode = (node: GraphNode | null) => {
    setEditingNode(node);
    setNodeModalOpen(true);
  };

  /**
   * The node behind the current selection, when it is one this graph owns.
   *
   * An imported node belongs to its own graph and is edited on that graph's
   * route — editing it from here would silently change every other system that
   * imports it, which is a decision the user should make in that context.
   *
   * Dedicated editor boundary (Stage A1): parent never mutates child subgraph
   * nodes. Child nodes are read-only with a link to their own edit route.
   */
  const selectedOwnNode =
    selection?.type === 'node'
      ? (rootNodes.find((node) => node.id === selection.instanceId) ?? null)
      : null;

  // The flat node for the current selection, whether owned or imported.
  const selectedFlatNode =
    selection?.type === 'node'
      ? (view.nodes.find((node) => node.instanceId === selection.instanceId) ??
        null)
      : null;
  const isChildSelection = Boolean(
    selectedFlatNode && selectedFlatNode.instancePath.length > 0
  );

  if (error) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {error}
      </div>
    );
  }

  if (!isLoading && graph && !canEdit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-muted-foreground text-sm">
          {graph.label} belongs to a workspace you cannot write to. You can view
          it, and import it into a graph of your own — or fork it from the
          library into a workspace of yours.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/graphs/${graph.id}`}>Open the viewer</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/library">Browse the library</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-medium">
            {graph?.label ?? 'Loading…'}
          </h1>
          {graph && <Badge variant="outline">{graph.visibility}</Badge>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMetadataOpen(true)}
            disabled={!graph || isSaving}
          >
            <Pencil className="mr-1 h-4 w-4" />
            Details
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await resetLayout();
              toast.success('Layout reset');
            }}
            disabled={!hasManualPositions || isSaving}
            title={
              hasManualPositions
                ? 'Clear manual positions and let auto-layout decide'
                : 'No node has been moved by hand'
            }
          >
            <LayoutGrid className="mr-1 h-4 w-4" />
            Reset layout
          </Button>
          <Button
            size="sm"
            onClick={() => openNode(null)}
            disabled={!graph || isSaving}
          >
            <Plus className="mr-1 h-4 w-4" />
            Node
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={graph ? `/graphs/${graph.id}` : '/graphs'}>
              <Eye className="mr-1 h-4 w-4" />
              View
            </Link>
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="18%" minSize="12%" maxSize="30%">
            <GraphSidebar />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="52%" minSize="30%">
            <div className="relative h-full">
              {isLoading && (
                <div className="bg-background/60 text-muted-foreground absolute inset-0 z-10 flex items-center justify-center text-sm">
                  Resolving graph…
                </div>
              )}
              <GraphCanvas
                view={view}
                colorFor={colorFor}
                selection={selection}
                onSelect={select}
                canDragNode={isRootNode}
                onNodeMoved={(instanceId, position) => {
                  // `instanceId` is the record id for a root node, which is the
                  // only kind `canDragNode` lets through.
                  void setNodePosition(instanceId, position).catch(
                    (cause: unknown) => {
                      console.error('Saving the position failed:', cause);
                      toast.error('Could not save that position');
                    }
                  );
                }}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="30%" minSize="20%" maxSize="45%">
            <Tabs defaultValue="details" className="flex h-full flex-col gap-0">
              <TabsList className="m-2 shrink-0">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="imports">Imports</TabsTrigger>
                <TabsTrigger value="versions">Versions</TabsTrigger>
                <TabsTrigger value="diagnostics">
                  Issues
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="ml-1.5 text-[10px]">
                      {errorCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="min-h-0 flex-1">
                <div className="flex h-full flex-col">
                  {selectedOwnNode && (
                    <div className="shrink-0 border-b p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => openNode(selectedOwnNode)}
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        Edit {selectedOwnNode.label}
                      </Button>
                    </div>
                  )}
                  {isChildSelection && selectedFlatNode && (
                    <div className="shrink-0 border-b p-2">
                      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1">
                          Read-only — belongs to {selectedFlatNode.graphLabel}
                        </span>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                        >
                          <Link
                            href={`/graphs/${selectedFlatNode.graphId}/edit`}
                          >
                            Edit in {selectedFlatNode.graphLabel}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <GraphDetailPanel
                      view={view}
                      selection={selection}
                      colorFor={colorFor}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="imports" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="space-y-6 p-3">
                    <ImportManager />
                    <NodeList nodes={rootNodes} onEdit={openNode} />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="versions" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="p-3">
                    <VersionPanel />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="diagnostics" className="min-h-0 flex-1">
                <DiagnosticsPanel
                  diagnostics={view.diagnostics}
                  onSelect={select}
                />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <NodeEditorModal
        open={nodeModalOpen}
        onOpenChange={setNodeModalOpen}
        node={editingNode}
        suggestions={attributeNames}
      />

      {graph && (
        <>
          <Sheet open={metadataOpen} onOpenChange={setMetadataOpen}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>Graph details</SheetTitle>
                <SheetDescription>
                  Metadata only. Nodes and imports are edited on the canvas.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-4 pb-6">
                <GraphForm
                  defaultValues={{
                    uid: graph.uid,
                    name: graph.name,
                    label: graph.label,
                    namespace: graph.namespace ?? '',
                    description: graph.description ?? '',
                    visibility: graph.visibility,
                    tags: graph.tags ?? [],
                  }}
                  submitLabel="Save details"
                  onSubmit={async (input: GraphInput) => {
                    await saveGraph(input);
                    toast.success('Saved');
                    setMetadataOpen(false);
                  }}
                  onCancel={() => setMetadataOpen(false)}
                />

                <div className="border-t pt-4">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setMetadataOpen(false);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete this graph
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <DeleteGraphDialog
            graph={graph}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={async () => {
              const removed = await deleteGraph();
              if (!removed) {
                toast.error('Could not delete that graph');
                return;
              }
              toast.success(`Deleted ${graph.label}`);
              router.push('/graphs');
            }}
          />
        </>
      )}
    </div>
  );
}

/** The graph's own nodes, as a way in to the editor for each. */
function NodeList({
  nodes,
  onEdit,
}: {
  nodes: GraphNode[];
  onEdit: (node: GraphNode) => void;
}) {
  const { deleteNode, isSaving } = useGraphEditor();

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Nodes on this graph</h3>
      {nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          None yet. Add one, give it ports, and the wiring follows.
        </p>
      ) : (
        <ul className="space-y-1">
          {nodes.map((node) => (
            <li
              key={node.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2"
            >
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm">{node.label}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {(node.ports ?? []).length} ports
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${node.label}`}
                disabled={isSaving}
                onClick={async () => {
                  const removed = await deleteNode(node.id);
                  if (removed) toast.success(`Deleted ${node.label}`);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Focus and selection live in the query string, as in the viewer, so a link to
 * a particular node under a particular focus keeps working across both routes.
 */
function GraphEditor() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rootId = params.id;

  const { focus, selection } = useMemo(
    () => parseViewerParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const write = useCallback(
    (next: { focus: string[]; selection: ViewerSelection | null }) => {
      const query = writeViewerParams(
        new URLSearchParams(searchParams.toString()),
        next
      );
      const suffix = query.toString();
      router.replace(suffix ? `?${suffix}` : '?', { scroll: false });
    },
    [router, searchParams]
  );

  const onFocusChange = useCallback(
    (nextFocus: string[]) => write({ focus: nextFocus, selection: null }),
    [write]
  );

  const onSelectionChange = useCallback(
    (nextSelection: ViewerSelection | null) =>
      write({ focus, selection: nextSelection }),
    [write, focus]
  );

  return (
    <GraphViewerProvider
      rootId={rootId}
      focus={focus}
      selection={selection}
      onFocusChange={onFocusChange}
      onSelectionChange={onSelectionChange}
    >
      <GraphEditorProvider>
        <EditorBody />
      </GraphEditorProvider>
    </GraphViewerProvider>
  );
}

export default function GraphEditorPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading…
          </div>
        }
      >
        <GraphEditor />
      </Suspense>
    </ProtectedRoute>
  );
}
