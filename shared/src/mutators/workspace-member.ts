import { RecordService } from 'pocketbase';
import {
  type WorkspaceMember,
  type WorkspaceMemberInput,
  WorkspaceMemberInputSchema,
} from '../schema/workspace-member';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class WorkspaceMemberMutator extends BaseMutator<
  WorkspaceMember,
  WorkspaceMemberInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<WorkspaceMember> {
    return this.pb.collection('WorkspaceMembers');
  }

  protected setDefaults(): MutatorOptions {
    return {
      // The roll is a list of people; without the user record it is a list of ids.
      expand: ['user'],
      filter: [],
      sort: ['role', 'created'],
    };
  }

  protected async validateInput(
    input: WorkspaceMemberInput
  ): Promise<WorkspaceMemberInput> {
    return WorkspaceMemberInputSchema.parse(input);
  }

  /** Everyone on a workspace's roll. */
  async listForWorkspace(workspaceId: string, page = 1, perPage = 200) {
    return await this.getList(page, perPage, `workspace = "${workspaceId}"`);
  }

  /** The caller's own row, or `null` if they reach the workspace as its creator. */
  async mine(workspaceId: string): Promise<WorkspaceMember | null> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) return null;

    return await this.getFirstByFilter(
      `workspace = "${workspaceId}" && user = "${userId}"`
    );
  }

  /**
   * Add someone by email address.
   *
   * The `Users` read rule is `id = @request.auth.id`, so a member cannot look
   * another user up — which means an invite by email cannot be resolved to an
   * id on the client. Callers pass the id; the workspace page gets it from a
   * user the caller can already see, and inviting a stranger is Phase 6's
   * problem, not something to fake with a widened read rule here.
   */
  async add(
    workspaceId: string,
    userId: string,
    role: WorkspaceMemberInput['role'] = 'member'
  ): Promise<WorkspaceMember> {
    const existing = await this.getFirstByFilter(
      `workspace = "${workspaceId}" && user = "${userId}"`
    );
    if (existing) {
      return await this.update(existing.id, { role });
    }

    return await this.create({ workspace: workspaceId, user: userId, role });
  }
}
