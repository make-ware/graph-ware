'use client';

import Link from 'next/link';
import { ArrowRight, Settings } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import type { User } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Home() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <AuthenticatedView user={user} />;
  }

  return <UnauthenticatedView />;
}

function AuthenticatedView({ user }: { user: User }) {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-2 text-4xl font-bold">
        Welcome back, {user.name || user.email}
      </h1>
      <p className="mb-10 text-lg text-muted-foreground">
        You&apos;re signed in. Start building here.
      </p>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>Account information and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Email:</span>
              <span className="text-sm text-muted-foreground">
                {user.email}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Name:</span>
              <span className="text-sm text-muted-foreground">
                {user.name || 'Not set'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant="default">Active</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Profile
            </CardTitle>
            <CardDescription>
              Update your account details and password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/profile">
              <Button>
                Manage profile
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UnauthenticatedView() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="mb-6 text-5xl font-bold">Graph Ware</h1>
      <p className="mx-auto mb-10 max-w-xl text-xl text-muted-foreground">
        Graph Ware — built with Next.js and PocketBase
      </p>
      <div className="flex flex-col justify-center gap-4 sm:flex-row">
        <Link href="/signup">
          <Button size="lg" className="w-full sm:w-auto">
            Get started
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </Link>
        <Link href="/login">
          <Button variant="outline" size="lg" className="w-full sm:w-auto">
            Sign in
          </Button>
        </Link>
      </div>
    </div>
  );
}
