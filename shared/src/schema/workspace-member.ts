import {
  baseSchema,
  defineCollection,
  RelationField,
  SelectField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import { adminOf, memberOf, SIGNED_IN, WORKSPACE_ROLES } from './permissions';

export type { WorkspaceRole } from './permissions';
export { WORKSPACE_ROLES };

/**
 * One person's place on one workspace's roll.
 *
 * A join collection rather than a `users` array on `Workspaces`, because the
 * row carries a role and because access rules have to be able to ask "is *this*
 * caller on the roll?" without loading the whole membership into the filter.
 *
 * Three roles, deliberately no more (finer cross-workspace permissions are out
 * of scope for Phase 5):
 *
 * - `admin`  — manages the roll and the workspace record
 * - `member` — reads and writes graphs
 * - `viewer` — reads only
 *
 * The workspace's creator is not required to have a row here: `memberOf` and
 * friends admit `workspace.owner` directly, so removing the last membership row
 * cannot strand a workspace.
 */
export const WorkspaceMemberSchema = z
  .object({
    workspace: RelationField({ collection: 'Workspaces', cascadeDelete: true }),
    user: RelationField({ collection: 'Users', cascadeDelete: true }),
    role: SelectField(WORKSPACE_ROLES),
  })
  .extend(baseSchema);

export const WorkspaceMemberCollection = defineCollection({
  collectionName: 'WorkspaceMembers',
  schema: WorkspaceMemberSchema,
  permissions: {
    // Members can see who else is on the roll — the workspace page is the whole
    // point, and hiding co-members from each other would make it useless.
    listRule: `${SIGNED_IN} && ${memberOf('workspace')}`,
    viewRule: `${SIGNED_IN} && ${memberOf('workspace')}`,
    createRule: `${SIGNED_IN} && ${adminOf('workspace')}`,
    updateRule: `${SIGNED_IN} && ${adminOf('workspace')}`,
    // An admin removes anyone; anyone removes themselves. Leaving a workspace
    // should not need somebody else's cooperation.
    deleteRule: `${SIGNED_IN} && (${adminOf('workspace')} || user = @request.auth.id)`,
  },
  indexes: [
    'CREATE UNIQUE INDEX `idx_workspace_members_workspace_user` ON `WorkspaceMembers` (`workspace`, `user`)',
    // Backs "which workspaces am I in?" — the query behind every page header.
    'CREATE INDEX `idx_workspace_members_user` ON `WorkspaceMembers` (`user`)',
  ],
});

export default WorkspaceMemberCollection;

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceMemberInputSchema = z.object({
  workspace: z.string().min(1),
  user: z.string().min(1),
  role: z.enum(WORKSPACE_ROLES).default('member'),
});

export type WorkspaceMemberInput = z.infer<typeof WorkspaceMemberInputSchema>;

/** Roles that may write. Mirrors `writerOf` in ./permissions.ts. */
export function roleCanWrite(role: string | undefined): boolean {
  return role === 'admin' || role === 'member';
}

/** Roles that may manage the roll. Mirrors `adminOf` in ./permissions.ts. */
export function roleCanAdminister(role: string | undefined): boolean {
  return role === 'admin';
}
