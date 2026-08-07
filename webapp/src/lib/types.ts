// Local TypeScript types for webapp
// These types use the webapp's PocketBase version to avoid type mismatches

import type { Graph } from '@/schema/graph';
import type { GraphEdgeOverride } from '@/schema/graph-edge-override';
import type { GraphImport } from '@/schema/graph-import';
import type { GraphNode } from '@/schema/graph-node';
import type { PortKind } from '@/schema/port-kind';
import { User } from '@/schema/user';
import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';

// Typed PocketBase interface using local PocketBase types.
//
// This one accepts both casings for the users collection: mutators call
// `pb.collection('Users')` while the auth and realtime code calls `'users'`.
// Keep it in sync with the stricter interface in `src/types/index.ts` — every
// new collection has to be registered in both.
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Users' | 'users'): RecordService<User>;
  collection(idOrName: 'Graphs'): RecordService<Graph>;
  collection(idOrName: 'GraphNodes'): RecordService<GraphNode>;
  collection(idOrName: 'GraphImports'): RecordService<GraphImport>;
  collection(idOrName: 'GraphEdgeOverrides'): RecordService<GraphEdgeOverride>;
  collection(idOrName: 'PortKinds'): RecordService<PortKind>;
}
