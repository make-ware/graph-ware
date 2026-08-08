import { RecordService } from 'pocketbase';
import {
  type Workspace,
  type WorkspaceInput,
  WorkspaceInputSchema,
} from '../schema/workspace';
import type { WorkspaceMember } from '../schema/workspace-member';
import { toSlug } from '../lib/graph/primitives';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

/** A workspace the caller belongs to, with the role they hold in it. */
export interface WorkspaceMembership {
  workspace: Workspace;
  /** `owner` for a workspace you created without a roll row of your own. */
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

export class WorkspaceMutator extends BaseMutator<Workspace, WorkspaceInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Workspace> {
    return this.pb.collection('Workspaces');
  }

  protected setDefaults(): MutatorOptions {
    return { expand: [], filter: [], sort: ['name'] };
  }

  protected async validateInput(
    input: WorkspaceInput
  ): Promise<WorkspaceInput> {
    return WorkspaceInputSchema.parse(input);
  }

  /** The create rule requires `owner` to equal the caller, as on `Graphs`. */
  protected async entityCreate(data: WorkspaceInput): Promise<Workspace> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot create a workspace while signed out');
    }

    return await this.getCollection().create({ ...data, owner: userId });
  }

  /**
   * Every workspace the caller can reach, with their role in each.
   *
   * The read rule already restricts the list to workspaces they belong to, so
   * this is one request plus one for the roll — no filter is set here, for the
   * same reason `GraphMutator` sets none.
   */
  async listMine(): Promise<WorkspaceMembership[]> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) return [];

    const [workspaces, roll] = await Promise.all([
      this.getCollection().getFullList({ sort: 'name' }),
      this.pb
        .collection('WorkspaceMembers')
        .getFullList({ filter: `user = "${userId}"` }),
    ]);

    const roleByWorkspace = new Map<string, WorkspaceMember['role']>();
    for (const row of roll) roleByWorkspace.set(row.workspace, row.role);

    return workspaces.map((workspace) => ({
      workspace,
      role:
        workspace.owner === userId
          ? 'owner'
          : (roleByWorkspace.get(workspace.id) ?? 'viewer'),
    }));
  }

  /** One workspace by its URL slug. */
  async getBySlug(slug: string): Promise<Workspace | null> {
    return await this.getFirstByFilter(`slug = "${slug}"`);
  }

  /**
   * The caller's personal workspace — the default target for a new graph.
   *
   * Every user has one: created by the `users` hook on signup, and backfilled
   * for users who predate Phase 5. Falls back to any workspace the caller can
   * write, so a user whose personal workspace was deleted is inconvenienced
   * rather than locked out.
   */
  async personal(): Promise<Workspace | null> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) return null;

    const own = await this.getFirstByFilter(
      `owner = "${userId}" && personal = true`
    );
    if (own) return own;

    return await this.getFirstByFilter(`owner = "${userId}"`);
  }

  /**
   * A slug that is free, appending `-2`, `-3`, … as needed.
   *
   * Slugs are globally unique, so a collision is with a workspace the caller
   * usually cannot read — which is why this counts on the *unique index* to be
   * the real guard and treats an unreadable collision as taken. A create that
   * still loses the race surfaces as a field error on the form.
   */
  async availableSlug(base: string): Promise<string> {
    const root = toSlug(base) || 'workspace';

    for (let suffix = 1; suffix < 100; suffix++) {
      const candidate = suffix === 1 ? root : `${root}-${suffix}`;
      const existing = await this.getFirstByFilter(`slug = "${candidate}"`);
      if (!existing) return candidate;
    }

    return `${root}-${Date.now()}`;
  }
}
