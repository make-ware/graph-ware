'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { toSlug } from '@project/shared';
import { WorkspaceMutator } from '@project/shared/mutators';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getFieldError, parseAuthError } from '@project/shared';
import { useWorkspaces } from '@/hooks/use-workspaces';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';

function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const rename = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(toSlug(value));
  };

  const submit = async () => {
    setIsSaving(true);
    setErrors({});

    try {
      const mutator = new WorkspaceMutator(pb as unknown as TypedPocketBase);
      const created = await mutator.create({
        name: name.trim(),
        slug: slug.trim(),
        personal: false,
      });

      toast.success(`${created.name} created.`);
      onOpenChange(false);
      onCreated(created.slug);
    } catch (cause: unknown) {
      const parsed = parseAuthError(cause);
      const fieldErrors: Record<string, string> = {};
      for (const field of ['name', 'slug']) {
        const message = getFieldError(parsed, field);
        if (message) fieldErrors[field] = message;
      }
      // A slug collision comes back as a bare uniqueness failure; the form has
      // to say which field it was about or it reads as a mystery.
      if (!Object.keys(fieldErrors).length) {
        fieldErrors.slug = parsed.message;
      }
      setErrors(fieldErrors);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A workspace holds graphs and the people who may work on them. You
            can add members once it exists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => rename(event.target.value)}
              maxLength={100}
              autoFocus
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-slug">URL</Label>
            <Input
              id="workspace-slug"
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value);
              }}
              maxLength={40}
              placeholder="north-sea"
            />
            <p className="text-xs text-muted-foreground">
              /workspaces/{slug || 'north-sea'} — lowercase letters, numbers and
              dashes, and unique across all of graph-ware.
            </p>
            {errors.slug && (
              <p className="text-sm text-destructive">{errors.slug}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={isSaving || !name || !slug}>
            {isSaving && (
              <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceList() {
  const router = useRouter();
  const { memberships, isLoading, error, reload, setActive } = useWorkspaces();
  const [creating, setCreating] = useState(false);

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1].map((key) => (
          <Skeleton key={key} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1 size-4" aria-hidden />
          New workspace
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {memberships.map(({ workspace, role }) => (
          <Card
            key={workspace.id}
            className="transition-colors hover:border-primary/50"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="min-w-0 text-base">
                  <Link
                    href={`/workspaces/${workspace.slug}`}
                    className="block truncate hover:underline"
                    onClick={() => setActive(workspace.id)}
                  >
                    {workspace.name}
                  </Link>
                </CardTitle>
                <div className="flex shrink-0 gap-1">
                  {workspace.personal && (
                    <Badge variant="outline" className="text-[10px]">
                      personal
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {role}
                  </Badge>
                </div>
              </div>
              <CardDescription className="line-clamp-2">
                {workspace.description || (
                  <span className="italic">No description.</span>
                )}
              </CardDescription>
              <p className="pt-1 font-mono text-xs text-muted-foreground">
                /{workspace.slug}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <NewWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(slug) => {
          reload();
          router.push(`/workspaces/${slug}`);
        }}
      />
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto space-y-6 px-4 py-8">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Users className="size-7" aria-hidden />
            Workspaces
          </h1>
          <p className="text-muted-foreground">
            A workspace owns graphs and decides who may read and write them.
            Everyone has a personal one; make another to work with other people.
          </p>
        </div>

        <WorkspaceList />
      </div>
    </ProtectedRoute>
  );
}
