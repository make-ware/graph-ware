import { RecordService } from 'pocketbase';
import {
  type GraphEdgeOverride,
  type GraphEdgeOverrideInput,
  GraphEdgeOverrideInputSchema,
} from '../schema/graph-edge-override';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class GraphEdgeOverrideMutator extends BaseMutator<
  GraphEdgeOverride,
  GraphEdgeOverrideInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<GraphEdgeOverride> {
    return this.pb.collection('GraphEdgeOverrides');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['sourcePath', 'sourcePort'],
    };
  }

  protected async validateInput(
    input: GraphEdgeOverrideInput
  ): Promise<GraphEdgeOverrideInput> {
    return GraphEdgeOverrideInputSchema.parse(input);
  }

  /**
   * Overrides that apply when `graphId` is the root of the resolved tree.
   *
   * Overrides do not inherit: an override recorded on a child graph does not
   * follow that child into a parent, because the instance paths differ. The
   * engine only ever loads the root graph's overrides.
   */
  async listForGraph(graphId: string): Promise<GraphEdgeOverride[]> {
    return await this.getCollection().getFullList({
      filter: `graph = "${graphId}"`,
      sort: 'sourcePath,sourcePort',
    });
  }
}
