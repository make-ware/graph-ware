// Shared TypeScript types

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { Graph } from '../schema/graph';
import type { GraphEdgeOverride } from '../schema/graph-edge-override';
import type { GraphImport } from '../schema/graph-import';
import type { GraphNode } from '../schema/graph-node';
import type { PortKind } from '../schema/port-kind';
import type { User } from '../schema/user';

// Typed PocketBase interface.
//
// Stricter than the one in `src/lib/types.ts`: only the capitalized collection
// names, which is what the data layer uses. Register every new collection in
// both files.
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Users'): RecordService<User>;
  collection(idOrName: 'Graphs'): RecordService<Graph>;
  collection(idOrName: 'GraphNodes'): RecordService<GraphNode>;
  collection(idOrName: 'GraphImports'): RecordService<GraphImport>;
  collection(idOrName: 'GraphEdgeOverrides'): RecordService<GraphEdgeOverride>;
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
