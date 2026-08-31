'use client';

export const queryKeys = {
  workspaces: {
    all: () => ['workspaces'] as const,
    listMine: () => [...queryKeys.workspaces.all(), 'listMine'] as const,
    byId: (id: string) => [...queryKeys.workspaces.all(), 'byId', id] as const,
    bySlug: (slug: string) =>
      [...queryKeys.workspaces.all(), 'bySlug', slug] as const,
    personal: () => [...queryKeys.workspaces.all(), 'personal'] as const,
  },
  graphs: {
    all: () => ['graphs'] as const,
    list: (filter?: string) =>
      [...queryKeys.graphs.all(), 'list', filter ?? 'all'] as const,
    listMine: () => [...queryKeys.graphs.all(), 'listMine'] as const,
    listForWorkspace: (workspaceId: string) =>
      [...queryKeys.graphs.all(), 'listForWorkspace', workspaceId] as const,
    byId: (id: string) => [...queryKeys.graphs.all(), 'byId', id] as const,
  },
  graphNodes: {
    all: () => ['graphNodes'] as const,
    listForGraph: (graphId: string) =>
      [...queryKeys.graphNodes.all(), 'listForGraph', graphId] as const,
    listForGraphs: (graphIds: readonly string[]) =>
      [
        ...queryKeys.graphNodes.all(),
        'listForGraphs',
        [...graphIds].sort(),
      ] as const,
  },
  graphImports: {
    all: () => ['graphImports'] as const,
    listForParent: (parentId: string) =>
      [...queryKeys.graphImports.all(), 'listForParent', parentId] as const,
    listForParents: (parentIds: readonly string[]) =>
      [
        ...queryKeys.graphImports.all(),
        'listForParents',
        [...parentIds].sort(),
      ] as const,
    allEdges: () => [...queryKeys.graphImports.all(), 'allEdges'] as const,
  },
  graphEdgeOverrides: {
    all: () => ['graphEdgeOverrides'] as const,
    listForGraph: (graphId: string) =>
      [...queryKeys.graphEdgeOverrides.all(), 'listForGraph', graphId] as const,
  },
  graphVersions: {
    all: () => ['graphVersions'] as const,
    listForGraph: (graphId: string) =>
      [...queryKeys.graphVersions.all(), 'listForGraph', graphId] as const,
    latestForGraph: (graphId: string) =>
      [...queryKeys.graphVersions.all(), 'latestForGraph', graphId] as const,
  },
  portKinds: {
    all: () => ['portKinds'] as const,
    colorMap: () => [...queryKeys.portKinds.all(), 'colorMap'] as const,
    registry: () => [...queryKeys.portKinds.all(), 'registry'] as const,
  },
} as const;
