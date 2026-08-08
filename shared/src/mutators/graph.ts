import { RecordService } from 'pocketbase';
import { type Graph, type GraphInput, GraphInputSchema } from '../schema/graph';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { WorkspaceMutator } from './workspace';

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
   * The create rule requires both `owner` and a writable `workspace`, so both
   * have to be sent explicitly — PocketBase does not fill either in.
   *
   * `workspace` may be passed by the caller (creating into a team) or left out,
   * in which case the caller's personal workspace is used. A caller with no
   * workspace at all cannot create a graph; that is a broken account rather
   * than a state to paper over, so it throws.
   */
  protected async entityCreate(data: GraphInput): Promise<Graph> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot create a graph while signed out');
    }

    const workspace = data.workspace || (await this.defaultWorkspace());
    if (!workspace) {
      throw new Error(
        'You are not a member of any workspace, so there is nowhere to put this graph.'
      );
    }

    return await this.getCollection().create({
      ...data,
      workspace,
      owner: userId,
    });
  }

  /** The caller's personal workspace id, or null if they somehow have none. */
  private async defaultWorkspace(): Promise<string | null> {
    const personal = await new WorkspaceMutator(this.pb).personal();
    return personal?.id ?? null;
  }

  /** Graphs created by the signed-in user. */
  async listMine(page = 1, perPage = 200) {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot list graphs while signed out');
    }

    return await this.getList(page, perPage, `owner = "${userId}"`);
  }

  /**
   * Graphs in one workspace.
   *
   * Since Phase 5 this — not `listMine` — is what "my graphs" means: a
   * teammate's graph in a workspace you share is yours to work on, and one you
   * created before joining a team is not something you lose.
   */
  async listForWorkspace(workspaceId: string, page = 1, perPage = 200) {
    return await this.getList(page, perPage, `workspace = "${workspaceId}"`);
  }

  /** Graphs in several workspaces at once — the "all my workspaces" view. */
  async listForWorkspaces(
    workspaceIds: readonly string[],
    page = 1,
    perPage = 500
  ) {
    if (!workspaceIds.length) {
      return { page: 1, perPage, totalItems: 0, totalPages: 0, items: [] };
    }

    const filter = workspaceIds.map((id) => `workspace = "${id}"`).join(' || ');
    return await this.getList(page, perPage, `(${filter})`);
  }

  /** Graphs published by anyone — the shared library. */
  async listPublic(page = 1, perPage = 200) {
    return await this.getList(page, perPage, 'visibility = "public"');
  }

  /**
   * The library query: published graphs, optionally narrowed by free text and
   * tags.
   *
   * Tags are a JSON array, which PocketBase can only match with `~`
   * (substring). That over-matches — the tag `power` also matches `powerwall` —
   * so the filter is a *pre-filter* the caller narrows exactly in memory. Doing
   * it server-side first is still worth it: it keeps the page from downloading
   * a library to search three of it.
   */
  async searchPublic(
    options: { text?: string; tags?: readonly string[] } = {},
    page = 1,
    perPage = 200
  ) {
    const clauses = ['visibility = "public"'];

    const text = options.text?.trim();
    if (text) {
      const escaped = text.replace(/"/g, '');
      clauses.push(
        `(label ~ "${escaped}" || name ~ "${escaped}" || uid ~ "${escaped}" || description ~ "${escaped}")`
      );
    }

    for (const tag of options.tags ?? []) {
      clauses.push(`tags ~ "${tag.replace(/"/g, '')}"`);
    }

    return await this.getList(page, perPage, clauses.join(' && '));
  }

  /** Forks recorded against a graph — provenance, shown on its library card. */
  async listForks(graphId: string, page = 1, perPage = 100) {
    return await this.getList(page, perPage, `forkedFrom = "${graphId}"`);
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
