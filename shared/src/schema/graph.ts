import {
  baseSchema,
  defineCollection,
  JSONField,
  RelationField,
  SelectField,
  TextField,
} from 'pocketbase-zod-schema';
import { z } from 'zod';
import {
  GRAPH_UID_PATTERN,
  MACHINE_NAME_PATTERN,
  NAMESPACE_PATTERN,
  // Relative, not `@/…` — `pocketbase-migrate` imports these files directly
  // through tsx from the repo root, where the webapp path alias is not in scope.
} from '../lib/graph/primitives';
import { memberOf, SIGNED_IN, writerOf } from './permissions';

export const GRAPH_VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export type GraphVisibility = (typeof GRAPH_VISIBILITIES)[number];

/**
 * A graph — a system, subsystem, or reusable component library.
 *
 * Every graph is first class: one that is imported by another is still viewable
 * and editable on its own. Graphs hold no edges; connections are derived from
 * port compatibility at render time (see docs/GRAPH_ENGINE.md).
 */
export const GraphSchema = z
  .object({
    // The access anchor since Phase 5. Everything that decides who may read or
    // write this graph goes through here, not through `owner`.
    workspace: RelationField({
      collection: 'Workspaces',
      cascadeDelete: true,
    }),
    // Who created it — history, not authority. Retained because "whose is this"
    // is still a question the UI answers, and because the personal-workspace
    // backfill was derived from it.
    owner: RelationField({ collection: 'Users', cascadeDelete: true }),
    /**
     * Where this graph was copied from, if it was.
     *
     * `cascadeDelete: false`, and that is the whole semantics: a fork is a
     * copy, and deleting the original must not delete the copies. There is no
     * merge and no sync — see docs/IMPORTS.md § Forking.
     */
    forkedFrom: RelationField({
      collection: 'Graphs',
      cascadeDelete: false,
    }).optional(),
    // The human-chosen reference key. Was the filename in the JSON-file model
    // and is still what import/export round-trips on.
    uid: TextField({ min: 1, max: 64, pattern: GRAPH_UID_PATTERN }),
    name: TextField({ min: 1, max: 100, pattern: MACHINE_NAME_PATTERN }),
    label: TextField({ min: 1, max: 200 }),
    // A flat grouping label *within* a workspace. In the file-based original
    // this was a directory and carried lookup semantics; here it is
    // presentation only. Phase 5 considered dropping it — workspaces subsume
    // the grouping — and kept it because it is still half of the uid uniqueness
    // key, and rewriting that key is the one part of this migration that can
    // fail on real data. See docs/phases/PHASE_5_LIBRARY_AND_SHARING.md.
    namespace: TextField({ max: 32, pattern: NAMESPACE_PATTERN }).optional(),
    description: TextField({ max: 2000 }).optional(),
    // Reuse across users needs a way to publish. Read rules key off this.
    visibility: SelectField(GRAPH_VISIBILITIES),
    tags: JSONField(z.array(z.string().max(50)).max(20)).optional(),
  })
  .extend(baseSchema);

export const GraphCollection = defineCollection({
  collectionName: 'Graphs',
  schema: GraphSchema,
  permissions: {
    // Anything not private is readable, so a graph imported from someone else's
    // library still resolves for the importer. Everything else goes through
    // workspace membership — `owner` grants nothing on its own any more.
    listRule: `${SIGNED_IN} && (visibility != "private" || ${memberOf('workspace')})`,
    viewRule: `${SIGNED_IN} && (visibility != "private" || ${memberOf('workspace')})`,
    // Both fields must match on create, so the mutator injects both.
    createRule: `${SIGNED_IN} && owner = @request.auth.id && ${writerOf('workspace')}`,
    updateRule: `${SIGNED_IN} && ${writerOf('workspace')}`,
    deleteRule: `${SIGNED_IN} && ${writerOf('workspace')}`,
  },
  indexes: [
    // Was `(owner, namespace, uid)`. One personal workspace per user makes the
    // two equivalent for every row that existed before Phase 5, which is what
    // lets the backfill create this index without renaming anybody's graphs.
    'CREATE UNIQUE INDEX `idx_graphs_workspace_namespace_uid` ON `Graphs` (`workspace`, `namespace`, `uid`)',
    'CREATE INDEX `idx_graphs_workspace` ON `Graphs` (`workspace`)',
    'CREATE INDEX `idx_graphs_owner` ON `Graphs` (`owner`)',
    'CREATE INDEX `idx_graphs_visibility` ON `Graphs` (`visibility`)',
    // Backs "what was forked from this?" on a library card.
    'CREATE INDEX `idx_graphs_forked_from` ON `Graphs` (`forkedFrom`)',
  ],
});

export default GraphCollection;

export type Graph = z.infer<typeof GraphSchema>;

/**
 * What the editor submits.
 *
 * `owner` is always injected by the mutator. `workspace` may be chosen — the
 * new-graph form offers one per workspace you can write — and defaults to your
 * personal workspace when it is left out.
 */
export const GraphInputSchema = z.object({
  workspace: z.string().max(64).optional(),
  forkedFrom: z.string().max(64).optional(),
  uid: z
    .string()
    .min(1)
    .max(64)
    .regex(GRAPH_UID_PATTERN, 'Use letters, numbers, dashes or underscores'),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(MACHINE_NAME_PATTERN, 'Use lowercase letters, numbers, underscores'),
  label: z.string().min(1).max(200),
  namespace: z
    .string()
    .regex(NAMESPACE_PATTERN, 'Use lowercase letters and numbers')
    .optional()
    .or(z.literal('')),
  description: z.string().max(2000).optional(),
  visibility: z.enum(GRAPH_VISIBILITIES).default('private'),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export type GraphInput = z.infer<typeof GraphInputSchema>;
