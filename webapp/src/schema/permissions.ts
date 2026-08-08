// Access-rule fragments for the workspace-scoped collections.
//
// Phase 5 moved every rule in this directory from `owner = @request.auth.id` to
// a workspace-membership lookup. That expression is long, appears on six
// collections at three different relation depths, and a typo in it leaks
// somebody else's private graph — so it is built here once rather than typed
// out per file.
//
// `permissions.ts` is on `pocketbase-migrate`'s default `schema.exclude` list
// (alongside `base.ts` and `index.ts`), so this file is never scanned for a
// `defineCollection` export. That is also why the exclude list must stay at its
// default — see `pocketbase-migrate.config.mjs`.
//
// Reference: docs/DATA_MODEL.md § Workspaces and access

/** Every rule below is for signed-in callers; superusers bypass rules entirely. */
export const SIGNED_IN = '@request.auth.id != ""';

/**
 * The back-relation from a `Workspaces` record to its membership rows.
 *
 * `WorkspaceMembers_via_workspace` — the collection name plus the relation
 * field that points at us. See docs/PB_RELATIONSHIPS.md.
 */
const MEMBERS = 'WorkspaceMembers_via_workspace';

/** Roles that may write. `viewer` is the read-only role. */
export const WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * Prefix a field with a relation path, so the same fragment works whether it is
 * evaluated on `Workspaces` itself (`''`), on `Graphs` (`'workspace'`), or on a
 * child of a graph (`'graph.workspace'`).
 */
function at(path: string, field: string): string {
  return path ? `${path}.${field}` : field;
}

/**
 * "The caller can see this workspace" — its creator, or anyone on its roll.
 *
 * The creator is admitted explicitly rather than relying on a membership row,
 * so a workspace is never orphaned by a membership row being deleted.
 */
export function memberOf(path: string): string {
  return `(${at(path, 'owner')} = @request.auth.id || ${at(path, MEMBERS)}.user ?= @request.auth.id)`;
}

/**
 * "The caller can change things in this workspace" — creator, `admin`, or
 * `member`; not `viewer`.
 *
 * Both halves of the membership test use `?` operators (`?=`, `?!=`) because
 * they must be satisfied by the **same** membership row: without them, "I am a
 * member" and "somebody here is not a viewer" would be two independent
 * questions and every viewer would get write access. The multi-user pass in
 * `scripts/verify-workspace-rules.mjs` exercises exactly that case against a
 * real server, because it is not a property a unit test can assert.
 */
export function writerOf(path: string): string {
  return (
    `(${at(path, 'owner')} = @request.auth.id || ` +
    `(${at(path, MEMBERS)}.user ?= @request.auth.id && ${at(path, MEMBERS)}.role ?!= "viewer"))`
  );
}

/** "The caller administers this workspace" — creator or an `admin` member. */
export function adminOf(path: string): string {
  return (
    `(${at(path, 'owner')} = @request.auth.id || ` +
    `(${at(path, MEMBERS)}.user ?= @request.auth.id && ${at(path, MEMBERS)}.role ?= "admin"))`
  );
}

/**
 * The read rule for anything hanging off a graph.
 *
 * Visibility first: a published graph resolves for someone who is in none of
 * its workspaces, which is what makes the library work at all. `path` names the
 * `Graphs` record from the collection being ruled (`''` on `Graphs` itself).
 */
export function graphReadable(path: string): string {
  const visibility = `${at(path, 'visibility')} != "private"`;
  return `${SIGNED_IN} && (${visibility} || ${memberOf(at(path, 'workspace'))})`;
}

/** The write rule for anything hanging off a graph. Visibility grants nothing. */
export function graphWritable(path: string): string {
  return `${SIGNED_IN} && ${writerOf(at(path, 'workspace'))}`;
}
