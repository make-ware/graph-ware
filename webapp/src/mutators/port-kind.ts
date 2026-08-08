import { RecordService } from 'pocketbase';
import {
  DEFAULT_PORT_KINDS,
  FALLBACK_PORT_KIND_COLOR,
  type PortKind,
  type PortKindInput,
  PortKindInputSchema,
} from '../schema/port-kind';
import type { PortKindRegistry } from '../lib/graph/types';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class PortKindMutator extends BaseMutator<PortKind, PortKindInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<PortKind> {
    return this.pb.collection('PortKinds');
  }

  protected setDefaults(): MutatorOptions {
    return { expand: [], filter: [], sort: ['key'] };
  }

  protected async validateInput(input: PortKindInput): Promise<PortKindInput> {
    return PortKindInputSchema.parse(input);
  }

  /**
   * Every kind the caller can see, global rows first.
   *
   * The read rule already hides other workspaces' kinds, so this needs no
   * filter — but the *order* matters, and PocketBase will not sort empty-first
   * on a relation. Sorting here puts global rows ahead of workspace rows so a
   * later `map[key] = …` lets a workspace shadow a global kind of the same key
   * rather than the other way round.
   */
  private async visibleRecords(): Promise<PortKind[]> {
    const records = await this.getCollection().getFullList({ sort: 'key' });
    return [...records].sort((left, right) => {
      const leftScoped = left.workspace ? 1 : 0;
      const rightScoped = right.workspace ? 1 : 0;
      if (leftScoped !== rightScoped) return leftScoped - rightScoped;
      return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    });
  }

  /**
   * A `kind` → colour lookup for the canvas.
   *
   * Falls back to the compiled-in defaults if the collection cannot be read,
   * and to a neutral grey for any kind with no row at all — the registry is a
   * presentation aid, never a gate on which kinds may be used.
   */
  async colorMap(): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    for (const kind of DEFAULT_PORT_KINDS) {
      map[kind.key] = kind.color;
    }

    try {
      for (const record of await this.visibleRecords()) {
        map[record.key] = record.color;
      }
    } catch (error) {
      console.warn('Falling back to built-in port kinds:', error);
    }

    return map;
  }

  /**
   * The registry the engine matches port kinds against.
   *
   * `colorMap` drops `compatibleWith`, which auto-connect needs, and the engine
   * also uses the presence of a row to decide whether a kind is unknown. Same
   * never-rejects fallback: the built-in kinds if the collection is unreadable.
   */
  async registry(): Promise<PortKindRegistry> {
    const registry: PortKindRegistry = {};
    for (const kind of DEFAULT_PORT_KINDS) {
      registry[kind.key] = {
        key: kind.key,
        compatibleWith: kind.compatibleWith,
      };
    }

    try {
      for (const record of await this.visibleRecords()) {
        registry[record.key] = {
          key: record.key,
          compatibleWith: record.compatibleWith,
        };
      }
    } catch (error) {
      console.warn('Falling back to built-in port kinds:', error);
    }

    return registry;
  }

  /** The global vocabulary — rows with no workspace. Superuser-write. */
  async listGlobal(page = 1, perPage = 200) {
    return await this.getList(page, perPage, 'workspace = ""');
  }

  /** One workspace's own kinds, which shadow global rows of the same key. */
  async listForWorkspace(workspaceId: string, page = 1, perPage = 200) {
    return await this.getList(page, perPage, `workspace = "${workspaceId}"`);
  }

  /** Colour for one kind, with the neutral fallback applied. */
  static colorFor(kind: string, map: Record<string, string>): string {
    return map[kind] ?? FALLBACK_PORT_KIND_COLOR;
  }
}
