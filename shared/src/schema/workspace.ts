import {
  baseSchema,
  BoolField,
  defineCollection,
  RelationField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import {
  WORKSPACE_SLUG_PATTERN,
  // Relative, not `@/…` — see the note in ./graph.ts.
} from '../lib/graph/primitives';
import { adminOf, memberOf, SIGNED_IN } from './permissions';

/**
 * The ownership anchor — a person or a team, and everything they build.
 *
 * Phase 1 scoped a graph to one `Users` record. That works right up to the
 * point where two people need to edit the same system, at which point the only
 * options are sharing a password or copying the graph. `Workspaces` replaces
 * `Graphs.owner` as what access is decided by; `owner` survives on the graph as
 * "who created it", which is history rather than authority.
 *
 * Every user gets a **personal workspace** on signup, backfilled for existing
 * users by `pocketbase/pb_migrations/*_backfill_workspaces.js`. So the
 * single-player case is unchanged from the outside: one workspace, one member,
 * no UI to think about.
 */
export const WorkspaceSchema = z
  .object({
    // Who created it. Kept out of the membership table on purpose: a workspace
    // whose last membership row is deleted must not become unreachable.
    owner: RelationField({ collection: 'Users', cascadeDelete: true }),
    name: TextField({ min: 1, max: 100 }),
    // The URL segment. Globally unique, because it is addressed without a user.
    slug: TextField({ min: 1, max: 40, pattern: WORKSPACE_SLUG_PATTERN }),
    description: TextField({ max: 2000 }).optional(),
    // Marks the workspace created for a user by signup or by the backfill.
    // The UI refuses to let you leave or delete your own, and the backfill uses
    // it to stay idempotent.
    //
    // `.optional()` for the same reason `GraphImports.enabled` is: a *required*
    // bool in PocketBase means "must be true".
    personal: BoolField().optional(),
  })
  .extend(baseSchema);

export const WorkspaceCollection = defineCollection({
  collectionName: 'Workspaces',
  schema: WorkspaceSchema,
  permissions: {
    // Not public: a workspace name is not something publishing a graph shares.
    // A public graph carries its own label and does not expose its workspace.
    listRule: `${SIGNED_IN} && ${memberOf('')}`,
    viewRule: `${SIGNED_IN} && ${memberOf('')}`,
    createRule: `${SIGNED_IN} && owner = @request.auth.id`,
    updateRule: `${SIGNED_IN} && ${adminOf('')}`,
    // Deleting a workspace cascades to its graphs. Creator only — an admin can
    // manage the roll, but only the person who made it can throw it away.
    deleteRule: `${SIGNED_IN} && owner = @request.auth.id`,
  },
  indexes: [
    'CREATE UNIQUE INDEX `idx_workspaces_slug` ON `Workspaces` (`slug`)',
    'CREATE INDEX `idx_workspaces_owner` ON `Workspaces` (`owner`)',
  ],
});

export default WorkspaceCollection;

export type Workspace = z.infer<typeof WorkspaceSchema>;

/** What the workspace form submits; `owner` is injected by the mutator. */
export const WorkspaceInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(
      WORKSPACE_SLUG_PATTERN,
      'Use lowercase letters, numbers and dashes; no dash at either end'
    ),
  description: z.string().max(2000).optional(),
  personal: z.boolean().default(false),
});

export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
