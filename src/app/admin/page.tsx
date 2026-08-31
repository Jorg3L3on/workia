import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminAccess } from "@/lib/auth/session";
import { getUserPermissions } from "@/lib/rbac";

export const metadata: Metadata = {
  title: pageTitles.administracion,
};

export default async function AdminPage() {
  const session = await requireAdminAccess();
  const permissions = await getUserPermissions(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin overview
        </h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {session.user.email}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>RBAC</CardTitle>
            <CardDescription>
              Review roles, permissions, and user assignments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/rbac">Open RBAC dashboard</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your permissions</CardTitle>
            <CardDescription>
              Effective permissions for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {permissions.slice(0, 6).map((permission) => (
                <Badge key={permission} variant="secondary">
                  {permission}
                </Badge>
              ))}
              {permissions.length > 6 ? (
                <Badge variant="outline">+{permissions.length - 6} more</Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
