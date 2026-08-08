// Everything a command is handed: the client, the mutators, the printer, and
// the lazily-resolved active workspace.
//
// The mutators are constructed once and shared. They are stateless wrappers
// over the same client, and building a fresh one per call would make the
// realtime-subscription bookkeeping in BaseMutator pointless.
import { AuthService, createAuthService } from '@project/shared/services';
import {
  GraphEdgeOverrideMutator,
  GraphImportMutator,
  GraphMutator,
  GraphNodeMutator,
  GraphVersionMutator,
  PortKindMutator,
  WorkspaceMemberMutator,
  WorkspaceMutator,
} from '@project/shared/mutators';
import type { TypedPocketBase } from '@project/shared/types';
import { updateProfile } from './config.ts';
import type { Printer } from './output.ts';

export interface GlobalFlags {
  json: boolean;
  url: string;
  workspace?: string;
  color: boolean;
}

export interface CtxOptions {
  pb: TypedPocketBase;
  printer: Printer;
  flags: GlobalFlags;
  env: NodeJS.ProcessEnv;
  /** The workspace id remembered for this server, if any. */
  storedWorkspace?: string;
}

export class Ctx {
  readonly pb: TypedPocketBase;
  readonly printer: Printer;
  readonly flags: GlobalFlags;
  readonly env: NodeJS.ProcessEnv;

  readonly auth: AuthService;
  readonly workspaces: WorkspaceMutator;
  readonly members: WorkspaceMemberMutator;
  readonly graphs: GraphMutator;
  readonly nodes: GraphNodeMutator;
  readonly imports: GraphImportMutator;
  readonly overrides: GraphEdgeOverrideMutator;
  readonly versions: GraphVersionMutator;
  readonly portKinds: PortKindMutator;

  private readonly storedWorkspace?: string;
  private resolvedWorkspace?: string;

  constructor(options: CtxOptions) {
    this.pb = options.pb;
    this.printer = options.printer;
    this.flags = options.flags;
    this.env = options.env;
    this.storedWorkspace = options.storedWorkspace;

    this.auth = createAuthService(this.pb);
    this.workspaces = new WorkspaceMutator(this.pb);
    this.members = new WorkspaceMemberMutator(this.pb);
    this.graphs = new GraphMutator(this.pb);
    this.nodes = new GraphNodeMutator(this.pb);
    this.imports = new GraphImportMutator(this.pb);
    this.overrides = new GraphEdgeOverrideMutator(this.pb);
    this.versions = new GraphVersionMutator(this.pb);
    this.portKinds = new PortKindMutator(this.pb);
  }

  get userId(): string | undefined {
    return this.pb.authStore.record?.id;
  }

  /**
   * The workspace this invocation writes to. Resolved once, lazily, because
   * most commands never need it and resolving it costs a round trip.
   *
   * Precedence: `--workspace` → `$GRAPHWARE_WORKSPACE` → the remembered one →
   * the caller's personal workspace. The first three may be a slug or an id.
   */
  async workspaceId(): Promise<string> {
    if (this.resolvedWorkspace) return this.resolvedWorkspace;

    const explicit = this.flags.workspace ?? this.env.GRAPHWARE_WORKSPACE;
    if (explicit) {
      const workspace = await this.lookupWorkspace(explicit);
      if (!workspace) {
        throw new Error(
          `No workspace "${explicit}" that you can see. Run \`graphware workspace ls\`.`
        );
      }
      this.resolvedWorkspace = workspace;
      return workspace;
    }

    if (this.storedWorkspace) {
      this.resolvedWorkspace = this.storedWorkspace;
      return this.storedWorkspace;
    }

    const personal = await this.workspaces.personal();
    if (personal) {
      this.resolvedWorkspace = personal.id;
      return personal.id;
    }

    throw new Error(
      'No active workspace. Run `graphware workspace ls`, then `graphware workspace use <slug>`.'
    );
  }

  /**
   * Resolve a workspace reference to an id. PocketBase ids are 15 characters
   * with no dashes; a slug always has at least one character outside that shape
   * or is simply not found as an id, so try the id read first and fall back.
   */
  async lookupWorkspace(ref: string): Promise<string | undefined> {
    const bySlug = await this.workspaces.getBySlug(ref);
    if (bySlug) return bySlug.id;
    const byId = await this.workspaces.getById(ref);
    return byId?.id;
  }

  /** Remember a workspace for this server. */
  async rememberWorkspace(workspaceId: string): Promise<void> {
    await updateProfile(this.flags.url, { workspace: workspaceId }, this.env);
  }
}
