import { RecordService } from 'pocketbase';
import {
  type GraphImport,
  type GraphImportInput,
  GraphImportInputSchema,
} from '../schema/graph-import';
import {
  checkImport,
  nextAvailableAlias,
  type ImportEdge,
} from '../lib/graph/imports';
import type { AttributeOverrideMap } from '../lib/graph/primitives';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class GraphImportMutator extends BaseMutator<
  GraphImport,
  GraphImportInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<GraphImport> {
    return this.pb.collection('GraphImports');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['child'],
      filter: [],
      sort: ['order', 'alias'],
    };
  }

  protected async validateInput(
    input: GraphImportInput
  ): Promise<GraphImportInput> {
    return GraphImportInputSchema.parse(input);
  }

  /** Imports declared by a parent graph, in display order. */
  async listForParent(parentId: string, page = 1, perPage = 200) {
    return await this.getList(page, perPage, `parent = "${parentId}"`);
  }

  /** Imports for several parents at once, for breadth-first tree resolution. */
  async listForParents(parentIds: readonly string[]): Promise<GraphImport[]> {
    if (!parentIds.length) return [];

    const filter = parentIds.map((id) => `parent = "${id}"`).join(' || ');
    return await this.getCollection().getFullList({ filter, sort: 'order' });
  }

  /** Which graphs import `childId` — the impact check before a delete. */
  async listImporters(childId: string, page = 1, perPage = 200) {
    return await this.getList(
      page,
      perPage,
      `child = "${childId}"`,
      undefined,
      'parent'
    );
  }

  /**
   * Every import edge visible to the caller, reduced to `{parent, child}`.
   *
   * The client-side cycle check needs the whole graph of imports, not just one
   * subtree — an import can close a loop through a branch the user is not
   * currently looking at.
   */
  async listAllEdges(): Promise<ImportEdge[]> {
    const records = await this.getCollection().getFullList({
      fields: 'parent,child',
    });
    return records.map((record) => ({
      parent: record.parent,
      child: record.child,
    }));
  }

  /**
   * Add an import, pre-checking the rules the server enforces.
   *
   * The hook in `pb_hooks/graph-imports.pb.js` is what actually guarantees no
   * cycles; this check exists so the user gets a specific message instead of a
   * generic 400, and so an unusable alias is corrected rather than rejected.
   */
  async addImport(
    parentId: string,
    childId: string,
    options: { alias?: string; label?: string; order?: number } = {}
  ): Promise<GraphImport> {
    const [edges, siblings] = await Promise.all([
      this.listAllEdges(),
      this.listForParent(parentId),
    ]);

    const verdict = checkImport(parentId, childId, edges);
    if (!verdict.ok) {
      throw new Error(verdict.message);
    }

    const taken = siblings.items.map((item) => item.alias);
    const alias = nextAvailableAlias(
      options.alias ?? (await this.defaultAliasFor(childId)),
      taken
    );

    return await this.create({
      parent: parentId,
      child: childId,
      alias,
      label: options.label,
      order: options.order ?? siblings.items.length,
      enabled: true,
    });
  }

  /** Seed an alias from the child's machine name, e.g. `battery_system`. */
  private async defaultAliasFor(childId: string): Promise<string> {
    const child = await this.pb.collection('Graphs').getOne(childId);
    return this.toSnakeCase(child.name || child.uid || 'child');
  }

  /**
   * Pin an import to a version, or unpin it.
   *
   * `null` has to be sent to clear the relation: an `undefined` key is dropped
   * from the request payload and the field survives — the same trap
   * `resetLayout` hits with `position`.
   */
  async setVersion(id: string, versionId: string | null): Promise<GraphImport> {
    return await this.update(id, {
      version: (versionId ?? null) as unknown as string,
    });
  }

  /**
   * Replace an import's attribute overrides.
   *
   * The whole map is written at once because it is one JSON field: there is no
   * per-entry write, and a read-modify-write from two tabs loses the older
   * edit. That is the same last-write-wins the rest of the editor has.
   */
  async setAttributeOverrides(
    id: string,
    overrides: AttributeOverrideMap
  ): Promise<GraphImport> {
    const isEmpty = Object.keys(overrides).length === 0;
    return await this.update(id, {
      attributeOverrides: (isEmpty
        ? null
        : overrides) as unknown as AttributeOverrideMap,
    });
  }

  /** Every import in this tree that carries a pin, keyed by import id. */
  async listPinned(parentIds: readonly string[]): Promise<GraphImport[]> {
    const records = await this.listForParents(parentIds);
    return records.filter((record) => Boolean(record.version));
  }
}
