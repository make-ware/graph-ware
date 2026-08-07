import { RecordService } from 'pocketbase';
import {
  DEFAULT_PORT_KINDS,
  FALLBACK_PORT_KIND_COLOR,
  type PortKind,
  type PortKindInput,
  PortKindInputSchema,
} from '../schema/port-kind';
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
      const records = await this.getCollection().getFullList({ sort: 'key' });
      for (const record of records) {
        map[record.key] = record.color;
      }
    } catch (error) {
      console.warn('Falling back to built-in port kinds:', error);
    }

    return map;
  }

  /** Colour for one kind, with the neutral fallback applied. */
  static colorFor(kind: string, map: Record<string, string>): string {
    return map[kind] ?? FALLBACK_PORT_KIND_COLOR;
  }
}
