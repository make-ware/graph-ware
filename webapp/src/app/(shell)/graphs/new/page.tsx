'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { GraphInput } from '@project/shared/schema';
import { GraphMutator } from '@project/shared/mutators';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { GraphForm } from '@/components/graph/editor/graph-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';

function NewGraphContent() {
  const router = useRouter();

  const create = async (input: GraphInput) => {
    const client = pb as unknown as TypedPocketBase;
    // `GraphMutator.entityCreate` injects `owner` from the auth store — the
    // create rule requires it to equal the caller, so the form never sends it.
    const graph = await new GraphMutator(client).create(input);
    toast.success(`Created ${graph.label}`);
    router.push(`/graphs/${graph.id}/edit`);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/graphs"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Graphs
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New graph</CardTitle>
          <CardDescription>
            A graph holds nodes and can import other graphs. Connections are
            derived from the ports you give its nodes, so there is nothing to
            wire up by hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GraphForm
            submitLabel="Create graph"
            onSubmit={create}
            onCancel={() => router.push('/graphs')}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewGraphPage() {
  return (
    <ProtectedRoute>
      <NewGraphContent />
    </ProtectedRoute>
  );
}
