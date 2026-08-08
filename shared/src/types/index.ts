// Shared TypeScript types

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { Graph } from '../schema/graph';
import type { GraphEdgeOverride } from '../schema/graph-edge-override';
import type { GraphImport } from '../schema/graph-import';
import type { GraphNode } from '../schema/graph-node';
import type { GraphVersion } from '../schema/graph-version';
import type { PortKind } from '../schema/port-kind';
import type { User } from '../schema/user';
import type { Workspace } from '../schema/workspace';
import type { WorkspaceMember } from '../schema/workspace-member';

// Typed PocketBase interface — the only one. There used to be a second, looser
// copy at `webapp/src/lib/types.ts`; they were collapsed when this package was
// extracted, so a new collection is registered in exactly one place.
export interface TypedPocketBase extends PocketBase {
  // Both casings for the users collection. `'Users'` is the collection's real
  // name — what the mutators use and what a pb_hook tag must match exactly —
  // while `'users'` is PocketBase's routing sugar, which the auth and realtime
  // code calls. No other collection has that sugar in play.
  collection(idOrName: 'Users' | 'users'): RecordService<User>;
  collection(idOrName: 'Workspaces'): RecordService<Workspace>;
  collection(idOrName: 'WorkspaceMembers'): RecordService<WorkspaceMember>;
  collection(idOrName: 'Graphs'): RecordService<Graph>;
  collection(idOrName: 'GraphNodes'): RecordService<GraphNode>;
  collection(idOrName: 'GraphImports'): RecordService<GraphImport>;
  collection(idOrName: 'GraphEdgeOverrides'): RecordService<GraphEdgeOverride>;
  collection(idOrName: 'GraphVersions'): RecordService<GraphVersion>;
  collection(idOrName: 'PortKinds'): RecordService<PortKind>;
}

// PocketBase response types
export interface PocketBaseResponse<T = Record<string, unknown>> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

// API response types
export interface ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Common utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
