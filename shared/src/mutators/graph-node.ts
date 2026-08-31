import { RecordService } from 'pocketbase';
import {
  type GraphNode,
  type GraphNodeInput,
  GraphNodeInputSchema,
} from '../schema/graph-node';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class GraphNodeMutator extends BaseMutator<GraphNode, GraphNodeInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<GraphNode> {
    return this.pb.collection('GraphNodes');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      // Name-sorted, because the engine's auto-connect resolves contention in
      // name order and the UI should show the same ordering it reasons about.
      sort: ['name'],
    };
  }

  protected async validateInput(
    input: GraphNodeInput
  ): Promise<GraphNodeInput> {
    return GraphNodeInputSchema.parse(input);
  }

  /**
   * Nodes are scoped through their graph, not through a denormalized owner, so
   * there is no user id to inject — the create rule checks `graph.owner`.
   */
  async listForGraph(graphId: string, page = 1, perPage = 500) {
    return await this.getList(page, perPage, `graph = "${graphId}"`);
  }

  /** Every node across several graphs in one request, for tree resolution. */
  async listForGraphs(
    graphIds: readonly string[],
    options?: { fields?: string }
  ): Promise<GraphNode[]> {
    if (!graphIds.length) return [];

    const results: GraphNode[] = [];
    for (let i = 0; i < graphIds.length; i += 100) {
      const chunk = graphIds.slice(i, i + 100);
      const filter = chunk.map((id) => `graph = "${id}"`).join(' || ');
      const batch = await this.getCollection().getFullList({
        filter,
        sort: 'name',
        ...(options?.fields ? { fields: options.fields } : {}),
      });
      results.push(...batch);
    }
    return results;
  }
}
