'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plug, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { Graph, PortKind, WorkspaceMember } from '@project/shared';
import { WORKSPACE_ROLES } from '@project/shared';
import {
  GraphMutator,
  PortKindMutator,
  WorkspaceMemberMutator,
  WorkspaceMutator,
} from '@project/shared/mutators';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaces } from '@/hooks/use-workspaces';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

interface WorkspacePageState {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  members: WorkspaceMember[];
  graphs: Graph[];
  kinds: PortKind[];
}

/** `WorkspaceMembers` is expanded on `user`, so the roll can show people. */
function memberLabel(member: WorkspaceMember): string {
  const user = (
    member as unknown as {
      expand?: { user?: { name?: string; email?: string } };
    }
  ).expand?.user;
  return user?.name || user?.email || member.user;
}

function MemberRow({
  member,
  isSelf,
  canAdminister,
  onRole,
  onRemove,
}: {
  member: WorkspaceMember;
  isSelf: boolean;
  canAdminister: boolean;
  onRole: (role: WorkspaceMember['role']) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">
        {memberLabel(member)}
        {isSelf && <span className="text-muted-foreground"> (you)</span>}
      </span>

      {canAdminister && !isSelf ? (
        <Select
          value={member.role}
          onValueChange={(value) => onRole(value as WorkspaceMember['role'])}
        >
          <SelectTrigger
            className="w-32"
            aria-label={`Role for ${memberLabel(member)}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKSPACE_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary" className="text-[10px]">
          {member.role}
        </Badge>
      )}

      {(canAdminister || isSelf) && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onRemove}
          title={
            isSelf ? 'Leave this workspace' : `Remove ${memberLabel(member)}`
          }
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">
            {isSelf ? 'Leave this workspace' : `Remove ${memberLabel(member)}`}
          </span>
        </Button>
      )}
    </div>
  );
}

function WorkspaceDetail({ slug }: { slug: string }) {
  const { user } = useAuth();
  const { memberships, setActive, reload: reloadWorkspaces } = useWorkspaces();

  const [state, setState] = useState<WorkspacePageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteId, setInviteId] = useState('');
  const [inviteRole, setInviteRole] =
    useState<WorkspaceMember['role']>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [newKind, setNewKind] = useState({
    key: '',
    label: '',
    color: '#2563eb',
  });
  const [reloadToken, setReloadToken] = useState(0);

  const membership = memberships.find((row) => row.workspace.slug === slug);
  const canAdminister =
    membership?.role === 'owner' || membership?.role === 'admin';
  const canWrite = Boolean(membership && membership.role !== 'viewer');

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const client = pb as unknown as TypedPocketBase;
      const workspace = await new WorkspaceMutator(client).getBySlug(slug);
      if (!workspace) {
        if (!cancelled) setError('That workspace could not be found.');
        return;
      }

      const [members, graphs, kinds] = await Promise.all([
        new WorkspaceMemberMutator(client).listForWorkspace(workspace.id),
        new GraphMutator(client).listForWorkspace(workspace.id),
        new PortKindMutator(client).listForWorkspace(workspace.id),
      ]);

      if (cancelled) return;
      setState({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        personal: Boolean(workspace.personal),
        members: members.items,
        graphs: graphs.items,
        kinds: kinds.items,
      });
      setActive(workspace.id);
    };

    load().catch((cause: unknown) => {
      console.error('Failed to load workspace', cause);
      if (!cancelled) setError('That workspace could not be loaded.');
    });

    return () => {
      cancelled = true;
    };
  }, [slug, reloadToken, setActive]);

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!state) return <Skeleton className="h-64 w-full" />;

  const client = pb as unknown as TypedPocketBase;
  const memberMutator = new WorkspaceMemberMutator(client);
  const kindMutator = new PortKindMutator(client);

  const invite = async () => {
    setIsInviting(true);
    try {
      await memberMutator.add(state.id, inviteId.trim(), inviteRole);
      toast.success('Added to the workspace.');
      setInviteId('');
      reload();
    } catch (cause: unknown) {
      console.error('Invite failed', cause);
      toast.error('That user could not be added. Check the user id.');
    } finally {
      setIsInviting(false);
    }
  };

  const changeRole = async (
    member: WorkspaceMember,
    role: WorkspaceMember['role']
  ) => {
    try {
      await memberMutator.update(member.id, { role });
      toast.success(`${memberLabel(member)} is now a ${role}.`);
      reload();
    } catch (cause: unknown) {
      console.error('Role change failed', cause);
      toast.error('That role could not be changed.');
    }
  };

  const remove = async (member: WorkspaceMember) => {
    try {
      await memberMutator.delete(member.id);
      toast.success(
        member.user === user?.id
          ? 'You have left this workspace.'
          : `${memberLabel(member)} removed.`
      );
      reloadWorkspaces();
      reload();
    } catch (cause: unknown) {
      console.error('Removal failed', cause);
      toast.error('That member could not be removed.');
    }
  };

  const addKind = async () => {
    try {
      await kindMutator.create({
        workspace: state.id,
        key: newKind.key.trim(),
        label: newKind.label.trim(),
        color: newKind.color,
      });
      toast.success(`Port kind "${newKind.key}" added.`);
      setNewKind({ key: '', label: '', color: '#2563eb' });
      reload();
    } catch (cause: unknown) {
      console.error('Port kind failed', cause);
      toast.error(
        'That port kind could not be added. Keys are lowercase letters, numbers, / _ and -.'
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            <span className="font-medium">admin</span> manages this list,{' '}
            <span className="font-medium">member</span> reads and writes graphs,{' '}
            <span className="font-medium">viewer</span> reads only. Removing
            someone takes effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            {state.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={member.user === user?.id}
                canAdminister={canAdminister}
                onRole={(role) => changeRole(member, role)}
                onRemove={() => remove(member)}
              />
            ))}
          </div>

          {canAdminister && (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="invite-user">Add a member</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="invite-user"
                  value={inviteId}
                  onChange={(event) => setInviteId(event.target.value)}
                  placeholder="User id"
                  className="max-w-xs"
                />
                <Select
                  value={inviteRole}
                  onValueChange={(value) =>
                    setInviteRole(value as WorkspaceMember['role'])
                  }
                >
                  <SelectTrigger className="w-32" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={invite} disabled={isInviting || !inviteId}>
                  {isInviting ? (
                    <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="mr-1 size-4" aria-hidden />
                  )}
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                By user id, not email: the{' '}
                <code className="font-mono">Users</code> read rule is{' '}
                <code className="font-mono">id = @request.auth.id</code>, so one
                member cannot look another up. Widening it to make an email box
                work would expose every account in the instance.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="size-4" aria-hidden />
            Port kinds
          </CardTitle>
          <CardDescription>
            Connection types only this workspace can see. One with the same key
            as a global kind shadows it here and nowhere else.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.kinds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet — the built-in kinds are all this workspace uses.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {state.kinds.map((kind) => (
                <Badge
                  key={kind.id}
                  variant="outline"
                  className="gap-1.5 font-mono text-xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: kind.color }}
                    aria-hidden
                  />
                  {kind.key}
                </Badge>
              ))}
            </div>
          )}

          {canWrite && (
            <div className="flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="space-y-1">
                <Label htmlFor="kind-key" className="text-xs">
                  Key
                </Label>
                <Input
                  id="kind-key"
                  value={newKind.key}
                  onChange={(event) =>
                    setNewKind({ ...newKind, key: event.target.value })
                  }
                  placeholder="fluid/hydraulic"
                  className="w-48 font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kind-label" className="text-xs">
                  Label
                </Label>
                <Input
                  id="kind-label"
                  value={newKind.label}
                  onChange={(event) =>
                    setNewKind({ ...newKind, label: event.target.value })
                  }
                  placeholder="Hydraulic"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kind-color" className="text-xs">
                  Colour
                </Label>
                <Input
                  id="kind-color"
                  type="color"
                  value={newKind.color}
                  onChange={(event) =>
                    setNewKind({ ...newKind, color: event.target.value })
                  }
                  className="h-9 w-16 p-1"
                />
              </div>
              <Button
                onClick={addKind}
                disabled={!newKind.key || !newKind.label}
              >
                Add kind
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Graphs ({state.graphs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {state.graphs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet.{' '}
              <Link href="/graphs/new" className="underline">
                Create a graph
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1">
              {state.graphs.map((graph) => (
                <li key={graph.id} className="flex items-center gap-2 text-sm">
                  <Link
                    href={`/graphs/${graph.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {graph.label}
                  </Link>
                  <Badge variant="outline" className="text-[10px]">
                    {graph.visibility}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return (
    <ProtectedRoute>
      <div className="container mx-auto space-y-6 px-4 py-8">
        <div className="space-y-2">
          <Link
            href="/workspaces"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← All workspaces
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{slug}</h1>
        </div>

        <WorkspaceDetail slug={slug} />
      </div>
    </ProtectedRoute>
  );
}
