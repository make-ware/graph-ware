import { RecordService } from 'pocketbase';
import { type Graph, type GraphInput, GraphInputSchema } from '../schema/graph';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class GraphMutator extends BaseMutator<Graph, GraphInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Graph> {
    return this.pb.collection('Graphs');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      // No owner filter: per-user scoping is enforced by the collection rules,
      // which also let public graphs through — a filter here would hide them.
      filter: [],
      sort: ['namespace', 'label'],
    };
  }

  protected async validateInput(input: GraphInput): Promise<GraphInput> {
    return GraphInputSchema.parse(input);
  }

  /**
   * The create rule requires `owner` to equal the caller, so it has to be sent
   * explicitly — PocketBase does not fill it in.
   */
  protected async entityCreate(data: GraphInput): Promise<Graph> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot create a graph while signed out');
    }

    return await this.getCollection().create({ ...data, owner: userId });
  }

  /** Graphs owned by the signed-in user, newest namespace grouping first. */
  async listMine(page = 1, perPage = 200) {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot list graphs while signed out');
    }

    return await this.getList(page, perPage, `owner = "${userId}"`);
  }

  /** Graphs published by anyone — the shared library. */
  async listPublic(page = 1, perPage = 200) {
    return await this.getList(page, perPage, 'visibility = "public"');
  }

  /**
   * Several graphs by id in one request, for breadth-first tree resolution.
   *
   * Ids the caller asked for but that are missing from the result were filtered
   * out by the read rules — the resolver reports those as `child-unreadable`
   * rather than failing the whole render.
   */
  async listByIds(ids: readonly string[]): Promise<Graph[]> {
    if (!ids.length) return [];

    const filter = ids.map((id) => `id = "${id}"`).join(' || ');
    return await this.getCollection().getFullList({ filter, sort: 'id' });
  }

  /**
   * How many graphs import this one. The editor calls this before offering to
   * delete: `child` cascades, so deleting a graph silently unhooks it from
   * every parent that was using it.
   */
  async countImporters(graphId: string): Promise<number> {
    const result = await this.pb
      .collection('GraphImports')
      .getList(1, 1, { filter: `child = "${graphId}"` });
    return result.totalItems;
  }
}
